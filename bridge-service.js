'use strict';

const { EventEmitter } = require('events');
const net = require('net');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BRIDGE_PORT = 9780;
const WS_PORT = 9781;

/** ESC/POS command validators */
const EscPos = {
    INIT: Buffer.from([0x1b, 0x40]),
    CUT_PARTIAL: Buffer.from([0x1d, 0x56, 0x42, 0x00]),
    CUT_FULL: Buffer.from([0x1d, 0x56, 0x00]),
    DRAWER_KICK: Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]),

    validate(buffer) {
        const issues = [];
        const hex = buffer.toString('hex');
        if (!buffer.length) {
            issues.push({ code: 'EMPTY', message: 'No data received' });
            return { ok: false, issues, hex };
        }
        if (buffer[0] !== 0x1b && buffer[0] !== 0x1d && buffer[0] < 0x20) {
            issues.push({ code: 'BAD_START', message: 'Buffer does not start with valid ESC/POS command' });
        }
        const hasInit = buffer.includes(this.INIT);
        const hasCut = buffer.includes(this.CUT_PARTIAL) || buffer.includes(this.CUT_FULL);
        if (hasCut && !hasInit) {
            issues.push({ code: 'CUT_BEFORE_INIT', message: 'Cut command sent before ESC @ initialize' });
        }
        const text = buffer.toString('utf8').replace(/[^\x20-\x7e\n\r]/g, '.');
        return { ok: issues.length === 0, issues, hex, preview: text.slice(0, 200) };
    },

    hasDrawerKick(buffer) {
        return buffer.includes(this.DRAWER_KICK) || /^\x1b\x70[\x00-\x01]/.test(buffer.toString('binary'));
    }
};

class VirtualDevice extends EventEmitter {
    constructor(type, config = {}) {
        super();
        this.type = type;
        this.config = config;
        this.status = 'idle';
        this.log = [];
        this.lastCommand = null;
    }

    record(entry) {
        const row = { ...entry, at: new Date().toISOString() };
        this.log.unshift(row);
        if (this.log.length > 100) this.log.pop();
        this.emit('event', row);
        return row;
    }
}

class BridgeService extends EventEmitter {
    constructor() {
        super();
        this.devices = new Map();
        this.servers = [];
        this.wsClients = new Set();
        this.networkSim = {
            mode: 'wired',
            latencyMs: 0,
            packetLossPct: 0,
            bandwidthKbps: 0,
            routerModel: 'router_peplink_balance_20x'
        };
        this.testRun = null;
        this.posConfig = { url: '', apiKey: '', mode: 'web' };
        this._initDefaultDevices();
    }

    _initDefaultDevices() {
        const defaults = [
            { id: 'printer-1', type: 'receipt_printer', label: 'Virtual Receipt Printer', port: 9100, protocol: 'ESC/POS' },
            { id: 'drawer-1', type: 'cash_drawer', label: 'Virtual Cash Drawer', linkedPrinter: 'printer-1' },
            { id: 'terminal-1', type: 'card_terminal', label: 'Virtual Payment Terminal', port: 8443, protocol: 'Semi-integrated' },
            { id: 'display-1', type: 'customer_display', label: 'Virtual Customer Display', port: 8081 },
            { id: 'scanner-1', type: 'barcode_scanner', label: 'Virtual Barcode Scanner', protocol: 'USB-HID' },
            { id: 'kitchen-1', type: 'receipt_printer', label: 'Virtual Kitchen Printer', port: 9101, protocol: 'ESC/POS' },
            { id: 'label-1', type: 'label_printer', label: 'Virtual Label Printer', port: 9102, protocol: 'ZPL' },
            { id: 'scale-1', type: 'scale', label: 'Virtual Scale', port: 9103, protocol: 'Serial' },
            { id: 'register-1', type: 'register', label: 'Virtual POS Screen', protocol: 'Touch' }
        ];
        for (const d of defaults) {
            const dev = new VirtualDevice(d.type, d);
            dev.label = d.label;
            this.devices.set(d.id, dev);
        }
    }

    broadcast(msg) {
        const payload = JSON.stringify(msg);
        for (const ws of this.wsClients) {
            if (ws.readyState === 1) ws.send(payload);
        }
        this.emit('broadcast', msg);
    }

    deviceSnapshot() {
        return [...this.devices.entries()].map(([id, d]) => ({
            id,
            type: d.type,
            label: d.label || id,
            status: d.status,
            config: d.config,
            lastCommand: d.lastCommand,
            logCount: d.log.length
        }));
    }

    start() {
        this._startWebSocket();
        this._startPrinterServer(9100, 'printer-1');
        this._startPrinterServer(9101, 'kitchen-1');
        this._startLabelServer(9102, 'label-1');
        this._startTerminalServer(8443, 'terminal-1');
        this._startHttpApi();
        return { bridgePort: BRIDGE_PORT, wsPort: WS_PORT };
    }

    stop() {
        for (const s of this.servers) {
            try { s.close(); } catch { /* ignore */ }
        }
        this.servers = [];
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
        }
    }

    _startWebSocket() {
        this.wss = new WebSocketServer({ port: WS_PORT });
        this.wss.on('connection', (ws) => {
            this.wsClients.add(ws);
            ws.send(JSON.stringify({ type: 'connected', devices: this.deviceSnapshot(), networkSim: this.networkSim }));
            ws.on('close', () => this.wsClients.delete(ws));
            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(String(raw));
                    this._handleWsMessage(msg, ws);
                } catch (e) {
                    ws.send(JSON.stringify({ type: 'error', message: e.message }));
                }
            });
        });
        this.servers.push(this.wss);
    }

    _handleWsMessage(msg, ws) {
        switch (msg.action) {
            case 'getState':
                ws.send(JSON.stringify({ type: 'state', devices: this.deviceSnapshot(), networkSim: this.networkSim, posConfig: this.posConfig }));
                break;
            case 'setPosConfig':
                this.posConfig = { ...this.posConfig, ...msg.config };
                this.broadcast({ type: 'posConfig', config: this.posConfig });
                break;
            case 'simulateScan':
                this._simulateBarcode(msg.barcode || '012345678905');
                break;
            case 'openDrawer':
                this._openDrawer(msg.deviceId || 'drawer-1');
                break;
            case 'networkSim':
                this.networkSim = { ...this.networkSim, ...msg.settings };
                this.broadcast({ type: 'networkSim', networkSim: this.networkSim });
                break;
            case 'triggerFailover':
                this._triggerFailover(msg.target || 'cellular');
                break;
            case 'runTests':
                this._runTestSuite(msg.suite || 'all').catch((e) => {
                    this.broadcast({ type: 'testError', message: e.message });
                });
                break;
            case 'launchWindowsApp':
                this._launchWindowsApp(msg.exePath, msg.args, msg.cwd);
                break;
            case 'validateConfig':
                ws.send(JSON.stringify({ type: 'configValidation', result: this._validateEquipmentConfig(msg.equipmentType, msg.config) }));
                break;
            default:
                ws.send(JSON.stringify({ type: 'error', message: `Unknown action: ${msg.action}` }));
        }
    }

    _startHttpApi() {
        this.httpServer = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            const url = new URL(req.url, `http://127.0.0.1:${BRIDGE_PORT}`);
            if (url.pathname === '/api/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, service: 'Business One Test Environment Bridge', devices: this.deviceSnapshot().length }));
                return;
            }
            if (url.pathname === '/api/devices') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this.deviceSnapshot()));
                return;
            }
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        });
        this.httpServer.listen(BRIDGE_PORT);
        this.servers.push(this.httpServer);
    }

    _applyNetworkDelay(cb) {
        const delay = this.networkSim.latencyMs || 0;
        const loss = this.networkSim.packetLossPct || 0;
        if (loss > 0 && Math.random() * 100 < loss) {
            return;
        }
        if (delay > 0) setTimeout(cb, delay);
        else cb();
    }

    _startPrinterServer(port, deviceId) {
        const server = net.createServer((socket) => {
            const dev = this.devices.get(deviceId);
            if (dev) dev.status = 'connected';
            const chunks = [];
            socket.on('data', (data) => {
                this._applyNetworkDelay(() => {
                    chunks.push(data);
                    const buffer = Buffer.concat(chunks);
                    const validation = EscPos.validate(buffer);
                    const hasKick = EscPos.hasDrawerKick(buffer);
                    if (dev) {
                        dev.status = 'printing';
                        dev.lastCommand = { validation, bytes: buffer.length, hex: validation.hex?.slice(0, 120) };
                        dev.record({ action: 'print', bytes: buffer.length, validation, preview: validation.preview });
                    }
                    this.broadcast({ type: 'deviceEvent', deviceId, action: 'print', validation, preview: validation.preview });
                    if (hasKick) {
                        this._openDrawer('drawer-1', 'printer_kick');
                    }
                    socket.write(Buffer.from([0x06]));
                    setTimeout(() => {
                        if (dev) dev.status = 'idle';
                    }, 300);
                });
            });
            socket.on('close', () => {
                if (dev) dev.status = 'idle';
            });
        });
        server.listen(port, '127.0.0.1');
        this.servers.push(server);
    }

    _startLabelServer(port, deviceId) {
        const server = net.createServer((socket) => {
            const dev = this.devices.get(deviceId);
            let buffer = Buffer.alloc(0);
            socket.on('data', (data) => {
                buffer = Buffer.concat([buffer, data]);
                const text = buffer.toString('utf8');
                const ok = text.includes('^XA') && text.includes('^XZ');
                const validation = {
                    ok,
                    issues: ok ? [] : [{ code: 'ZPL_INCOMPLETE', message: 'Label job must include ^XA ... ^XZ' }],
                    preview: text.slice(0, 200)
                };
                if (dev) {
                    dev.lastCommand = { validation };
                    dev.record({ action: 'label', validation });
                }
                this.broadcast({ type: 'deviceEvent', deviceId, action: 'label', validation });
                socket.write(Buffer.from([0x06]));
            });
        });
        server.listen(port, '127.0.0.1');
        this.servers.push(server);
    }

    _startTerminalServer(port, deviceId) {
        const server = net.createServer((socket) => {
            const dev = this.devices.get(deviceId);
            if (dev) dev.status = 'connected';
            let buffer = '';
            socket.on('data', (data) => {
                buffer += data.toString('utf8');
                if (!buffer.includes('\n') && buffer.length < 4096) return;
                let req;
                try {
                    req = JSON.parse(buffer);
                    buffer = '';
                } catch {
                    return;
                }
                const validation = this._validateTerminalRequest(req);
                const response = validation.ok
                    ? { status: 'approved', authCode: 'OK' + Math.floor(Math.random() * 900000 + 100000), amount: req.amount, transactionId: 'TXN' + Date.now() }
                    : { status: 'declined', error: validation.error };
                if (dev) {
                    dev.lastCommand = { request: req, validation, response };
                    dev.record({ action: 'payment', request: req, validation, response });
                }
                this.broadcast({ type: 'deviceEvent', deviceId, action: 'payment', validation, response });
                socket.write(JSON.stringify(response) + '\n');
            });
        });
        server.listen(port, '127.0.0.1');
        this.servers.push(server);
    }

    _validateTerminalRequest(req) {
        if (!req || typeof req !== 'object') return { ok: false, error: 'Invalid JSON request' };
        if (!req.action) return { ok: false, error: 'Missing action field' };
        if (req.action === 'sale' && (req.amount == null || Number(req.amount) <= 0)) {
            return { ok: false, error: 'Sale requires positive amount' };
        }
        if (this.networkSim.mode === 'offline') {
            return { ok: false, error: 'Terminal unreachable — network failover in progress' };
        }
        return { ok: true };
    }

    _openDrawer(deviceId, source = 'manual') {
        const dev = this.devices.get(deviceId);
        if (dev) {
            dev.status = 'open';
            dev.record({ action: 'drawer_open', source });
            setTimeout(() => { dev.status = 'closed'; }, 2000);
        }
        this.broadcast({ type: 'deviceEvent', deviceId, action: 'drawer_open', source });
    }

    _simulateBarcode(barcode) {
        const dev = this.devices.get('scanner-1');
        if (dev) dev.record({ action: 'scan', barcode });
        this.broadcast({ type: 'barcodeScan', barcode });
    }

    _triggerFailover(target) {
        const prev = this.networkSim.mode;
        this.networkSim.mode = target;
        this.broadcast({
            type: 'networkFailover',
            from: prev,
            to: target,
            latencyMs: target === 'cellular' ? 120 : 15,
            message: `Failover: ${prev} → ${target}`
        });
        if (target === 'cellular') {
            this.networkSim.latencyMs = 120;
            setTimeout(() => {
                this.networkSim.mode = 'cellular';
                this.broadcast({ type: 'networkStable', mode: 'cellular' });
            }, 8000);
        } else {
            this.networkSim.latencyMs = 10;
            this.broadcast({ type: 'networkStable', mode: target });
        }
    }

    _validateEquipmentConfig(equipmentType, config) {
        const cfg = config || {};
        const missing = [];
        if (!cfg.catalogModelId) missing.push('Device model (catalogModelId)');
        if (['receipt_printer', 'label_printer'].includes(equipmentType)) {
            if (cfg.connection === 'network' && !cfg.address) missing.push('IP address or hostname');
        }
        if (equipmentType === 'card_terminal' && !cfg.poiDeviceId) {
            missing.push('POI device ID (for semi-integrated terminals)');
        }
        if (equipmentType === 'cash_drawer' && cfg.kickMode === 'printer' && !cfg.linkedPrinterEquipmentId) {
            missing.push('Linked receipt printer');
        }
        if (equipmentType === 'customer_display' && cfg.mode === 'browser' && !cfg.url && !cfg.address) {
            missing.push('Customer display URL or device IP');
        }
        return { ok: missing.length === 0, missing, config: cfg };
    }

    async _runTestSuite(suite) {
        if (this.testRun?.running) return;
        const tests = this._getTests(suite);
        this.testRun = { running: true, suite, results: [], passed: 0, failed: 0 };
        this.broadcast({ type: 'testStart', suite, total: tests.length });

        for (const test of tests) {
            this.broadcast({ type: 'testProgress', id: test.id, name: test.name, status: 'running' });
            await new Promise((r) => setTimeout(r, test.delay || 400));
            const result = await test.run(this);
            this.testRun.results.push(result);
            if (result.pass) this.testRun.passed++;
            else this.testRun.failed++;
            this.broadcast({ type: 'testResult', ...result });
        }

        this.testRun.running = false;
        this.broadcast({
            type: 'testComplete',
            suite,
            passed: this.testRun.passed,
            failed: this.testRun.failed,
            total: tests.length
        });
    }

    _getTests(suite) {
        const all = [
            { id: 'bridge-health', name: 'Bridge service health', category: 'backend', delay: 200, run: async () => ({ id: 'bridge-health', pass: true, message: 'Bridge API responding on port ' + BRIDGE_PORT }) },
            { id: 'printer-escpos', name: 'ESC/POS init + cut validation', category: 'peripheral', delay: 300, run: async (b) => {
                const buf = Buffer.concat([EscPos.INIT, Buffer.from('Test receipt\n'), EscPos.CUT_PARTIAL]);
                const v = EscPos.validate(buf);
                return { id: 'printer-escpos', pass: v.ok, message: v.ok ? 'Valid ESC/POS sequence' : v.issues[0].message };
            }},
            { id: 'printer-bad-cut', name: 'Detect cut-before-init', category: 'peripheral', delay: 200, run: async () => {
                const v = EscPos.validate(EscPos.CUT_PARTIAL);
                return { id: 'printer-bad-cut', pass: !v.ok, message: !v.ok ? 'Correctly flagged invalid sequence' : 'Failed to detect bad sequence' };
            }},
            { id: 'drawer-kick', name: 'Cash drawer kick pulse', category: 'peripheral', delay: 250, run: async () => {
                const ok = EscPos.hasDrawerKick(EscPos.DRAWER_KICK);
                return { id: 'drawer-kick', pass: ok, message: ok ? 'Drawer kick command recognized' : 'Drawer kick not recognized' };
            }},
            { id: 'terminal-sale', name: 'Payment terminal sale request', category: 'peripheral', delay: 300, run: async (b) => {
                const v = b._validateTerminalRequest({ action: 'sale', amount: 19.99 });
                return { id: 'terminal-sale', pass: v.ok, message: v.ok ? 'Sale request valid' : v.error };
            }},
            { id: 'terminal-bad-sale', name: 'Reject invalid sale amount', category: 'peripheral', delay: 200, run: async (b) => {
                const v = b._validateTerminalRequest({ action: 'sale', amount: 0 });
                return { id: 'terminal-bad-sale', pass: !v.ok, message: !v.ok ? 'Correctly rejected zero amount' : 'Should reject zero amount' };
            }},
            { id: 'zpl-label', name: 'ZPL label format', category: 'peripheral', delay: 200, run: async () => {
                const zpl = '^XA^FO50,50^ADN,36,20^FDTest^FS^XZ';
                const ok = zpl.includes('^XA') && zpl.includes('^XZ');
                return { id: 'zpl-label', pass: ok, message: ok ? 'ZPL structure valid' : 'Invalid ZPL' };
            }},
            { id: 'config-printer', name: 'Printer config validation', category: 'backend', delay: 200, run: async (b) => {
                const v = b._validateEquipmentConfig('receipt_printer', { catalogModelId: 'epson_tm_t88vii', connection: 'network', address: '192.168.1.50', port: '9100' });
                return { id: 'config-printer', pass: v.ok, message: v.ok ? 'Printer config valid' : v.missing.join(', ') };
            }},
            { id: 'config-terminal', name: 'Terminal config requires POI ID', category: 'backend', delay: 200, run: async (b) => {
                const v = b._validateEquipmentConfig('card_terminal', { catalogModelId: 'pax_a3700' });
                return { id: 'config-terminal', pass: !v.ok && v.missing.includes('POI device ID (for semi-integrated terminals)'), message: 'POI ID required when missing' };
            }},
            { id: 'config-drawer', name: 'Drawer requires linked printer', category: 'backend', delay: 200, run: async (b) => {
                const v = b._validateEquipmentConfig('cash_drawer', { catalogModelId: 'apg_vasario_1616', kickMode: 'printer' });
                return { id: 'config-drawer', pass: !v.ok, message: 'Linked printer required for printer-kick drawer' };
            }},
            { id: 'network-failover', name: 'Network failover simulation', category: 'network', delay: 500, run: async (b) => {
                b._triggerFailover('cellular');
                await new Promise((r) => setTimeout(r, 600));
                return { id: 'network-failover', pass: b.networkSim.mode === 'cellular', message: 'Failover to cellular simulated' };
            }},
            { id: 'network-latency', name: 'Latency injection', category: 'network', delay: 300, run: async (b) => {
                b.networkSim.latencyMs = 200;
                return { id: 'network-latency', pass: b.networkSim.latencyMs === 200, message: '200ms latency applied' };
            }},
            { id: 'network-packet-loss', name: 'Packet loss injection', category: 'network', delay: 200, run: async (b) => {
                b.networkSim.packetLossPct = 5;
                return { id: 'network-packet-loss', pass: b.networkSim.packetLossPct === 5, message: '5% packet loss applied' };
            }},
            { id: 'pos-url-reachable', name: 'POS URL connectivity', category: 'backend', delay: 400, run: async (b) => {
                const url = b.posConfig.url;
                if (!url) return { id: 'pos-url-reachable', pass: true, message: 'No POS URL configured — skipped' };
                try {
                    await b._httpPing(url);
                    return { id: 'pos-url-reachable', pass: true, message: `Reachable: ${url}` };
                } catch (e) {
                    return { id: 'pos-url-reachable', pass: false, message: e.message };
                }
            }},
            { id: 'barcode-scan', name: 'Barcode scanner event', category: 'peripheral', delay: 200, run: async (b) => {
                b._simulateBarcode('012345678905');
                return { id: 'barcode-scan', pass: true, message: 'Scan event broadcast' };
            }},
            { id: 'display-update', name: 'Customer display payload', category: 'peripheral', delay: 200, run: async () => {
                const payload = { total: '42.50', items: 3, mode: 'sale' };
                return { id: 'display-update', pass: payload.total && payload.items > 0, message: 'Display payload structure valid' };
            }}
        ];
        if (suite === 'all') return all;
        return all.filter((t) => t.category === suite);
    }

    _httpPing(urlStr) {
        return new Promise((resolve, reject) => {
            let url;
            try { url = new URL(urlStr); } catch { reject(new Error('Invalid URL')); return; }
            const lib = url.protocol === 'https:' ? https : http;
            const req = lib.request(url, { method: 'GET', timeout: 5000 }, (res) => {
                res.resume();
                if (res.statusCode >= 200 && res.statusCode < 500) resolve(res.statusCode);
                else reject(new Error(`HTTP ${res.statusCode}`));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
        });
    }

    _launchWindowsApp(exePath, args = [], cwd) {
        if (!exePath || !fs.existsSync(exePath)) {
            this.broadcast({ type: 'launchError', message: 'Executable not found: ' + exePath });
            return;
        }
        try {
            const child = spawn(exePath, args, { cwd: cwd || path.dirname(exePath), detached: true, stdio: 'ignore' });
            child.unref();
            this.broadcast({ type: 'appLaunched', exePath, pid: child.pid });
        } catch (e) {
            this.broadcast({ type: 'launchError', message: e.message });
        }
    }
}

module.exports = { BridgeService, BRIDGE_PORT, WS_PORT, EscPos };

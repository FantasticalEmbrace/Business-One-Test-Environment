/**
 * Business One Test Environment — Bridge Service
 * Real hardware impersonation: TCP listeners speak actual POS protocols so
 * cloud admin credentials can be entered into a real POS backend for end-to-end tests.
 */

const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { exec, spawn } = require('child_process');
const path = require('path');

// ─── Utilities ───────────────────────────────────────────────────────────────

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function generateSerial(prefix, length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = prefix;
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function generateTID() {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

function generateMAC() {
  const bytes = crypto.randomBytes(6);
  bytes[0] = (bytes[0] | 0x02) & 0xfe;
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

function macForDeviceId(deviceId) {
  const hash = crypto.createHash('sha256').update(`business-one-te:${deviceId}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 6));
  bytes[0] = (bytes[0] | 0x02) & 0xfe;
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

// ─── Logging ─────────────────────────────────────────────────────────────────

class BridgeLog extends EventEmitter {
  constructor() {
    super();
    this.entries = [];
  }

  record(deviceId, direction, message, extra = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      deviceId,
      direction,
      message,
      ...extra,
    };
    this.entries.push(entry);
    if (this.entries.length > 5000) this.entries.shift();
    this.emit('log', entry);
    return entry;
  }

  getForDevice(deviceId, limit = 100) {
    const filtered = deviceId
      ? this.entries.filter((e) => e.deviceId === deviceId)
      : this.entries;
    return filtered.slice(-limit);
  }

  clear(deviceId) {
    if (deviceId) {
      this.entries = this.entries.filter((e) => e.deviceId !== deviceId);
    } else {
      this.entries = [];
    }
  }
}

const bridgeLog = new BridgeLog();

// ─── ESC/POS receipt printer (TCP 9100+) ─────────────────────────────────────

class VirtualEscPosPrinter extends EventEmitter {
  constructor(id, options, log) {
    super();
    this.id = id;
    this.log = log;
    this.manufacturer = options.manufacturer || 'Epson';
    this.model = options.model || 'TM-T88VII';
    this.serialNumber = options.serial || generateSerial('T88');
    this.firmwareVersion = options.firmware || '1.17A ESC/POS';
    this.macAddress = options.mac || macForDeviceId(id);
    this.port = Number(options.port) || 9100;
    this.ip = options.ip || getLocalIP();
    this.protocol = options.protocol || 'ESC/POS';
    this.server = null;
    this.connections = [];
    this.drawerAttached = null;
    this.printBuffer = [];
    this.jobCount = 0;
    this.status = 'offline';
    this.paperPresent = true;
    this.coverOpen = false;
    this.lastPrintText = '';
  }

  getCredentials() {
    return {
      type: 'receipt_printer',
      manufacturer: this.manufacturer,
      model: this.model,
      serialNumber: this.serialNumber,
      firmwareVersion: this.firmwareVersion,
      macAddress: this.macAddress,
      connection: 'Ethernet/TCP',
      ip: this.ip,
      port: this.port,
      protocol: this.protocol,
      adminHint: `POS admin: network printer, address ${this.ip}, port ${this.port}`,
    };
  }

  getInfo() {
    return {
      id: this.id,
      status: this.status,
      credentials: this.getCredentials(),
      stats: {
        connections: this.connections.length,
        jobsProcessed: this.jobCount,
        drawerAttached: this.drawerAttached ? this.drawerAttached.id : null,
        lastPrintPreview: this.lastPrintText.slice(-800),
      },
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.connections.push(socket);
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        this.log.record(this.id, 'in', `POS connected from ${remote}`);
        this.emit('connection', remote);

        socket.on('data', (data) => this._handleData(data, socket, remote));
        socket.on('close', () => {
          this.connections = this.connections.filter((s) => s !== socket);
          this.log.record(this.id, 'in', `POS disconnected (${remote})`);
        });
        socket.on('error', () => {
          this.connections = this.connections.filter((s) => s !== socket);
        });
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        this.status = 'listening';
        this.log.record(this.id, 'out', `Listening on ${this.ip}:${this.port} (${this.protocol})`);
        resolve(this.getInfo());
      });

      this.server.on('error', (err) => {
        this.status = 'error';
        reject(err);
      });
    });
  }

  stop() {
    this.connections.forEach((s) => s.destroy());
    this.connections = [];
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.status = 'offline';
    this.log.record(this.id, 'out', 'Printer stopped');
  }

  attachDrawer(drawer) {
    this.drawerAttached = drawer;
    drawer.printerAttached = this;
  }

  _handleData(data, socket, remote) {
    const bytes = Buffer.from(data);
    const hexPreview = bytes.toString('hex').slice(0, 120);
    this.log.record(this.id, 'in', `RX ${bytes.length} bytes`, { raw: hexPreview });

    let i = 0;
    while (i < bytes.length) {
      if (bytes[i] === 0x10 && i + 1 < bytes.length && bytes[i + 1] === 0x04) {
        const n = i + 2 < bytes.length ? bytes[i + 2] : 1;
        const response = this._statusByte(n);
        socket.write(Buffer.from([response]));
        this.log.record(this.id, 'out', `DLE EOT status n=${n} → 0x${response.toString(16)}`);
        i += 3;
        continue;
      }
      if (bytes[i] === 0x1B && i + 1 < bytes.length && bytes[i + 1] === 0x40) {
        this.printBuffer = [];
        this.log.record(this.id, 'in', 'ESC @ initialize');
        i += 2;
        continue;
      }
      if (bytes[i] === 0x1B && i + 1 < bytes.length && bytes[i + 1] === 0x70) {
        const pin = i + 2 < bytes.length ? bytes[i + 2] : 0;
        this.log.record(this.id, 'in', `ESC p drawer kick pin=${pin}`);
        if (this.drawerAttached) this.drawerAttached.kick();
        this.emit('drawer-kick', pin);
        i += 5;
        continue;
      }
      if (bytes[i] === 0x1D && i + 1 < bytes.length && bytes[i + 1] === 0x49) {
        const n = i + 2 < bytes.length ? bytes[i + 2] : 1;
        const response = this._printerId(n);
        socket.write(response);
        this.log.record(this.id, 'out', `GS I identity n=${n} → ${response.toString().replace(/\0/g, '')}`);
        i += 3;
        continue;
      }
      if (bytes[i] === 0x1D && i + 1 < bytes.length && bytes[i + 1] === 0x56) {
        this.jobCount += 1;
        const text = Buffer.from(this.printBuffer).toString('utf8').replace(/[^\x20-\x7E\n\r]/g, '.');
        this.log.record(this.id, 'in', `Paper cut — job #${this.jobCount}`, { preview: text.slice(0, 200) });
        this.lastPrintText = text;
        this.emit('print-job', { jobNumber: this.jobCount, text });
        this.printBuffer = [];
        i += 3;
        continue;
      }
      this.printBuffer.push(bytes[i]);
      i += 1;
    }
  }

  _statusByte(n) {
    if (n === 2 && this.coverOpen) return 0x16;
    if (n === 4 && !this.paperPresent) return 0x72;
    return 0x12;
  }

  _printerId(n) {
    switch (n) {
      case 1: return Buffer.from(`${this.manufacturer}\x00`);
      case 2: return Buffer.from(`${this.model}\x00`);
      case 3: return Buffer.from(`${this.serialNumber}\x00`);
      case 65: return Buffer.from(`${this.firmwareVersion}\x00`);
      default: return Buffer.from(`${this.model}\x00`);
    }
  }
}

// ─── ZPL label printer ───────────────────────────────────────────────────────

class VirtualZplPrinter extends EventEmitter {
  constructor(id, options, log) {
    super();
    this.id = id;
    this.log = log;
    this.manufacturer = options.manufacturer || 'Zebra';
    this.model = options.model || 'ZQ630';
    this.serialNumber = options.serial || generateSerial('ZQ');
    this.macAddress = options.mac || macForDeviceId(id);
    this.port = Number(options.port) || 9102;
    this.ip = options.ip || getLocalIP();
    this.server = null;
    this.status = 'offline';
    this.lastLabelPreview = '';
  }

  getCredentials() {
    return {
      type: 'label_printer',
      manufacturer: this.manufacturer,
      model: this.model,
      serialNumber: this.serialNumber,
      macAddress: this.macAddress,
      ip: this.ip,
      port: this.port,
      protocol: 'ZPL over TCP',
      adminHint: `POS admin: network label printer, address ${this.ip}, port ${this.port}, MAC ${this.macAddress}`,
    };
  }

  getInfo() {
    return {
      id: this.id,
      status: this.status,
      credentials: this.getCredentials(),
      stats: { lastLabelPreview: this.lastLabelPreview.slice(-300) },
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        this.log.record(this.id, 'in', `POS connected from ${remote}`);
        socket.on('data', (data) => {
          const text = data.toString('utf8');
          const preview = text.replace(/[^\x20-\x7E\n\r]/g, '.').slice(0, 200);
          this.lastLabelPreview = preview;
          this.log.record(this.id, 'in', `ZPL job ${data.length} bytes`, { preview: text.slice(0, 160) });
          this.emit('label-job', { preview, bytes: data.length });
        });
        socket.on('error', () => {});
      });
      this.server.listen(this.port, '0.0.0.0', () => {
        this.status = 'listening';
        this.log.record(this.id, 'out', `ZPL listening on ${this.ip}:${this.port}`);
        resolve(this.getInfo());
      });
      this.server.on('error', reject);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.status = 'offline';
  }
}

// ─── Cash drawer (printer DK port) ───────────────────────────────────────────

class VirtualCashDrawer extends EventEmitter {
  constructor(id, options, log) {
    super();
    this.id = id;
    this.log = log;
    this.manufacturer = options.manufacturer || 'APG';
    this.model = options.model || 'Vasario VB320';
    this.serialNumber = options.serial || generateSerial('VB');
    this.macAddress = options.mac || macForDeviceId(id);
    this.kickCommand = '1B 70 00 19 FA';
    this.printerAttached = null;
    this.isOpen = false;
    this.kickCount = 0;
    this.status = 'offline';
  }

  getCredentials() {
    const printer = this.printerAttached;
    return {
      type: 'cash_drawer',
      manufacturer: this.manufacturer,
      model: this.model,
      serialNumber: this.serialNumber,
      macAddress: this.macAddress,
      connection: 'RJ12 to printer DK port',
      kickCommand: this.kickCommand,
      attachedTo: printer
        ? `${printer.manufacturer} ${printer.model} @ ${printer.ip}:${printer.port}`
        : 'Start receipt printer first, then activate drawer',
      adminHint: 'POS admin: cash drawer linked to receipt printer equipment record',
    };
  }

  getInfo() {
    return {
      id: this.id,
      status: this.status,
      credentials: this.getCredentials(),
      stats: { isOpen: this.isOpen, kickCount: this.kickCount },
    };
  }

  start() {
    this.status = this.printerAttached ? 'ready' : 'waiting_for_printer';
    this.log.record(this.id, 'out', this.printerAttached
      ? `Drawer ready via printer ${this.printerAttached.ip}:${this.printerAttached.port}`
      : 'Drawer waiting — activate receipt printer and link in admin');
    return Promise.resolve(this.getInfo());
  }

  stop() {
    this.status = 'offline';
    this.isOpen = false;
  }

  kick() {
    this.isOpen = true;
    this.kickCount += 1;
    this.log.record(this.id, 'in', `DRAWER OPENED (kick #${this.kickCount})`);
    this.emit('kicked');
    this.emit('drawer-open', { kickCount: this.kickCount });
    setTimeout(() => {
      this.isOpen = false;
      this.log.record(this.id, 'out', 'Drawer closed');
      this.emit('drawer-closed', {});
    }, 5000);
  }
}

// ─── Payment terminal (semi-integrated JSON over TCP) ────────────────────────

class VirtualPaymentTerminal extends EventEmitter {
  constructor(id, options, log) {
    super();
    this.id = id;
    this.log = log;
    this.manufacturer = options.manufacturer || 'Verifone';
    this.model = options.model || 'P400';
    this.serialNumber = options.serial || generateSerial('VF');
    this.poiDeviceId = options.poiDeviceId || generateTID();
    this.macAddress = options.mac || macForDeviceId(id);
    this.port = Number(options.port) || 8443;
    this.ip = options.ip || getLocalIP();
    this.server = null;
    this.status = 'offline';
    this.transactionCount = 0;
  }

  getCredentials() {
    return {
      type: 'payment_terminal',
      manufacturer: this.manufacturer,
      model: this.model,
      serialNumber: this.serialNumber,
      macAddress: this.macAddress,
      poiDeviceId: this.poiDeviceId,
      ip: this.ip,
      port: this.port,
      protocol: 'Semi-integrated JSON/TCP',
      adminHint: `POS admin: card terminal POI device ID = ${this.poiDeviceId}, terminal IP ${this.ip}`,
    };
  }

  getInfo() {
    return {
      id: this.id,
      status: this.status,
      credentials: this.getCredentials(),
      stats: { transactions: this.transactionCount },
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        this.log.record(this.id, 'in', `POS connected from ${remote}`);
        let buffer = '';

        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let idx;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line) this._handleLine(line, socket, remote);
          }
        });
        socket.on('error', () => {});
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        this.status = 'listening';
        this.log.record(this.id, 'out', `Terminal listening on ${this.ip}:${this.port} POI=${this.poiDeviceId}`);
        resolve(this.getInfo());
      });
      this.server.on('error', reject);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.status = 'offline';
  }

  _handleLine(line, socket, remote) {
    this.log.record(this.id, 'in', `RX ${line}`, { source: remote });
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      this.log.record(this.id, 'out', 'Invalid JSON — ignored');
      return;
    }

    const action = String(req.action || req.type || '').toLowerCase();
    if (action === 'ping' || action === 'health' || action === 'status') {
      this.emit('terminal-state', { state: 'idle' });
      const res = JSON.stringify({
        ok: true,
        action: 'status',
        poiDeviceId: this.poiDeviceId,
        serialNumber: this.serialNumber,
        macAddress: this.macAddress,
        model: this.model,
        firmware: '2.1.0',
        online: true,
      });
      socket.write(`${res}\n`);
      this.log.record(this.id, 'out', `Status response sent`);
      return;
    }

    if (action === 'sale' || action === 'payment' || action === 'auth') {
      this.transactionCount += 1;
      const amount = req.amount || req.total || 0;
      this.emit('terminal-state', { state: 'processing', amount });
      const res = JSON.stringify({
        ok: true,
        action: 'sale',
        approved: true,
        authCode: `AUTH${String(this.transactionCount).padStart(6, '0')}`,
        transactionId: `TXN${Date.now()}`,
        amount,
        poiDeviceId: this.poiDeviceId,
        cardType: 'VISA',
        last4: '4242',
      });
      socket.write(`${res}\n`);
      this.log.record(this.id, 'out', `Sale approved $${amount} (${res})`);
      this.emit('sale', { amount, transactionId: this.transactionCount });
      this.emit('terminal-state', { state: 'approved', amount });
      return;
    }

    const res = JSON.stringify({ ok: true, echo: req });
    socket.write(`${res}\n`);
    this.log.record(this.id, 'out', `Echo response`);
  }
}

// ─── Customer display (simple TCP text) ──────────────────────────────────────

class VirtualCustomerDisplay extends EventEmitter {
  constructor(id, options, log) {
    super();
    this.id = id;
    this.log = log;
    this.manufacturer = options.manufacturer || 'Logic Controls';
    this.model = options.model || 'LD9000';
    this.serialNumber = options.serial || generateSerial('LD');
    this.macAddress = options.mac || macForDeviceId(id);
    this.port = Number(options.port) || 9103;
    this.ip = options.ip || getLocalIP();
    this.server = null;
    this.status = 'offline';
    this.lastLine1 = '';
    this.lastLine2 = '';
  }

  getCredentials() {
    return {
      type: 'customer_display',
      manufacturer: this.manufacturer,
      model: this.model,
      serialNumber: this.serialNumber,
      macAddress: this.macAddress,
      ip: this.ip,
      port: this.port,
      protocol: 'Pole display / raw TCP',
      adminHint: `Customer display network address ${this.ip}:${this.port} (if supported by POS)`,
    };
  }

  getInfo() {
    return {
      id: this.id,
      status: this.status,
      credentials: this.getCredentials(),
      stats: { line1: this.lastLine1, line2: this.lastLine2 },
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        this.log.record(this.id, 'in', `Display client connected ${remote}`);
        socket.on('data', (data) => {
          const text = data.toString('utf8').trim();
          this.log.record(this.id, 'in', `Display write: ${text.slice(0, 80)}`);
          if (!this.lastLine1) this.lastLine1 = text;
          else this.lastLine2 = text;
          this.emit('display-update', { line1: this.lastLine1, line2: this.lastLine2 });
        });
        socket.on('error', () => {});
      });
      this.server.listen(this.port, '0.0.0.0', () => {
        this.status = 'listening';
        this.log.record(this.id, 'out', `Display listening on ${this.ip}:${this.port}`);
        resolve(this.getInfo());
      });
      this.server.on('error', reject);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.status = 'offline';
  }
}

// ─── Scanner (keyboard wedge — no TCP) ───────────────────────────────────────

class VirtualScanner extends EventEmitter {
  constructor(id, options, log) {
    super();
    this.id = id;
    this.log = log;
    this.manufacturer = options.manufacturer || 'Honeywell';
    this.model = options.model || '1472g';
    this.serialNumber = options.serial || generateSerial('HW');
    this.macAddress = options.mac || macForDeviceId(id);
    this.status = 'offline';
  }

  getCredentials() {
    return {
      type: 'barcode_scanner',
      manufacturer: this.manufacturer,
      model: this.model,
      serialNumber: this.serialNumber,
      macAddress: this.macAddress,
      connection: 'USB keyboard wedge',
      adminHint: 'POS admin: scanner as keyboard wedge — no IP. Use Test scan from this app.',
    };
  }

  getInfo() {
    return { id: this.id, status: this.status, credentials: this.getCredentials(), stats: {} };
  }

  start() {
    this.status = 'ready';
    this.log.record(this.id, 'out', 'Scanner ready (keyboard wedge simulation)');
    return Promise.resolve(this.getInfo());
  }

  stop() {
    this.status = 'offline';
  }

  scan(barcode) {
    const value = String(barcode || '').trim();
    if (!value) return { ok: false, error: 'Empty barcode' };
    const escaped = value.replace(/"/g, '`"').replace(/[+^%~(){}[\]]/g, '{$&}');
    exec(`powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${escaped}{ENTER}')"`);
    this.log.record(this.id, 'out', `Wedge scan sent: ${value}`);
    this.emit('scan', { barcode: value });
    return { ok: true, barcode: value };
  }
}

// ─── Local-only devices (touchscreen, scale) ───────────────────────────────────

class VirtualLocalDevice {
  constructor(id, options, log) {
    this.id = id;
    this.log = log;
    this.manufacturer = options.manufacturer || '';
    this.model = options.model || '';
    this.serialNumber = options.serial || generateSerial('LOC');
    this.macAddress = options.mac || macForDeviceId(id);
    this.deviceType = options.deviceType || 'other';
    this.notes = options.notes || '';
    this.ip = options.ip || getLocalIP();
    this.protocol = options.protocol || '';
    this.connection = options.connection || '';
    this.status = 'offline';
  }

  getCredentials() {
    const isRegister = this.id === 'screen' || this.deviceType === 'pos_screen';
    if (isRegister) {
      return {
        type: this.deviceType || 'pos_register',
        manufacturer: this.manufacturer,
        model: this.model,
        serialNumber: this.serialNumber,
        macAddress: this.macAddress,
        ip: this.ip,
        connection: this.connection || 'WiFi / Ethernet',
        protocol: this.protocol || 'Browser POS register',
        adminHint:
          this.notes ||
          `POS admin: register IP ${this.ip} — assign this address on the equipment record for this register.`,
      };
    }
    return {
      type: this.deviceType,
      manufacturer: this.manufacturer,
      model: this.model,
      serialNumber: this.serialNumber,
      macAddress: this.macAddress,
      connection: 'Local (USB/HDMI/Serial)',
      adminHint: this.notes,
    };
  }

  getInfo() {
    return { id: this.id, status: this.status, credentials: this.getCredentials(), stats: {} };
  }

  start() {
    this.status = 'local';
    const cred = this.getCredentials();
    if (cred.ip) {
      this.log.record(this.id, 'out', `Register ready — IP ${cred.ip} (${this.manufacturer} ${this.model})`);
    } else {
      this.log.record(this.id, 'out', `Local device noted — ${this.notes}`);
    }
    return Promise.resolve(this.getInfo());
  }

  stop() {
    this.status = 'offline';
  }
}

// ─── Device profiles (matches Virtual Devices UI ids) ─────────────────────────

const DEVICE_PROFILES = {
  printer: {
    factory: 'escpos',
    manufacturer: 'Epson',
    model: 'TM-T88VII',
    port: 9100,
    protocol: 'ESC/POS',
  },
  kitchen: {
    factory: 'escpos',
    manufacturer: 'Star',
    model: 'SP700',
    port: 9101,
    protocol: 'Star Line / ESC/POS',
  },
  label: {
    factory: 'zpl',
    manufacturer: 'Zebra',
    model: 'ZQ630',
    port: 9102,
  },
  drawer: { factory: 'drawer', manufacturer: 'APG', model: 'Vasario VB320' },
  terminal: {
    factory: 'terminal',
    manufacturer: 'Verifone',
    model: 'P400',
    port: 8443,
  },
  display: {
    factory: 'display',
    manufacturer: 'Logic Controls',
    model: 'LD9000',
    port: 9103,
  },
  scanner: { factory: 'scanner', manufacturer: 'Honeywell', model: '1472g' },
  screen: {
    factory: 'local',
    manufacturer: 'Elo Touch',
    model: '15" PCAP',
    deviceType: 'pos_screen',
    connection: 'WiFi / Ethernet',
    protocol: 'Browser POS register',
    notes: 'Enter the register IP below in POS admin on the equipment record for this register.',
  },
  scale: {
    factory: 'local',
    manufacturer: 'CAS',
    model: 'SW-50',
    deviceType: 'scale',
    notes: 'Serial scale requires COM port (com0com). Not emulated on TCP in this build.',
  },
};

// ─── Bridge manager ──────────────────────────────────────────────────────────

const devices = new Map();
let eventSink = null;

function setEventSink(fn) {
  eventSink = typeof fn === 'function' ? fn : null;
}

bridgeLog.on('log', (entry) => {
  if (eventSink) eventSink({ type: 'log', entry });
});

function registerCredentialHints(catalogId, ip) {
  const cat = String(catalogId || '').toLowerCase();
  if (cat.includes('paypoint')) {
    return {
      protocol: 'Elo PayPoint register',
      connection: 'WiFi / Ethernet',
      notes: `POS admin: PayPoint register IP ${ip}. Built-in printer, scanner, drawer, and customer display are on this same unit.`,
    };
  }
  if (/^sunmi_|^landi_reg_|^aures_|^posiflex_|^partner_/.test(cat)) {
    return {
      protocol: 'Android / browser POS register',
      connection: 'WiFi / Ethernet',
      notes: `POS admin: all-in-one register IP ${ip}. Assign this address on the station equipment record.`,
    };
  }
  return {
    protocol: 'Browser POS register',
    connection: 'WiFi / Ethernet',
    notes: `POS admin: register IP ${ip}. Enter on the equipment record for this touchscreen or POS PC.`,
  };
}

function createDeviceInstance(id, overrides = {}) {
  const profile = DEVICE_PROFILES[id];
  if (!profile) throw new Error(`Unknown device id: ${id}`);

  const opts = { ...profile, ...overrides, ip: overrides.ip || getLocalIP() };
  if (id === 'screen' && overrides.catalogId) {
    Object.assign(opts, registerCredentialHints(overrides.catalogId, opts.ip));
  }

  switch (profile.factory) {
    case 'escpos':
      return new VirtualEscPosPrinter(id, opts, bridgeLog);
    case 'zpl':
      return new VirtualZplPrinter(id, opts, bridgeLog);
    case 'drawer':
      return new VirtualCashDrawer(id, opts, bridgeLog);
    case 'terminal':
      return new VirtualPaymentTerminal(id, opts, bridgeLog);
    case 'display':
      return new VirtualCustomerDisplay(id, opts, bridgeLog);
    case 'scanner':
      return new VirtualScanner(id, opts, bridgeLog);
    case 'local':
      return new VirtualLocalDevice(id, opts, bridgeLog);
    default:
      throw new Error(`No factory for ${id}`);
  }
}

function attachDeviceUiBridge(instance) {
  if (!instance || typeof instance.on !== 'function') return;
  const id = instance.id;
  const push = (uiType, payload) => {
    if (eventSink) {
      eventSink({
        type: 'device-ui',
        deviceId: id,
        uiType,
        payload: payload || {},
        timestamp: Date.now(),
      });
    }
  };
  instance.on('print-job', (p) => push('print', p));
  instance.on('label-job', (p) => push('label', p));
  instance.on('display-update', (p) => push('display', p));
  instance.on('drawer-open', (p) => push('drawer-open', p));
  instance.on('drawer-closed', () => push('drawer-closed', {}));
  instance.on('terminal-state', (p) => push('terminal', p));
  instance.on('sale', (p) => push('sale', p));
  instance.on('scan', (p) => push('scan', p));
}

async function startDevice(id, overrides = {}) {
  if (!overrides.manufacturer || !overrides.model) {
    return { ok: false, error: 'Assign a hardware model from the Device Library before starting' };
  }

  if (devices.has(id)) {
    const existing = devices.get(id);
    return { ok: true, device: existing.getInfo() };
  }

  const instance = createDeviceInstance(id, overrides);
  attachDeviceUiBridge(instance);
  devices.set(id, instance);

  if (id === 'drawer') {
    const printer = devices.get('printer');
    if (printer && printer.attachDrawer) {
      printer.attachDrawer(instance);
    }
  }

  try {
    const info = await instance.start();

    if (id === 'printer') {
      const drawer = devices.get('drawer');
      if (drawer && instance.attachDrawer) {
        instance.attachDrawer(drawer);
        if (drawer.status === 'waiting_for_printer') drawer.status = 'ready';
      }
    }

    if (eventSink) eventSink({ type: 'device-started', device: info });
    if (instance.emit && DEVICE_PROFILES[id]?.factory === 'terminal') {
      instance.emit('terminal-state', { state: 'idle' });
    }
    return { ok: true, device: info };
  } catch (err) {
    devices.delete(id);
    bridgeLog.record(id, 'out', `Start failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function stopDevice(id) {
  const instance = devices.get(id);
  if (!instance) return { ok: true };
  instance.stop();
  devices.delete(id);
  if (eventSink) eventSink({ type: 'device-stopped', deviceId: id });
  return { ok: true };
}

function listDevices() {
  return Array.from(devices.values()).map((d) => d.getInfo());
}

function getDeviceInfo(id) {
  const d = devices.get(id);
  return d ? d.getInfo() : null;
}

function getDeviceLogs(id, limit = 100) {
  return bridgeLog.getForDevice(id, limit);
}

function clearDeviceLogs(id) {
  bridgeLog.clear(id);
  return { ok: true };
}

function scanBarcode(barcode) {
  const scanner = devices.get('scanner');
  if (!scanner || scanner.status === 'offline') {
    return { ok: false, error: 'Start the barcode scanner virtual device first' };
  }
  if (scanner.scan) return scanner.scan(barcode);
  return { ok: false, error: 'Scanner not ready' };
}

function shutdownAll() {
  for (const [id, device] of devices) {
    try {
      device.stop();
    } catch {
      // ignore
    }
    devices.delete(id);
  }
}

// ─── Legacy POS / emulator helpers ───────────────────────────────────────────

const legacy = {
  posProcess: null,
  emulatorProcess: null,
};

function getStatus() {
  return {
    bridge: 'running',
    localIp: getLocalIP(),
    devices: listDevices(),
    pos: legacy.posProcess ? { running: true, pid: legacy.posProcess.pid } : { running: false },
  };
}

function launchPos(exePath, args, workDir) {
  const opts = { cwd: workDir || path.dirname(exePath) };
  const argList = (args || '').split(' ').filter(Boolean);
  legacy.posProcess = spawn(exePath, argList, opts);
  legacy.posProcess.on('exit', () => { legacy.posProcess = null; });
  return { pid: legacy.posProcess.pid };
}

function stopPos() {
  if (legacy.posProcess) {
    legacy.posProcess.kill();
    legacy.posProcess = null;
  }
}

function startAndroidEmulator(avd) {
  const emulatorPath = process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, 'emulator', 'emulator.exe')
    : 'emulator';
  legacy.emulatorProcess = spawn(emulatorPath, ['-avd', avd || 'Pixel_Tablet', '-no-snapshot']);
  legacy.emulatorProcess.on('exit', () => { legacy.emulatorProcess = null; });
}

function installApk(apkPath) {
  const adb = process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe')
    : 'adb';
  exec(`"${adb}" install -r "${apkPath}"`);
}

function stopAndroid() {
  const adb = process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe')
    : 'adb';
  exec(`"${adb}" emu kill`);
  if (legacy.emulatorProcess) {
    legacy.emulatorProcess.kill();
    legacy.emulatorProcess = null;
  }
}

function bootIosSimulator(device) {
  exec(`xcrun simctl boot "${device || 'iPad-Pro-12-9-inch-6th-generation'}"`, (err) => {
    if (!err) exec('open -a Simulator');
  });
}

function stopIos() {
  exec('xcrun simctl shutdown booted');
}

module.exports = {
  setEventSink,
  startDevice,
  stopDevice,
  listDevices,
  getDeviceInfo,
  getDeviceLogs,
  clearDeviceLogs,
  scanBarcode,
  shutdownAll,
  getStatus,
  getLocalIP,
  launchPos,
  stopPos,
  startAndroidEmulator,
  installApk,
  stopAndroid,
  bootIosSimulator,
  stopIos,
};

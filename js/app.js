'use strict';

const WS_PORT = 9781;
const PAGE_SIZE = 24;

let deviceLibrary = { devices: [], equipmentTypes: [] };
let ws = null;
let wsConnected = false;
let currentPlatform = 'windows';
let libraryPage = 0;
let selectedDevice = null;
let testResults = { passed: 0, failed: 0, total: 0, items: [] };
let networkState = { mode: 'wired', latencyMs: 0, packetLossPct: 0 };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function init() {
    await loadDeviceLibrary();
    setupNavigation();
    setupPlatformSwitch();
    setupLibrary();
    setupPosConnection();
    setupLivePos();
    setupNetworkSim();
    setupTestRunner();
    setupDashboard();
    connectWebSocket();
    if (window.bote?.getPorts) {
        const ports = await window.bote.getPorts();
        $('#dash-api-port').textContent = `127.0.0.1:${ports.bridgePort}`;
        $('#dash-ws-port').textContent = `127.0.0.1:${ports.wsPort}`;
    }
    log('Business One Test Environment ready', 'info');
}

async function loadDeviceLibrary() {
    try {
        const res = await fetch('js/device-library.json');
        deviceLibrary = await res.json();
        $('#dash-device-count').textContent = deviceLibrary.deviceCount;
        const typeFilter = $('#lib-type-filter');
        const types = [...new Set(deviceLibrary.devices.map((d) => d.type))].sort();
        types.forEach((t) => {
            const d = deviceLibrary.devices.find((x) => x.type === t);
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = d?.typeLabel || t;
            typeFilter.appendChild(opt);
        });
        populateRouterDropdown();
    } catch (e) {
        log('Failed to load device library: ' + e.message, 'fail');
    }
}

function connectWebSocket() {
    const url = `ws://127.0.0.1:${WS_PORT}`;
    try {
        ws = new WebSocket(url);
        ws.onopen = () => {
            wsConnected = true;
            $('#bridge-dot').classList.add('connected');
            $('#bridge-label').textContent = 'Bridge connected';
            wsSend({ action: 'getState' });
            log('Bridge WebSocket connected', 'pass');
        };
        ws.onclose = () => {
            wsConnected = false;
            $('#bridge-dot').classList.remove('connected');
            $('#bridge-label').textContent = 'Bridge disconnected — retrying…';
            setTimeout(connectWebSocket, 3000);
        };
        ws.onmessage = (ev) => {
            try {
                handleWsMessage(JSON.parse(ev.data));
            } catch { /* ignore */ }
        };
        ws.onerror = () => {
            $('#bridge-label').textContent = 'Bridge unavailable';
        };
    } catch (e) {
        log('WebSocket error: ' + e.message, 'fail');
    }
}

function wsSend(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function handleWsMessage(msg) {
    switch (msg.type) {
        case 'connected':
        case 'state':
            if (msg.devices) renderVirtualDevices(msg.devices);
            if (msg.networkSim) applyNetworkState(msg.networkSim);
            break;
        case 'deviceEvent':
            handleDeviceEvent(msg);
            break;
        case 'barcodeScan':
            log(`Barcode scanned: ${msg.barcode}`, 'info');
            appendHwLog(`SCAN ${msg.barcode}`);
            break;
        case 'networkFailover':
            log(msg.message, 'warn');
            updateNetworkLeds(msg.to);
            break;
        case 'networkStable':
            updateNetworkLeds(msg.mode);
            log(`Network stable: ${msg.mode}`, 'pass');
            break;
        case 'testStart':
            $('#test-progress-list').innerHTML = '';
            log(`Test suite started: ${msg.suite} (${msg.total} tests)`, 'info');
            break;
        case 'testProgress':
            addTestProgress(msg.id, msg.name, 'running');
            break;
        case 'testResult':
            updateTestProgress(msg.id, msg.pass, msg.message);
            break;
        case 'testComplete':
            testResults.passed = msg.passed;
            testResults.failed = msg.failed;
            testResults.total = msg.total;
            updateResultsSummary();
            log(`Tests complete: ${msg.passed} passed, ${msg.failed} failed`, msg.failed ? 'warn' : 'pass');
            $('#btn-stop-tests').disabled = true;
            break;
        case 'appLaunched':
            log(`Launched: ${msg.exePath} (PID ${msg.pid})`, 'pass');
            break;
        case 'launchError':
            log(msg.message, 'fail');
            break;
        case 'posConfig':
            log('POS configuration saved', 'info');
            break;
        case 'configValidation': {
            const r = msg.result;
            const el = $('#config-validation-result');
            if (el) {
                el.innerHTML = r.ok
                    ? '<span style="color:var(--pass)">✓ Config valid</span>'
                    : `<span style="color:var(--fail)">✗ Missing: ${esc((r.missing || []).join(', '))}</span>`;
            }
            break;
        }
    }
}

function handleDeviceEvent(msg) {
    const time = new Date().toLocaleTimeString();
    if (msg.action === 'print') {
        const status = msg.validation?.ok ? 'PASS' : 'FAIL';
        const line = `[${time}] PRINT ${status}: ${msg.preview || ''} ${msg.validation?.issues?.[0]?.message || ''}`;
        appendHwLog(line);
        log(`Printer ${status}: ${msg.validation?.issues?.[0]?.message || 'command accepted'}`, msg.validation?.ok ? 'pass' : 'fail');
    } else if (msg.action === 'payment') {
        appendHwLog(`[${time}] PAYMENT ${msg.validation?.ok ? 'OK' : 'FAIL'}: ${JSON.stringify(msg.response)}`);
    } else if (msg.action === 'drawer_open') {
        appendHwLog(`[${time}] DRAWER OPEN (${msg.source})`);
        log('Cash drawer opened', 'pass');
    } else if (msg.action === 'label') {
        appendHwLog(`[${time}] LABEL ${msg.validation?.ok ? 'OK' : 'FAIL'}`);
    }
    wsSend({ action: 'getState' });
}

function log(text, level = 'info') {
    const el = $('#main-console');
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

function appendHwLog(text) {
    const el = $('#hw-console');
    if (el.textContent.startsWith('Waiting')) el.textContent = '';
    el.textContent += text + '\n';
    el.scrollTop = el.scrollHeight;
}

function setupNavigation() {
    $$('.nav-item').forEach((btn) => {
        btn.addEventListener('click', () => {
            $$('.nav-item').forEach((b) => b.classList.remove('active'));
            $$('.page').forEach((p) => p.classList.remove('active'));
            btn.classList.add('active');
            $(`#page-${btn.dataset.page}`).classList.add('active');
        });
    });
    $$('[data-goto]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.goto;
            $(`.nav-item[data-page="${page}"]`)?.click();
        });
    });
}

function setupPlatformSwitch() {
    $$('.platform-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            $$('.platform-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            currentPlatform = btn.dataset.platform;
            log(`Test target platform: ${currentPlatform}`, 'info');
        });
    });
}

function setupDashboard() {
    $('#btn-clear-hw-log')?.addEventListener('click', () => {
        $('#hw-console').textContent = 'Waiting for peripheral commands…';
    });
}

function renderVirtualDevices(devices) {
    const grid = $('#virtual-devices-grid');
    grid.innerHTML = devices.map((d) => `
        <div class="hw-device" data-id="${d.id}">
            <div class="hw-device-header">
                <span>${esc(d.label)}</span>
                <span class="hw-status ${d.status}">${d.status}</span>
            </div>
            <div class="hw-device-body">
                <div>Type: ${esc(d.type)}</div>
                ${d.config?.port ? `<div>Port: ${d.config.port}</div>` : ''}
                ${d.config?.protocol ? `<div>Protocol: ${esc(d.config.protocol)}</div>` : ''}
                ${d.lastCommand ? `<div style="margin-top:6px;color:var(--gray-700)">Last: ${d.lastCommand.bytes || 0} bytes</div>` : '<div style="margin-top:6px">Idle — waiting for POS commands</div>'}
            </div>
        </div>
    `).join('');
    $('#dash-virtual').textContent = devices.length;
}

function setupLibrary() {
    ['lib-search', 'lib-type-filter', 'lib-brand-filter', 'lib-protocol-filter'].forEach((id) => {
        $(`#${id}`).addEventListener('input', () => { libraryPage = 0; renderLibrary(); });
        $(`#${id}`).addEventListener('change', () => { libraryPage = 0; renderLibrary(); });
    });
    $('#lib-prev').addEventListener('click', () => { if (libraryPage > 0) { libraryPage--; renderLibrary(); } });
    $('#lib-next').addEventListener('click', () => { libraryPage++; renderLibrary(); });
    renderLibrary();
}

function getFilteredDevices() {
    const search = $('#lib-search').value.toLowerCase();
    const type = $('#lib-type-filter').value;
    const brand = $('#lib-brand-filter').value;
    const protocol = $('#lib-protocol-filter').value;
    return deviceLibrary.devices.filter((d) => {
        if (type && d.type !== type) return false;
        if (brand && d.brand !== brand) return false;
        if (protocol && d.protocol !== protocol) return false;
        if (search) {
            const hay = `${d.brand} ${d.model} ${d.protocol} ${d.description} ${d.catalogModelId}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });
}

function renderLibrary() {
    const filtered = getFilteredDevices();
    const brands = [...new Set(filtered.map((d) => d.brand))].sort();
    const protocols = [...new Set(filtered.map((d) => d.protocol))].sort();

    const brandFilter = $('#lib-brand-filter');
    const curBrand = brandFilter.value;
    brandFilter.innerHTML = '<option value="">All brands</option>';
    brands.forEach((b) => {
        const o = document.createElement('option');
        o.value = b; o.textContent = b;
        if (b === curBrand) o.selected = true;
        brandFilter.appendChild(o);
    });

    const protoFilter = $('#lib-protocol-filter');
    const curProto = protoFilter.value;
    protoFilter.innerHTML = '<option value="">All protocols</option>';
    protocols.forEach((p) => {
        const o = document.createElement('option');
        o.value = p; o.textContent = p;
        if (p === curProto) o.selected = true;
        protoFilter.appendChild(o);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (libraryPage >= totalPages) libraryPage = totalPages - 1;
    const start = libraryPage * PAGE_SIZE;
    const page = filtered.slice(start, start + PAGE_SIZE);

    $('#lib-count').textContent = `${filtered.length} devices (showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)})`;
    $('#lib-page-info').textContent = `Page ${libraryPage + 1} of ${totalPages}`;

    $('#library-grid').innerHTML = page.map((d) => `
        <div class="device-card" data-id="${d.catalogModelId}">
            <span class="type-badge">${esc(d.typeLabel || d.type)}</span>
            <h4>${esc(d.brand)} ${esc(d.model)}</h4>
            <p>${esc(d.protocol)} · ${(d.connections || []).join(', ')}</p>
        </div>
    `).join('');

    $$('#library-grid .device-card').forEach((card) => {
        card.addEventListener('click', () => showDeviceDetail(card.dataset.id));
    });
}

function showDeviceDetail(catalogModelId) {
    const d = deviceLibrary.devices.find((x) => x.catalogModelId === catalogModelId);
    if (!d) return;
    selectedDevice = d;
    $$('#library-grid .device-card').forEach((c) => c.classList.toggle('selected', c.dataset.id === catalogModelId));
    $('#lib-detail').classList.remove('hidden');
    $('#lib-detail-title').textContent = `${d.brand} ${d.model}`;
    const fields = (d.configFields || []).map((f) => `<li><strong>${esc(f.label)}</strong> (${f.key})${f.required ? ' *required' : ''}</li>`).join('');
    $('#lib-detail-body').innerHTML = `
        <dl class="detail-grid">
            <dt>Catalog ID</dt><dd><code>${esc(d.catalogModelId)}</code></dd>
            <dt>Type</dt><dd>${esc(d.typeLabel)}</dd>
            <dt>Driver</dt><dd>${esc(d.driver || '—')}</dd>
            <dt>Protocol</dt><dd>${esc(d.protocol)}</dd>
            <dt>Connections</dt><dd>${(d.connections || []).join(', ')}</dd>
            ${d.defaultPort ? `<dt>Default port</dt><dd>${d.defaultPort}</dd>` : ''}
            ${d.baudRate ? `<dt>Baud rate</dt><dd>${d.baudRate}</dd>` : ''}
            <dt>Description</dt><dd>${esc(d.description || '—')}</dd>
        </dl>
        ${fields ? `<h4 style="margin:12px 0 6px">Configuration fields</h4><ul class="field-list">${fields}</ul>` : ''}
        <div class="btn-group" style="margin-top:12px">
            <button class="btn btn-sm btn-secondary" id="btn-validate-config">Validate sample config</button>
        </div>
        <div id="config-validation-result" style="margin-top:8px;font-size:0.85rem"></div>
    `;
    $('#btn-validate-config')?.addEventListener('click', () => {
        const sample = { catalogModelId: d.catalogModelId, connection: d.connections?.[0] || 'usb' };
        if (d.defaultPort) sample.port = String(d.defaultPort);
        if (d.type === 'card_terminal') sample.poiDeviceId = 'TEST-POI-001';
        if (d.type === 'receipt_printer' && sample.connection === 'network') sample.address = '192.168.1.50';
        wsSend({ action: 'validateConfig', equipmentType: d.type, config: sample });
        $('#config-validation-result').textContent = 'Validating…';
    });
}

function setupPosConnection() {
    $('#pos-mode').addEventListener('change', updatePosModeFields);
    updatePosModeFields();

    $('#btn-save-pos').addEventListener('click', () => {
        const config = {
            mode: $('#pos-mode').value,
            url: $('#pos-url').value.trim(),
            apiKey: $('#pos-apikey').value.trim(),
            healthEndpoint: $('#pos-health').value.trim(),
            exePath: $('#pos-exe-path')?.value?.trim(),
            apkPath: $('#pos-apk-path')?.value?.trim()
        };
        wsSend({ action: 'setPosConfig', config });
        localStorage.setItem('bote-pos-config', JSON.stringify(config));
        $('#live-url').value = config.url;
        log('POS configuration saved', 'pass');
    });

    $('#btn-test-pos').addEventListener('click', async () => {
        const url = $('#pos-url').value.trim();
        if (!url) { log('Enter a POS URL to test', 'warn'); return; }
        try {
            const res = await fetch(url, { mode: 'no-cors' }).catch(() => null);
            log(`Connection test sent to ${url}`, 'info');
            wsSend({ action: 'runTests', suite: 'backend' });
        } catch (e) {
            log('Connection failed: ' + e.message, 'fail');
        }
    });

    $('#btn-browse-exe')?.addEventListener('click', async () => {
        if (window.bote?.selectExe) {
            const path = await window.bote.selectExe();
            if (path) $('#pos-exe-path').value = path;
        }
    });

    $('#btn-browse-apk')?.addEventListener('click', async () => {
        if (window.bote?.selectApk) {
            const path = await window.bote.selectApk();
            if (path) $('#pos-apk-path').value = path;
        }
    });

    const saved = localStorage.getItem('bote-pos-config');
    if (saved) {
        try {
            const c = JSON.parse(saved);
            if (c.mode) $('#pos-mode').value = c.mode;
            if (c.url) { $('#pos-url').value = c.url; $('#live-url').value = c.url; }
            if (c.apiKey) $('#pos-apikey').value = c.apiKey;
            if (c.healthEndpoint) $('#pos-health').value = c.healthEndpoint;
            if (c.exePath) $('#pos-exe-path').value = c.exePath;
            if (c.apkPath) $('#pos-apk-path').value = c.apkPath;
            updatePosModeFields();
        } catch { /* ignore */ }
    }
}

function updatePosModeFields() {
    const mode = $('#pos-mode').value;
    $('#pos-windows-fields').classList.toggle('hidden', mode !== 'windows');
    $('#pos-android-fields').classList.toggle('hidden', mode !== 'android');
    $('#pos-ios-fields').classList.toggle('hidden', mode !== 'ios');
}

function setupLivePos() {
    $$('.pos-mode-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            $$('.pos-mode-tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            const mode = tab.dataset.live;
            if (mode === 'windows') {
                $('#pos-placeholder').innerHTML = '<p>Windows app mode — configure .exe under POS Connection and launch from there.</p><button class="btn btn-primary" id="btn-launch-win">Launch Windows POS</button>';
                $('#btn-launch-win')?.addEventListener('click', async () => {
                    const exe = $('#pos-exe-path')?.value || localStorage.getItem('bote-exe');
                    if (window.bote?.launchApp && exe) await window.bote.launchApp(exe, [], null);
                    else log('Set executable path in POS Connection first', 'warn');
                });
            } else if (mode === 'android') {
                $('#pos-placeholder').innerHTML = '<p>Android emulator requires Android Studio + ADB. Install APK via POS Connection settings.</p>';
            } else if (mode === 'ios') {
                $('#pos-placeholder').innerHTML = '<p>iOS Simulator requires Xcode on macOS or a remote Cloud Mac.</p>';
            } else {
                $('#pos-placeholder').innerHTML = '<p>Enter a POS URL and click Load POS</p><p style="font-size:0.8rem">For local POS: http://localhost:PORT</p>';
            }
            $('#pos-iframe').classList.add('hidden');
            $('#pos-placeholder').classList.remove('hidden');
        });
    });

    $('#btn-load-pos').addEventListener('click', loadPosFrame);
    $('#btn-reload-pos').addEventListener('click', () => {
        const iframe = $('#pos-iframe');
        if (!iframe.classList.contains('hidden')) iframe.src = iframe.src;
    });
}

function loadPosFrame() {
    const url = $('#live-url').value.trim();
    if (!url) { log('Enter a POS URL', 'warn'); return; }
    const iframe = $('#pos-iframe');
    const placeholder = $('#pos-placeholder');
    iframe.src = url;
    iframe.classList.remove('hidden');
    placeholder.classList.add('hidden');
    log(`Loading POS: ${url}`, 'info');
    wsSend({ action: 'setPosConfig', config: { url, mode: 'web' } });
}

function populateRouterDropdown() {
    const routers = deviceLibrary.devices.filter((d) => d.type === 'network_router');
    const sel = $('#router-model');
    sel.innerHTML = routers.map((r) => `<option value="${r.catalogModelId}">${r.brand} ${r.model}</option>`).join('');
    sel.addEventListener('change', updateRouterSpecs);
    updateRouterSpecs();
}

function updateRouterSpecs() {
    const id = $('#router-model').value;
    const r = deviceLibrary.devices.find((d) => d.catalogModelId === id);
    if (!r) return;
    $('#router-specs').innerHTML = `
        <div class="spec-tile"><div class="val">${r.failoverSec || '—'}s</div><div class="lbl">Failover</div></div>
        <div class="spec-tile"><div class="val">${r.ports || '—'}</div><div class="lbl">Ports</div></div>
        <div class="spec-tile"><div class="val">${r.cellular || 'N/A'}</div><div class="lbl">Cellular</div></div>
        <div class="spec-tile"><div class="val">${(r.connections || []).length}</div><div class="lbl">Link types</div></div>
    `;
}

function setupNetworkSim() {
    $('#latency-slider').addEventListener('input', (e) => {
        $('#latency-val').textContent = e.target.value;
        networkState.latencyMs = Number(e.target.value);
        wsSend({ action: 'networkSim', settings: { latencyMs: networkState.latencyMs } });
    });
    $('#loss-slider').addEventListener('input', (e) => {
        $('#loss-val').textContent = e.target.value;
        networkState.packetLossPct = Number(e.target.value);
        wsSend({ action: 'networkSim', settings: { packetLossPct: networkState.packetLossPct } });
    });
    $('#btn-failover').addEventListener('click', () => wsSend({ action: 'triggerFailover', target: 'cellular' }));
    $('#btn-failback').addEventListener('click', () => wsSend({ action: 'triggerFailover', target: 'wired' }));
    $('#btn-reset-network').addEventListener('click', () => {
        $('#latency-slider').value = 0;
        $('#loss-slider').value = 0;
        $('#latency-val').textContent = '0';
        $('#loss-val').textContent = '0';
        wsSend({ action: 'networkSim', settings: { latencyMs: 0, packetLossPct: 0, mode: 'wired' } });
        updateNetworkLeds('wired');
        log('Network simulation reset', 'info');
    });
}

function applyNetworkState(sim) {
    networkState = { ...networkState, ...sim };
    if (sim.latencyMs != null) {
        $('#latency-slider').value = sim.latencyMs;
        $('#latency-val').textContent = sim.latencyMs;
    }
    updateNetworkLeds(sim.mode || 'wired');
}

function updateNetworkLeds(mode) {
    const isCell = mode === 'cellular';
    $('#led-wan').className = 'led-dot ' + (isCell ? 'warn' : 'on');
    $('#led-cell').className = 'led-dot ' + (isCell ? 'on' : 'off');
    $('#led-lan').className = 'led-dot on';
    $('#led-net').className = 'led-dot ' + (isCell ? 'warn' : 'on');
}

function setupTestRunner() {
    $$('.test-suite-card').forEach((card) => {
        card.addEventListener('click', () => runTests(card.dataset.suite));
    });
    $('#btn-run-all').addEventListener('click', () => runTests('all'));
}

function runTests(suite) {
    if (!wsConnected) { log('Bridge not connected', 'fail'); return; }
    $('#btn-stop-tests').disabled = false;
    testResults = { passed: 0, failed: 0, total: 0, items: [] };
    wsSend({ action: 'runTests', suite });
    $(`.nav-item[data-page="tests"]`)?.classList.add('active');
    $$('.nav-item').forEach((b) => { if (b.dataset.page !== 'tests') b.classList.remove('active'); });
    $$('.page').forEach((p) => p.classList.remove('active'));
    $('#page-tests').classList.add('active');
}

function addTestProgress(id, name, status) {
    const list = $('#test-progress-list');
    const row = document.createElement('div');
    row.className = 'test-result';
    row.id = `test-row-${id}`;
    row.innerHTML = `<span class="test-icon running">…</span><span>${esc(name)}</span>`;
    list.appendChild(row);
}

function updateTestProgress(id, pass, message) {
    const row = $(`#test-row-${id}`);
    if (!row) return;
    const icon = row.querySelector('.test-icon');
    icon.className = `test-icon ${pass ? 'pass' : 'fail'}`;
    icon.textContent = pass ? '✓' : '✗';
    row.innerHTML = `${icon.outerHTML}<span>${esc(message)}</span>`;

    testResults.items.push({ id, pass, message });
    if (pass) testResults.passed++;
    else testResults.failed++;
    testResults.total++;
    $('#dash-passed').textContent = testResults.passed;
    $('#dash-failed').textContent = testResults.failed;
    updateResultsSummary();

    const resList = $('#results-list');
    const r = document.createElement('div');
    r.className = 'test-result';
    r.innerHTML = `<span class="test-icon ${pass ? 'pass' : 'fail'}">${pass ? '✓' : '✗'}</span><span>${esc(message)}</span>`;
    resList.prepend(r);
}

function updateResultsSummary() {
    $('#res-total').textContent = testResults.total;
    $('#res-passed').textContent = testResults.passed;
    $('#res-failed').textContent = testResults.failed;
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

document.addEventListener('DOMContentLoaded', init);

'use strict';

/**
 * Exports open POS hardware catalog from HM Herbs backend into device-library.json.
 * Run from project root: node scripts/export-device-library.js
 */

const path = require('path');
const fs = require('fs');

const catalogPath = path.join(
    __dirname,
    '..',
    '..',
    'hmherbs-main',
    'backend',
    'services',
    'posHardwareCatalog.js'
);

const { CATALOG_BY_TYPE, EQUIPMENT_TYPE_META } = require(catalogPath);

const PROTOCOL_MAP = {
    escpos_network: { protocol: 'ESC/POS', connections: ['usb', 'network', 'bluetooth'], defaultPort: 9100 },
    star_network: { protocol: 'StarPRNT / ESC/POS', connections: ['usb', 'network', 'bluetooth'], defaultPort: 9100 },
    elo_star: { protocol: 'Elo integrated Star', connections: ['integrated'], defaultPort: null },
    nmi_durango: { protocol: 'Semi-integrated (NMI/Durango)', connections: ['semi_integrated', 'ethernet', 'wifi', 'usb'], defaultPort: 8443 },
    browser: { protocol: 'Browser / HTTP', connections: ['usb', 'network', 'bluetooth'], defaultPort: 80 },
    zebra_label: { protocol: 'ZPL', connections: ['usb', 'network'], defaultPort: 9100 },
    brother_label: { protocol: 'Brother raster', connections: ['usb', 'network'], defaultPort: 9100 },
    keyboard_wedge: { protocol: 'USB-HID keyboard wedge', connections: ['keyboard_wedge', 'usb', 'bluetooth'], defaultPort: null },
    pole_serial: { protocol: 'Serial pole display', connections: ['serial', 'usb'], defaultPort: null, baudRate: 9600 },
    drawer_kick: { protocol: 'ESC p drawer kick', connections: ['printer', 'network'], defaultPort: null },
    scale_serial: { protocol: 'CAS/Mettler serial', connections: ['usb', 'serial', 'network'], defaultPort: null, baudRate: 9600 }
};

function inferProtocol(type, driver, configFields) {
    if (driver && PROTOCOL_MAP[driver]) return PROTOCOL_MAP[driver];
    if (type === 'barcode_scanner') return PROTOCOL_MAP.keyboard_wedge;
    if (type === 'cash_drawer') {
        const hasNet = (configFields || []).some((f) => f.key === 'kickMode');
        return hasNet ? { ...PROTOCOL_MAP.drawer_kick, connections: ['printer', 'network'] } : PROTOCOL_MAP.drawer_kick;
    }
    if (type === 'customer_display') {
        const hasPole = (configFields || []).some((f) => f.options?.some((o) => o.value === 'pole'));
        if (hasPole) return PROTOCOL_MAP.pole_serial;
        return { protocol: 'Browser / HDMI / Pole', connections: ['browser', 'hdmi', 'pole', 'network'], defaultPort: 80 };
    }
    if (type === 'scale') return PROTOCOL_MAP.scale_serial;
    return { protocol: 'Generic', connections: ['usb', 'network'], defaultPort: null };
}

const devices = [];
let id = 0;

for (const [type, typeBlock] of Object.entries(CATALOG_BY_TYPE)) {
    const typeLabel = EQUIPMENT_TYPE_META[type]?.label || type;
    for (const [brandId, brand] of Object.entries(typeBlock.brands || {})) {
        for (const [modelKey, modelDef] of Object.entries(brand.models || {})) {
            const proto = inferProtocol(type, modelDef.driver, modelDef.configFields);
            const fieldKeys = (modelDef.configFields || []).map((f) => ({
                key: f.key,
                label: f.label,
                type: f.type,
                required: Boolean(f.required),
                default: f.default
            }));
            devices.push({
                id: ++id,
                catalogModelId: modelDef.id,
                type,
                typeLabel,
                brand: brand.label,
                brandId,
                model: modelDef.label,
                modelKey,
                driver: modelDef.driver || '',
                description: modelDef.description || '',
                protocol: proto.protocol,
                connections: proto.connections,
                defaultPort: proto.defaultPort,
                baudRate: proto.baudRate || null,
                configFields: fieldKeys,
                linkFields: (modelDef.linkFields || []).map((f) => f.key)
            });
        }
    }
}

const routerModels = [
    { id: ++id, catalogModelId: 'router_cradlepoint_e300', type: 'network_router', typeLabel: 'Network Router', brand: 'Cradlepoint', model: 'E300 (5G)', protocol: 'TCP/IP failover', connections: ['ethernet', 'cellular', 'wifi'], failoverSec: 8, ports: 4, cellular: '5G' },
    { id: ++id, catalogModelId: 'router_cradlepoint_ibr900', type: 'network_router', typeLabel: 'Network Router', brand: 'Cradlepoint', model: 'IBR900 (4G LTE-A)', protocol: 'TCP/IP failover', connections: ['ethernet', 'cellular'], failoverSec: 10, ports: 4, cellular: '4G LTE-A' },
    { id: ++id, catalogModelId: 'router_peplink_balance_20x', type: 'network_router', typeLabel: 'Network Router', brand: 'Peplink', model: 'Balance 20X', protocol: 'Dual WAN + 4G', connections: ['ethernet', 'cellular', 'wifi'], failoverSec: 5, ports: 4, cellular: '4G' },
    { id: ++id, catalogModelId: 'router_peplink_balance_one', type: 'network_router', typeLabel: 'Network Router', brand: 'Peplink', model: 'Balance One', protocol: 'Dual WAN', connections: ['ethernet', 'wifi'], failoverSec: 3, ports: 4, cellular: null },
    { id: ++id, catalogModelId: 'router_digi_tx40', type: 'network_router', typeLabel: 'Network Router', brand: 'Digi', model: 'TX40 (4G LTE)', protocol: 'TCP/IP failover', connections: ['ethernet', 'cellular'], failoverSec: 12, ports: 4, cellular: '4G LTE' },
    { id: ++id, catalogModelId: 'router_digi_ex15', type: 'network_router', typeLabel: 'Network Router', brand: 'Digi', model: 'EX15 (LTE Cat 4)', protocol: 'TCP/IP failover', connections: ['ethernet', 'cellular'], failoverSec: 15, ports: 2, cellular: 'LTE Cat 4' },
    { id: ++id, catalogModelId: 'router_generic_4g', type: 'network_router', typeLabel: 'Network Router', brand: 'Generic', model: '4G LTE Router', protocol: 'TCP/IP failover', connections: ['ethernet', 'cellular'], failoverSec: 10, ports: 4, cellular: '4G' },
    { id: ++id, catalogModelId: 'router_generic_5g', type: 'network_router', typeLabel: 'Network Router', brand: 'Generic', model: '5G Router', protocol: 'TCP/IP failover', connections: ['ethernet', 'cellular', 'wifi'], failoverSec: 8, ports: 4, cellular: '5G' }
];

const output = {
    generatedAt: new Date().toISOString(),
    source: 'posHardwareCatalog.js (open / universal devices only)',
    deviceCount: devices.length + routerModels.length,
    equipmentTypes: Object.entries(EQUIPMENT_TYPE_META).map(([k, v]) => ({ id: k, label: v.label })),
    devices: [...devices, ...routerModels]
};

const outPath = path.join(__dirname, '..', 'js', 'device-library.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(`Exported ${output.deviceCount} devices to ${outPath}`);

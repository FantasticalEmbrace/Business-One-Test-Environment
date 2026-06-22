'use strict';

const fs = require('fs');
const path = require('path');

const catalogPath = path.join(__dirname, '..', '..', 'hmherbs-main', 'backend', 'services', 'posHardwareCatalog.js');
const { CATALOG_BY_TYPE, buildAioRegisterBuiltinMap, collectBuiltinCatalogModelIds } = require(catalogPath);

const TYPE_MAP = {
  register: 'screen',
  card_terminal: 'terminal',
  receipt_printer: 'printer',
  barcode_scanner: 'scanner',
  cash_drawer: 'drawer',
  customer_display: 'display',
  label_printer: 'printer',
  scale: 'scale',
};

const DRIVER_PROTOCOL = {
  elo_star: 'Elo Star / ESC-POS',
  escpos_network: 'ESC/POS',
  star_network: 'StarPRNT / ESC-POS',
  nmi_durango: 'Semi-integrated JSON/TCP',
  browser: 'Browser POS',
  zebra_label: 'ZPL over TCP',
  brother_label: 'Brother QL',
};

function inferYear(modelId, label) {
  const t = `${modelId} ${label}`.toLowerCase();
  if (/vii|5_|t3|dx8000|a920_max|a77|t650|zd621|2025/.test(t)) return 2025;
  if (/iv|iseries5|t2s|a920_pro|a3700|m30iii|tsp143iv/.test(t)) return 2024;
  if (/iii|iseries4|t2|p2_pro|lane_5000/.test(t)) return 2023;
  if (/ii|iseries3|lane_3000/.test(t)) return 2022;
  if (/legacy|ls2208|gc420d|iseries2/.test(t)) return 2021;
  return 2023;
}

function isBuiltinCatalogEntry(brandId, modelId) {
  const bid = String(brandId).toLowerCase();
  const id = String(modelId).toLowerCase();
  return (
    bid.includes('_builtin') ||
    id.includes('_builtin') ||
    id === 'elo_paypoint_printer' ||
    id === 'elo_paypoint_customer_display' ||
    id === 'elo_paypoint_drawer' ||
    id === 'elo_paypoint_scanner'
  );
}

function inferConnections(equipmentType, driver, modelId, brandId) {
  const id = String(modelId).toLowerCase();
  if (isBuiltinCatalogEntry(brandId, modelId)) return ['Built-in'];
  if (equipmentType === 'card_terminal') {
    if (/move|link|a920|a77|a35|a50|a30|a6650|qd4|z6|z1|m400|v400m|p2|n950|e285|v240|s1f2/.test(id)) {
      return ['WiFi', '4G', 'Bluetooth'];
    }
    if (/a35|p400/.test(id)) return ['Ethernet', 'USB'];
    return ['Ethernet', 'WiFi'];
  }
  if (equipmentType === 'register') {
    if (id.includes('ipad')) return ['WiFi'];
    if (/m50|m60|et1004|android_tablet/.test(id)) return ['WiFi', 'Bluetooth'];
    if (id.includes('paypoint')) return ['WiFi', 'Ethernet'];
    return ['Ethernet', 'WiFi', 'USB'];
  }
  if (equipmentType === 'receipt_printer') {
    const c = ['USB', 'Ethernet'];
    if (!/impact|sp742|srp275/.test(id)) c.push('WiFi', 'Bluetooth');
    return c;
  }
  if (equipmentType === 'label_printer') return ['USB', 'Ethernet', 'WiFi'];
  if (equipmentType === 'barcode_scanner') {
    if (/s700|s740|s720|li4278|cs4070/.test(id)) return ['Bluetooth'];
    return ['USB-HID'];
  }
  if (equipmentType === 'cash_drawer') {
    if (id.includes('netpro')) return ['RJ12', 'Ethernet'];
    return ['RJ12'];
  }
  if (equipmentType === 'customer_display') {
    if (id.includes('hdmi') || id.includes('browser')) return ['HDMI', 'USB'];
    if (id.includes('pole') || id.includes('ld') || id.includes('leo')) return ['USB', 'Serial'];
    return ['HDMI', 'USB'];
  }
  if (equipmentType === 'scale') return ['USB', 'Serial', 'Ethernet'];
  return ['USB'];
}

function inferUiProfile(equipmentType, brandId, modelId, label, driver) {
  const id = String(modelId).toLowerCase();
  const b = String(brandId).toLowerCase();
  const l = String(label).toLowerCase();

  if (equipmentType === 'register') {
    if (id.includes('paypoint')) {
      if (l.includes('22') || id.includes('22')) return 'elo-paypoint-22';
      return 'elo-paypoint-15';
    }
    if (b === 'elo' || id.startsWith('elo_')) {
      if (/m50|m60/.test(id)) return 'elo-mobile';
      if (/et1004|10"/.test(l) || id.includes('et1004')) return 'elo-tablet-10';
      if (/22|2494|2201/.test(l + id)) return 'elo-monitor-22';
      if (/17/.test(l)) return 'elo-monitor-17';
      if (/24/.test(l)) return 'elo-monitor-24';
      return 'elo-monitor-15';
    }
    if (b === 'sunmi') return 'sunmi-aio';
    if (b === 'landi') return 'landi-aio';
    if (b === 'hp') return 'hp-engage';
    if (b === 'ncr') return 'ncr-register';
    if (b === 'posiflex') return 'posiflex-aio';
    if (b === 'aures') return 'aures-aio';
    return 'generic-monitor';
  }

  if (equipmentType === 'card_terminal') {
    if (b === 'pax') {
      if (/a920|a77|a35|a50|a30|a6650/.test(id)) return /a920|a77|a50|a30|a6650/.test(id) ? 'pax-mobile' : 'pax-pinpad';
      if (/im30|e600|unattended/.test(id) || l.includes('unattended')) return 'pax-unattended';
      return 'pax-counter';
    }
    if (b === 'verifone') return /m400|vx690|v400m/.test(id) ? 'verifone-mobile' : 'verifone-counter';
    if (b === 'ingenico') return /move|link/.test(id) ? 'ingenico-mobile' : 'ingenico-counter';
    if (b === 'landi') return /dx4000|c20/.test(id) ? 'landi-counter' : 'landi-mobile';
    if (b === 'dejavoo') return /qd4|z6|z8|z9/.test(id) ? 'dejavoo-mobile' : 'dejavoo-counter';
    if (b === 'sunmi') return 'sunmi-terminal';
    return 'generic-terminal';
  }

  if (equipmentType === 'receipt_printer') {
    if (id.includes('paypoint_printer') || b.includes('paypoint_plus_builtin') || b.includes('paypoint')) return 'elo-paypoint-printer';
    if (b.includes('sunmi_builtin')) return 'sunmi-builtin-printer';
    if (b.includes('landi_builtin')) return 'landi-builtin-printer';
    if (b.includes('aures_builtin')) return 'aures-builtin-printer';
    if (b.includes('posiflex_builtin')) return 'posiflex-builtin-printer';
    if (b.includes('partner_builtin')) return 'partner-builtin-printer';
    if (b === 'star' || id.startsWith('star_')) return /impact|sp742/.test(id) ? 'star-impact' : 'star-thermal';
    if (b === 'epson' || id.startsWith('epson_')) return 'epson-thermal';
    return 'generic-thermal';
  }

  if (equipmentType === 'label_printer') {
    if (b === 'zebra') return 'zebra-label';
    if (b === 'brother') return 'brother-label';
    if (b === 'dymo') return 'dymo-label';
    return 'generic-label';
  }

  if (equipmentType === 'barcode_scanner') {
    if (id.includes('paypoint_scanner') || b.includes('paypoint_plus_builtin')) return 'elo-paypoint-scanner';
    if (b === 'honeywell') return /presentation|7980|granit/.test(l) ? 'honeywell-presentation' : 'honeywell-handheld';
    if (b === 'zebra' || b === 'symbol') return /ds9308|presentation/.test(l) ? 'zebra-presentation' : 'zebra-handheld';
    if (b === 'datalogic') return 'datalogic-handheld';
    if (b === 'socket') return 'socket-bluetooth';
    return 'generic-scanner';
  }

  if (equipmentType === 'cash_drawer') {
    if (id.includes('paypoint_drawer') || b.includes('paypoint_plus_builtin')) return 'elo-paypoint-drawer';
    return 'cash-drawer';
  }
  if (equipmentType === 'customer_display') {
    if (id.includes('paypoint_customer') || b.includes('paypoint_plus_builtin') || b.includes('paypoint')) return 'elo-paypoint-customer';
    if (b.includes('sunmi_builtin')) return 'sunmi-builtin-customer';
    if (b.includes('landi_builtin')) return 'landi-builtin-customer';
    if (b === 'elo') return /0702|7/.test(l) ? 'elo-customer-7' : 'elo-customer-10';
    return 'pole-display';
  }
  if (equipmentType === 'scale') return 'retail-scale';
  return 'generic';
}

function buildLibrary() {
  const items = [];
  for (const [equipmentType, typeCatalog] of Object.entries(CATALOG_BY_TYPE)) {
    const libType = TYPE_MAP[equipmentType];
    if (!libType) continue;
    for (const [brandId, brand] of Object.entries(typeCatalog.brands)) {
      for (const [, modelDef] of Object.entries(brand.models)) {
        const driver = modelDef.driver || '';
        const protocol = DRIVER_PROTOCOL[driver] || modelDef.description || driver || 'Universal POS';
        items.push({
          type: libType,
          m: brand.label,
          n: modelDef.label,
          y: inferYear(modelDef.id, modelDef.label),
          c: inferConnections(equipmentType, driver, modelDef.id, brandId),
          p: protocol,
          ui: inferUiProfile(equipmentType, brandId, modelDef.id, modelDef.label, driver),
          cat: modelDef.id,
          eq: equipmentType,
          ...(equipmentType === 'label_printer' && !isBuiltinCatalogEntry(brandId, modelDef.id) ? { tag: 'label' } : {}),
          ...(equipmentType === 'receipt_printer' && !isBuiltinCatalogEntry(brandId, modelDef.id) && /impact|kitchen|sp742|srp275|giant/.test(`${modelDef.id} ${modelDef.label}`.toLowerCase())
            ? { tag: 'kitchen' }
            : {}),
          ...(isBuiltinCatalogEntry(brandId, modelDef.id) ? { tag: 'builtin' } : {}),
        });
      }
    }
  }
  items.sort((a, b) => a.m.localeCompare(b.m) || a.n.localeCompare(b.n));
  return items;
}

const items = buildLibrary();
const aioRegisterBuiltin = buildAioRegisterBuiltinMap();
const builtinModelIds = collectBuiltinCatalogModelIds();
const outPath = path.join(__dirname, '..', 'device-library-data.js');
const body = `/* Auto-generated from hmherbs posHardwareCatalog — run: npm run device-library */\nwindow.AIO_REGISTER_BUILTIN = ${JSON.stringify(aioRegisterBuiltin, null, 2)};\nwindow.BUILTIN_MODEL_IDS = ${JSON.stringify(builtinModelIds)};\nwindow.DEVICE_LIBRARY_DB = ${JSON.stringify(items, null, 2)};\n`;
fs.writeFileSync(outPath, body, 'utf8');
console.log(`Wrote ${items.length} devices to ${outPath}`);

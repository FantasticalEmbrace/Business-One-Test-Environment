/**
 * Live visual emulations for virtual POS hardware — profile-driven UI from device library.
 */
(function () {
  const uiState = {};

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function profile(st, slot) {
    return st.uiProfile || (slot && slot.ui) || 'generic';
  }

  const DEVICE_DIAGRAMS = {
    screen(hub) {
      const w = hub ? 200 : 150;
      const h = hub ? 118 : 88;
      return `<svg class="vh-device-svg" viewBox="0 0 150 88" width="${w}" height="${h}" aria-hidden="true">
        <rect x="18" y="6" width="114" height="68" rx="5" fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
        <rect x="24" y="12" width="102" height="56" rx="3" fill="#334155"/>
        <rect x="30" y="18" width="90" height="44" rx="2" fill="#0ea5e9" opacity=".18"/>
        <rect x="36" y="24" width="36" height="8" rx="2" fill="#64748b"/>
        <rect x="36" y="36" width="78" height="5" rx="1" fill="#475569"/>
        <rect x="36" y="45" width="58" height="5" rx="1" fill="#475569"/>
        <circle cx="118" cy="20" r="3" fill="#22c55e"/>
        <rect x="62" y="74" width="26" height="6" rx="2" fill="#64748b"/>
        <path d="M52 80h46v4H52z" fill="#475569"/>
        <rect x="44" y="84" width="62" height="4" rx="2" fill="#94a3b8"/>
      </svg>`;
    },
    printer(kitchen) {
      const accent = kitchen ? '#dc2626' : '#475569';
      return `<svg class="vh-device-svg" viewBox="0 0 150 88" aria-hidden="true">
        <rect x="28" y="8" width="94" height="18" rx="2" fill="#fff" stroke="#cbd5e1"/>
        <line x1="34" y1="14" x2="116" y2="14" stroke="#e2e8f0" stroke-width="2"/>
        <line x1="34" y1="19" x2="100" y2="19" stroke="#e2e8f0" stroke-width="2"/>
        <rect x="22" y="24" width="106" height="44" rx="6" fill="#334155" stroke="${accent}" stroke-width="${kitchen ? 3 : 2}"/>
        <rect x="30" y="32" width="90" height="10" rx="2" fill="#1e293b"/>
        <rect x="30" y="48" width="62" height="6" rx="1" fill="#64748b"/>
        <rect x="30" y="58" width="44" height="4" rx="1" fill="#64748b"/>
        <circle cx="118" cy="34" r="4" fill="#22c55e"/>
        <rect x="48" y="68" width="54" height="8" rx="2" fill="#475569"/>
        ${kitchen ? '<text x="75" y="42" text-anchor="middle" fill="#fca5a5" font-size="8" font-weight="700">KITCHEN</text>' : ''}
      </svg>`;
    },
    label() {
      return `<svg class="vh-device-svg" viewBox="0 0 150 88" aria-hidden="true">
        <rect x="20" y="18" width="110" height="52" rx="6" fill="#374151" stroke="#1f2937" stroke-width="2"/>
        <circle cx="34" cy="30" r="10" fill="#111827" stroke="#6b7280"/>
        <rect x="48" y="24" width="70" height="8" rx="2" fill="#4b5563"/>
        <rect x="58" y="8" width="52" height="16" rx="2" fill="#fff" stroke="#94a3b8" stroke-dasharray="3 2"/>
        <rect x="62" y="11" width="44" height="4" rx="1" fill="#e2e8f0"/>
        <rect x="62" y="17" width="28" height="3" rx="1" fill="#e2e8f0"/>
        <rect x="52" y="40" width="64" height="22" rx="2" fill="#f8fafc" stroke="#cbd5e1"/>
        <text x="84" y="54" text-anchor="middle" fill="#64748b" font-size="7" font-family="Consolas,monospace">LABEL</text>
      </svg>`;
    },
    terminal() {
      return `<svg class="vh-device-svg" viewBox="0 0 150 100" aria-hidden="true">
        <rect x="38" y="8" width="74" height="84" rx="10" fill="#111827" stroke="#374151" stroke-width="2"/>
        <rect x="46" y="16" width="58" height="42" rx="4" fill="#0f172a" stroke="#1e293b"/>
        <text x="75" y="34" text-anchor="middle" fill="#38bdf8" font-size="8" font-weight="700">READY</text>
        <text x="75" y="48" text-anchor="middle" fill="#64748b" font-size="7">Insert / Tap</text>
        <rect x="50" y="64" width="12" height="10" rx="2" fill="#374151"/>
        <rect x="66" y="64" width="12" height="10" rx="2" fill="#374151"/>
        <rect x="82" y="64" width="12" height="10" rx="2" fill="#374151"/>
        <rect x="50" y="78" width="12" height="10" rx="2" fill="#374151"/>
        <rect x="66" y="78" width="12" height="10" rx="2" fill="#374151"/>
        <rect x="82" y="78" width="12" height="10" rx="2" fill="#22c55e"/>
      </svg>`;
    },
    display() {
      return `<svg class="vh-device-svg" viewBox="0 0 150 88" aria-hidden="true">
        <rect x="34" y="10" width="82" height="34" rx="4" fill="#111827" stroke="#374151" stroke-width="2"/>
        <rect x="40" y="16" width="70" height="22" rx="2" fill="#052e16"/>
        <text x="75" y="26" text-anchor="middle" fill="#4ade80" font-size="8" font-family="Consolas,monospace">THANK YOU</text>
        <text x="75" y="36" text-anchor="middle" fill="#22c55e" font-size="7" font-family="Consolas,monospace">$12.45</text>
        <rect x="70" y="44" width="10" height="18" fill="#64748b"/>
        <ellipse cx="75" cy="68" rx="28" ry="8" fill="#94a3b8"/>
        <rect x="47" y="68" width="56" height="6" rx="3" fill="#cbd5e1"/>
      </svg>`;
    },
    drawer(open) {
      const trayY = open ? 2 : 8;
      const trayH = open ? 40 : 34;
      return `<svg class="vh-device-svg${open ? ' is-open' : ''}" viewBox="0 0 150 92" aria-hidden="true">
        <rect x="16" y="${trayY}" width="118" height="${trayH}" rx="3" fill="#e5e7eb" stroke="#9ca3af" stroke-width="1.5"/>
        <line x1="46" y1="${trayY}" x2="46" y2="${trayY + trayH}" stroke="#cbd5e1"/>
        <line x1="76" y1="${trayY}" x2="76" y2="${trayY + trayH}" stroke="#cbd5e1"/>
        <line x1="106" y1="${trayY}" x2="106" y2="${trayY + trayH}" stroke="#cbd5e1"/>
        <rect x="20" y="${trayY + 18}" width="24" height="14" rx="2" fill="#f3f4f6" stroke="#d1d5db"/>
        <circle cx="26" cy="${trayY + 25}" r="3" fill="#d1d5db"/><circle cx="34" cy="${trayY + 25}" r="3" fill="#d1d5db"/><circle cx="42" cy="${trayY + 25}" r="3" fill="#d1d5db"/>
        <rect x="16" y="42" width="118" height="44" rx="4" fill="#6b7280" stroke="#374151" stroke-width="2"/>
        <rect x="16" y="58" width="118" height="28" rx="0 0 4 4" fill="#374151"/>
        <rect x="58" y="52" width="34" height="10" rx="5" fill="#1f2937" stroke="#111827"/>
        <circle cx="28" cy="70" r="5" fill="#111827" stroke="#9ca3af"/>
        <circle cx="28" cy="70" r="2" fill="#6b7280"/>
        <text x="75" y="74" text-anchor="middle" fill="#9ca3af" font-size="7" font-weight="700">CASH DRAWER</text>
      </svg>`;
    },
    scanner() {
      return `<svg class="vh-device-svg" viewBox="0 0 150 88" aria-hidden="true">
        <path d="M34 58 L34 38 Q34 22 52 22 L98 22 Q118 22 118 38 L118 58 Q118 72 98 72 L52 72 Q34 72 34 58 Z" fill="#2563eb" stroke="#1d4ed8" stroke-width="2"/>
        <rect x="52" y="32" width="48" height="22" rx="3" fill="#1e3a8a" opacity=".45"/>
        <line x1="40" y1="48" x2="112" y2="48" stroke="#ef4444" stroke-width="2" opacity=".85"/>
        <rect x="28" y="62" width="96" height="14" rx="3" fill="#f1f5f9" stroke="#cbd5e1"/>
        <text x="76" y="72" text-anchor="middle" fill="#64748b" font-size="7" font-family="Consolas,monospace">|||||||||||</text>
      </svg>`;
    },
    scale(weight) {
      const w = weight != null ? String(weight) : '0.00';
      return `<svg class="vh-device-svg" viewBox="0 0 150 88" aria-hidden="true">
        <rect x="24" y="48" width="102" height="10" rx="3" fill="#9ca3af" stroke="#6b7280"/>
        <rect x="38" y="22" width="74" height="30" rx="5" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/>
        <rect x="46" y="30" width="58" height="14" rx="3" fill="#0f172a"/>
        <text x="75" y="40" text-anchor="middle" fill="#4ade80" font-size="10" font-weight="700" font-family="Consolas,monospace">${esc(w)} lb</text>
        <rect x="58" y="58" width="34" height="18" rx="3" fill="#e5e7eb" stroke="#cbd5e1"/>
        <circle cx="68" cy="67" r="3" fill="#64748b"/><circle cx="82" cy="67" r="3" fill="#64748b"/>
      </svg>`;
    },
  };

  function deviceDiagramSvg(deviceId, hub, opts) {
    const o = opts || {};
    switch (deviceId) {
      case 'screen':
        return DEVICE_DIAGRAMS.screen(hub);
      case 'printer':
        return DEVICE_DIAGRAMS.printer(false);
      case 'kitchen':
        return DEVICE_DIAGRAMS.printer(true);
      case 'label':
        return DEVICE_DIAGRAMS.label();
      case 'terminal':
        return DEVICE_DIAGRAMS.terminal();
      case 'display':
        return DEVICE_DIAGRAMS.display();
      case 'drawer':
        return DEVICE_DIAGRAMS.drawer(Boolean(o.open));
      case 'scanner':
        return DEVICE_DIAGRAMS.scanner();
      case 'scale':
        return DEVICE_DIAGRAMS.scale(o.weight);
      default:
        return `<svg class="vh-device-svg" viewBox="0 0 150 88" aria-hidden="true"><rect x="40" y="20" width="70" height="48" rx="6" fill="#e2e8f0" stroke="#94a3b8"/></svg>`;
    }
  }

  function deviceDiagramFrame(deviceId, slot, assigned, running) {
    const hub = deviceId === 'screen';
    const svg = deviceDiagramSvg(deviceId, hub);
    const title = assigned && slot.dev ? slot.dev : slot.name || deviceId;
    const sub = running ? 'Live' : assigned ? 'Assigned — press Start' : 'Select equipment below';
    const cls = assigned ? 'assigned' : 'unassigned';
    return `<div class="vh-device-diagram ${cls}${running ? ' live' : ''}${hub ? ' is-hub' : ''}">
      ${svg}
      <div class="vh-device-badge ${cls}"><strong>${esc(title)}</strong>${esc(sub)}</div>
    </div>`;
  }

  function ensureState(id) {
    if (!uiState[id]) uiState[id] = { state: 'idle' };
    return uiState[id];
  }

  function receiptHtml(st, id, ui) {
    const text = st.text || 'Waiting for print job…';
    const kitchen = id === 'kitchen' || ui === 'star-impact';
    const pp = ui === 'elo-paypoint-printer';
    const builtin = /-builtin-printer$/.test(ui);
    const bodyClass = pp ? 'dui-pp-builtin' : builtin ? `dui-builtin-printer dui-skin-${ui.replace('-builtin-printer', '')}` : kitchen ? 'dui-kitchen' : `dui-skin-${ui}`;
    return `<div class="dui-receipt ${bodyClass}">
      <div class="dui-printer-body">
        <div class="dui-printer-brand">${esc(st.manufacturer || 'Printer')}</div>
        <div class="dui-printer-model">${esc(st.model || '')}</div>
        <div class="dui-paper"><pre class="dui-paper-text">${esc(text)}</pre></div>
        <div class="dui-printer-led on"></div>
      </div>
      <div class="dui-caption">${st.jobs ? esc(String(st.jobs)) + ' job(s)' : 'Ready'}</div>
    </div>`;
  }

  function labelHtml(st, ui) {
    const preview = (st.preview || st.text || 'Label ready').slice(0, 120);
    const cls = ui === 'brother-label' ? 'dui-brother-label' : ui === 'dymo-label' ? 'dui-dymo-label' : 'dui-skin-zebra';
    return `<div class="dui-label ${cls}">
      <div class="dui-label-roll"></div>
      <div class="dui-label-sticker"><pre>${esc(preview)}</pre></div>
      <div class="dui-caption">${esc(st.manufacturer || '')} ${esc(st.model || '')}</div>
    </div>`;
  }

  function terminalScreen(st) {
    const state = st.terminalState || st.state || 'idle';
    const amount = st.amount != null ? '$' + Number(st.amount).toFixed(2) : '';
    if (state === 'processing') {
      return `<div class="dui-term-processing"><div class="dui-spinner"></div><div>${amount || 'Processing…'}</div><div class="dui-term-hint">Insert / Tap card</div></div>`;
    }
    if (state === 'approved') {
      return `<div class="dui-term-approved">&#10003; Approved<br><strong>${amount}</strong><br><span>VISA •••• 4242</span></div>`;
    }
    return '<div class="dui-term-idle">Ready</div>';
  }

  function terminalHtml(st, ui) {
    const mobile = /mobile|pinpad|sunmi-terminal/.test(ui);
    const unattended = ui === 'pax-unattended';
    const skin = ui.startsWith('pax') ? 'pax' : ui.startsWith('verifone') ? 'verifone' : ui.startsWith('ingenico') ? 'ingenico' : ui.startsWith('landi') ? 'landi' : ui.startsWith('dejavoo') ? 'dejavoo' : 'generic';
    const bodyClass = mobile ? 'dui-term-mobile' : unattended ? 'dui-term-unattended' : 'dui-term-counter';
    return `<div class="dui-terminal dui-skin-${skin} dui-profile-${ui} ${bodyClass}">
      <div class="dui-term-bezel">
        <div class="dui-term-screen">${terminalScreen(st)}</div>
        ${!mobile && !unattended ? '<div class="dui-term-keypad"><span></span><span></span><span></span><span></span><span></span><span></span></div>' : ''}
      </div>
      <div class="dui-caption">${esc(st.manufacturer || '')} ${esc(st.model || '')}</div>
    </div>`;
  }

  function displayHtml(st, ui) {
    if (ui === 'elo-paypoint-customer') {
      return `<div class="dui-paypoint-customer-front dui-paypoint-customer-standalone">
        <div class="dui-paypoint-customer-screen">${esc(st.line1 || 'Thank you')}<br>${esc(st.line2 || '')}</div>
        <div class="dui-paypoint-badge">CUSTOMER FACING</div>
        <div class="dui-caption">${esc(st.manufacturer || 'Elo')} ${esc(st.model || '')}</div>
      </div>`;
    }
    if (ui === 'sunmi-builtin-customer') {
      return `<div class="dui-elo-customer dui-sunmi-builtin-customer">
        <div class="dui-elo-customer-screen">${esc(st.line1 || 'Thank you')}<br>${esc(st.line2 || '')}</div>
        <div class="dui-paypoint-badge" style="color:#f97316">SUNMI · BUILT-IN</div>
        <div class="dui-caption">${esc(st.manufacturer || 'Sunmi')} ${esc(st.model || '')}</div>
      </div>`;
    }
    if (ui === 'landi-builtin-customer') {
      return `<div class="dui-elo-customer dui-landi-builtin-customer">
        <div class="dui-elo-customer-screen">${esc(st.line1 || 'Thank you')}<br>${esc(st.line2 || '')}</div>
        <div class="dui-paypoint-badge" style="color:#059669">LANDI · BUILT-IN</div>
        <div class="dui-caption">${esc(st.manufacturer || 'Landi')} ${esc(st.model || '')}</div>
      </div>`;
    }
    if (ui.startsWith('elo-customer')) {
      const small = ui.includes('7');
      return `<div class="dui-elo-customer ${small ? 'dui-pp7' : ''}">
        <div class="dui-elo-customer-screen">${esc(st.line1 || 'Thank you')}<br>${esc(st.line2 || '')}</div>
        <div class="dui-caption">${esc(st.manufacturer || 'Elo')} ${esc(st.model || '')}</div>
      </div>`;
    }
    return `<div class="dui-display dui-skin-display">
      <div class="dui-vfd">
        <div class="dui-vfd-line">${esc(st.line1 || 'WELCOME')}</div>
        <div class="dui-vfd-line">${esc(st.line2 || '')}</div>
      </div>
      <div class="dui-caption">${esc(st.manufacturer || 'Pole')} ${esc(st.model || '')}</div>
    </div>`;
  }

  function drawerHtml(st) {
    const open = st.drawerOpen;
    return `<div class="dui-drawer dui-skin-drawer live assigned">
      ${deviceDiagramSvg('drawer', false, { open })}
      <div class="dui-caption">${open ? 'OPEN' : 'Closed'}${st.kickCount ? ' · ' + st.kickCount + ' kick(s)' : ''}</div>
    </div>`;
  }

  function scannerHtml(st, ui) {
    const last = st.lastBarcode || '—';
    if (/presentation/.test(ui)) {
      return `<div class="dui-scanner dui-profile-${ui}">
        <div class="dui-presentation-scanner"><div class="dui-presentation-window"></div><div class="dui-scan-beam ${st.scanning ? 'on' : ''}"></div></div>
        <div class="dui-barcode-readout">${esc(last)}</div>
        <div class="dui-caption">${esc(st.manufacturer || '')} ${esc(st.model || '')}</div>
      </div>`;
    }
    const gunColor = ui === 'socket-bluetooth' ? '#6366f1' : '#2563eb';
    return `<div class="dui-scanner dui-profile-${ui}">
      <div class="dui-scanner-gun" style="background:${gunColor}">
        <div class="dui-scanner-window"></div>
        <div class="dui-scan-beam ${st.scanning ? 'on' : ''}"></div>
      </div>
      <div class="dui-barcode-readout">${esc(last)}</div>
      <div class="dui-caption">${esc(st.manufacturer || '')} ${esc(st.model || '')}</div>
    </div>`;
  }

  function paypointHtml(st, wide) {
    const customer = esc(st.customerLine1 || st.line1 || 'Thank you');
    return `<div class="dui-paypoint ${wide ? 'dui-pp22' : ''}">
      <div class="dui-paypoint-customer-front">
        <div class="dui-paypoint-customer-screen">${customer}</div>
      </div>
      <div class="dui-paypoint-shell">
        <div class="dui-paypoint-screen">Business One POS<br><small>${esc(st.model || 'PayPoint')}</small></div>
        <div class="dui-paypoint-printer-slot"></div>
      </div>
      <div class="dui-paypoint-badge">ELO PAYPOINT</div>
      <div class="dui-caption">${esc(st.manufacturer || 'Elo')} ${esc(st.model || '')}</div>
    </div>`;
  }

  function monitorHtml(st, ui) {
    const tall = /22|24|2494/.test(ui + st.model);
    const mid = /17/.test(ui + st.model);
    const h = tall ? 88 : mid ? 76 : 64;
    const skin = ui.replace('elo-monitor-', 'elo-') || 'generic';
    return `<div class="dui-pos-screen dui-skin-${skin} dui-profile-${ui}">
      <div class="dui-monitor">
        <div class="dui-monitor-screen" style="min-height:${h}px">
          <div class="dui-pos-placeholder">POS Register<br><small>${esc(st.manufacturer || '')} ${esc(st.model || '')}</small></div>
        </div>
        <div class="dui-monitor-stand"></div>
      </div>
      <div class="dui-caption">Touchscreen — use Live POS View</div>
    </div>`;
  }

  function androidAioHtml(st, ui) {
    const brand = ui === 'sunmi-aio' ? 'SUNMI' : ui === 'landi-aio' ? 'LANDI' : 'AIO';
    return `<div class="dui-pos-screen dui-profile-${ui}">
      <div class="dui-monitor dui-elo-mobile">
        <div class="dui-monitor-screen" style="min-height:90px">
          <div class="dui-pos-placeholder">${brand} Android POS<br><small>${esc(st.model || '')}</small></div>
        </div>
        <div class="dui-aio-base"></div>
      </div>
      <div class="dui-caption">${esc(st.manufacturer || '')} ${esc(st.model || '')}</div>
    </div>`;
  }

  function screenHtml(st, ui) {
    if (ui.startsWith('elo-paypoint')) return paypointHtml(st, ui.includes('22'));
    if (ui === 'elo-mobile' || ui === 'elo-tablet-10') {
      return `<div class="dui-pos-screen dui-profile-${ui}">
        <div class="dui-monitor dui-elo-mobile" style="max-width:110px">
          <div class="dui-monitor-screen" style="min-height:100px;border-radius:12px">
            <div class="dui-pos-placeholder">Elo Mobile<br><small>${esc(st.model || '')}</small></div>
          </div>
        </div>
        <div class="dui-caption">${esc(st.manufacturer || 'Elo')} ${esc(st.model || '')}</div>
      </div>`;
    }
    if (ui === 'sunmi-aio' || ui === 'landi-aio' || ui === 'hp-engage' || ui === 'posiflex-aio' || ui === 'aures-aio') {
      return androidAioHtml(st, ui);
    }
    if (ui.startsWith('elo-monitor') || ui === 'generic-monitor') return monitorHtml(st, ui);
    return monitorHtml(st, 'elo-monitor-15');
  }

  function scaleHtml(st) {
    const w = st.weight != null ? Number(st.weight).toFixed(2) : '0.00';
    return `<div class="dui-scale dui-skin-scale live assigned">
      ${deviceDiagramSvg('scale', false, { weight: w })}
      <div class="dui-caption">${esc(st.manufacturer || 'CAS')} ${esc(st.model || '')}</div>
    </div>`;
  }

  function placeholderVisual(deviceId, slotName) {
    return deviceDiagramFrame(deviceId, { name: slotName || deviceId }, false, false);
  }

  function renderDiagramVisual(deviceId, slot, info) {
    const assigned = Boolean(slot && slot.libKey);
    const running = Boolean(slot && slot.on);
    if (running) {
      return buildVisualInner(deviceId, slot, info);
    }
    return deviceDiagramFrame(deviceId, slot || { name: deviceId }, assigned, false);
  }

  function applyBridgeState(st, slot, info) {
    if (slot && slot.ui) st.uiProfile = slot.ui;
    if (info && info.credentials) {
      st.manufacturer = info.credentials.manufacturer || st.manufacturer;
      st.model = info.credentials.model || st.model;
    }
    if (info && info.stats) {
      if (info.stats.line1 !== undefined) {
        st.line1 = info.stats.line1;
        st.line2 = info.stats.line2;
      }
      if (info.stats.isOpen !== undefined) st.drawerOpen = info.stats.isOpen;
      if (info.stats.lastPrintPreview) st.text = info.stats.lastPrintPreview;
      if (info.stats.lastLabelPreview) {
        st.preview = info.stats.lastLabelPreview;
        st.text = info.stats.lastLabelPreview;
      }
      if (info.stats.jobsProcessed != null) st.jobs = info.stats.jobsProcessed;
    }
    st.slotName = slot ? slot.name : st.slotName || '';
  }

  function buildVisualInner(deviceId, slot, info) {
    const st = ensureState(deviceId);
    applyBridgeState(st, slot, info);
    const ui = profile(st, slot);

    switch (deviceId) {
      case 'printer':
      case 'kitchen':
        return receiptHtml(st, deviceId, ui);
      case 'label':
        return labelHtml(st, ui);
      case 'terminal':
        return terminalHtml(st, ui);
      case 'display':
        return displayHtml(st, ui);
      case 'drawer':
        return drawerHtml(st);
      case 'scanner':
        return scannerHtml(st, ui);
      case 'screen':
        return screenHtml(st, ui);
      case 'scale':
        return scaleHtml(st);
      default:
        return `<div class="dui-generic">${esc(st.slotName || deviceId)}</div>`;
    }
  }

  function renderPanel(deviceId, slot, info) {
    const st = ensureState(deviceId);
    applyBridgeState(st, slot, info);
    const inner = buildVisualInner(deviceId, slot, info);
    return `<div class="dui-panel" id="vhui-panel-${deviceId}" data-device="${deviceId}">
      <div class="dui-panel-title">${esc(st.slotName)}</div>
      <div class="dui-panel-body">${inner}</div>
    </div>`;
  }

  function updatePanel(deviceId) {
    const el = document.getElementById('vhui-' + deviceId);
    if (!el) return;
    const slot = window.__vhSlots && window.__vhSlots.find((s) => s.id === deviceId);
    const info = window.__vhBridgeInfo && window.__vhBridgeInfo[deviceId];
    el.innerHTML = renderDiagramVisual(deviceId, slot, info);
  }

  function refreshAllVisuals(slots, bridgeInfo) {
    window.__vhSlots = slots || [];
    window.__vhBridgeInfo = bridgeInfo || {};
    (slots || []).forEach((slot) => {
      const el = document.getElementById('vhui-' + slot.id);
      if (el) el.innerHTML = renderDiagramVisual(slot.id, slot, bridgeInfo[slot.id]);
    });
  }

  function handleEvent(ev) {
    if (!ev || ev.type !== 'device-ui') return;
    const id = ev.deviceId;
    const st = ensureState(id);
    const t = ev.uiType;
    const p = ev.payload || {};

    if (t === 'print') {
      st.text = p.text || st.text;
      st.jobs = p.jobNumber || st.jobs;
    } else if (t === 'label') {
      st.preview = p.preview;
      st.text = p.preview;
    } else if (t === 'display') {
      st.line1 = p.line1;
      st.line2 = p.line2;
    } else if (t === 'drawer-open') {
      st.drawerOpen = true;
      st.kickCount = p.kickCount || st.kickCount;
    } else if (t === 'drawer-closed') {
      st.drawerOpen = false;
    } else if (t === 'terminal') {
      st.terminalState = p.state;
      if (p.amount != null) st.amount = p.amount;
    } else if (t === 'sale') {
      st.terminalState = 'approved';
      st.amount = p.amount;
    } else if (t === 'scan') {
      st.lastBarcode = p.barcode;
      st.scanning = true;
      setTimeout(() => {
        st.scanning = false;
        updatePanel(id);
      }, 600);
    }

    updatePanel(id);
  }

  function renderStage(slots, bridgeInfo) {
    refreshAllVisuals(slots, bridgeInfo);
  }

  function resetDevice(deviceId) {
    delete uiState[deviceId];
  }

  function resetAll() {
    Object.keys(uiState).forEach((k) => delete uiState[k]);
  }

  window.DeviceUI = {
    handleEvent,
    renderStage,
    renderDiagramVisual,
    refreshAllVisuals,
    resetDevice,
    resetAll,
    profile,
  };
})();

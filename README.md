# Business One Test Environment

Universal POS peripheral and backend testing desktop application for Windows. Tests **any** point-of-sale software — not tied to a specific POS vendor.

## Features

- **Virtual hardware bridge** — emulates receipt printers (ESC/POS on port 9100), kitchen printers, label printers (ZPL), payment terminals (JSON on port 8443), cash drawers, barcode scanners, customer displays, and scales
- **216-device library** — universal open peripherals (Epson, Star, PAX, Verifone, Elo, Sunmi, Honeywell, Zebra, etc.) plus network routers (Cradlepoint, Peplink, Digi)
- **Live POS view** — embed web/cloud POS in iframe; launch Windows `.exe` apps; Android/iOS profiles
- **Network simulation** — failover, latency injection, packet loss (Business One styled UI)
- **Test runner** — peripheral protocol validation, backend config checks, network resilience tests
- **Protocol validation** — catches invalid ESC/POS sequences (e.g. cut before init), validates terminal sale requests, ZPL structure

## Requirements

- Windows 10/11 (x64)
- Node.js 18+ (for development/build only)

## Quick Start (Development)

```bash
npm install
npm start
```

## Build Windows Installer

```bash
npm install
npm run build
```

Output: `dist/BusinessOneTestEnvironment-Setup-1.0.0.exe`

## Bridge Service Ports

| Service | Address |
|---------|---------|
| HTTP API | `http://127.0.0.1:9780/api/health` |
| WebSocket | `ws://127.0.0.1:9781` |
| Receipt printer | `127.0.0.1:9100` (raw ESC/POS) |
| Kitchen printer | `127.0.0.1:9101` |
| Label printer | `127.0.0.1:9102` (ZPL) |
| Payment terminal | `127.0.0.1:8443` (JSON lines) |

Point your POS printer settings at `127.0.0.1:9100` to test receipt output through the bridge.

## Testing Your POS Backend Equipment Config

1. Open **Device Library** and find your hardware model
2. Click **Validate sample config** to check required fields match your backend's equipment settings
3. Configure your POS under **POS Connection** with your local URL (e.g. `http://localhost:3000`)
4. Run **Test Runner → Full Suite** to validate peripherals and backend connectivity

## Regenerate Device Library

After updating `hmherbs-main/backend/services/posHardwareCatalog.js`:

```bash
npm run export-devices
```

## License

Proprietary — Business One

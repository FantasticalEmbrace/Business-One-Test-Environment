'use strict';
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'business-one-test-environment.html');
let h = fs.readFileSync(p, 'utf8');
const start = h.indexOf('<script src="device-ui.js"></script>');
const end = h.indexOf('const PS=20');
if (start < 0 || end < 0) throw new Error('markers not found');
const head = h.slice(0, start);
const tail = h.slice(end);
const mid = `<script src="device-library-data.js"></script>
<script src="device-ui.js"></script>
<script>
const DB=(window.DEVICE_LIBRARY_DB||[]).slice();
`;
fs.writeFileSync(p, head + mid + tail);
console.log('Patched HTML — removed inline device arrays');

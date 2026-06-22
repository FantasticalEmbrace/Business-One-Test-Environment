'use strict';

const fs = require('fs');
const path = require('path');
const rcedit = require('rcedit');

const distDir = path.join(__dirname, '..', 'dist', 'win-unpacked');
const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');

async function embedIcon(exePath) {
  if (!fs.existsSync(exePath)) return;
  await rcedit(exePath, { icon: iconPath });
  console.log('Embedded icon into', exePath);
}

async function main() {
  if (!fs.existsSync(iconPath)) {
    throw new Error('Missing assets/icon.ico — run npm run icons first');
  }

  const targets = fs.readdirSync(distDir).filter((name) => name.endsWith('.exe'));
  if (!targets.length) {
    throw new Error('No .exe files in dist/win-unpacked');
  }

  for (const name of targets) {
    await embedIcon(path.join(distDir, name));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

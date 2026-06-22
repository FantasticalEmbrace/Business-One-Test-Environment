'use strict';

const fs = require('fs');
const path = require('path');
const toIco = require('to-ico');
const sharp = require('sharp');

const assets = path.join(__dirname, '..', 'assets');
const logoPath = path.join(assets, 'logo-big.png');
const iconPng = path.join(assets, 'icon.png');
const iconIco = path.join(assets, 'icon.ico');

async function squareIconPng(sourceBuffer, size) {
  const trimmed = await sharp(sourceBuffer).trim().toBuffer();
  const inner = Math.max(16, Math.round(size * 0.9));
  const logo = await sharp(trimmed)
    .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(logoPath)) {
    throw new Error('Missing assets/logo-big.png');
  }

  const source = fs.readFileSync(logoPath);
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = await Promise.all(sizes.map((size) => squareIconPng(source, size)));

  await fs.promises.writeFile(iconPng, pngBuffers[pngBuffers.length - 1]);

  const ico = await toIco(pngBuffers);
  fs.writeFileSync(iconIco, ico);
  console.log('Built assets/icon.ico and assets/icon.png from logo-big.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

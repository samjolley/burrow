// Run once after any icon.svg change:  node make-icons.mjs
// ponytail: borrows sharp from a neighbouring project rather than adding
// node_modules + package.json + a lockfile to a repo with no build step.
// If D:\sites\samjolley-site is ever deleted, `npx sharp-cli` is the fallback.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire('D:/sites/samjolley-site/');
const sharp = require('sharp');

const svg = readFileSync(new URL('./icon.svg', import.meta.url));

if (/<text|<tspan|font-family|@font-face/.test(svg.toString())) {
  throw new Error('icon.svg contains text or fonts. librsvg renders system-ui as serif — convert to paths.');
}

for (const [file, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  const png = await sharp(svg, { density: 512 })   // libvips rasterizes at a DPI, not a
    .resize(size, size, { fit: 'cover' })          // target size: render high, downscale.
    .flatten({ background: '#F2E6D8' })            // iOS composites alpha against BLACK.
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(new URL(`./${file}`, import.meta.url), png);
  console.log(file, size + 'px', png.length, 'bytes');
}

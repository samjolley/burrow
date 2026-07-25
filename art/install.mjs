// Swap a creature delivery into the app.  node art/install.mjs <a|b|c>
// Then regenerate the icons:              node make-icons.mjs
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';   // not URL.pathname: on Windows that yields /D:/...

const letter = process.argv[2];
if (!letter || !'abc'.includes(letter)) throw new Error('usage: node art/install.mjs <a|b|c>');

// Each delivery ships its own palette; the creature paints entirely in var(--*),
// so swapping art means swapping these eight values too.
const PALETTES = {
  a: { fur: '#9DBB8A', 'fur-shade': '#82A171', ink: '#33291F', blush: '#E2957E',
       blanket: '#C4886A', accent: '#E8A33D', 'accent-2': '#C96F3F', shadow: '#DCC7AF' },
  b: { fur: '#9C7C61', 'fur-shade': '#E4CBA9', ink: '#3A2E28', blush: '#E39A8B',
       blanket: '#B4695A', accent: '#E0A458', 'accent-2': '#7C9A6B', shadow: '#C9B39A' },
  c: { fur: '#C9BCA6', 'fur-shade': '#A6957C', ink: '#3A3129', blush: '#D08D74',
       blanket: '#C07E63', accent: '#E3A24F', 'accent-2': '#7C9A63', shadow: '#BFAE95' },
};

const here = fileURLToPath(new URL('.', import.meta.url));
const app = fileURLToPath(new URL('..', import.meta.url));

const creature = readFileSync(`${here}${letter}/creature.svg`, 'utf8')
  .replace(/<\?xml[^>]*\?>\s*/, '')
  .trim()
  .split('\n').map((l) => '      ' + l.trimEnd()).join('\n').trimStart();

let html = readFileSync(`${app}index.html`, 'utf8');

const start = html.indexOf('<svg id="pet"');
const end = html.indexOf('</svg>', start) + '</svg>'.length;
if (start < 0) throw new Error('could not locate the creature <svg> block in index.html');
html = html.slice(0, start) + creature + html.slice(end);

for (const [k, v] of Object.entries(PALETTES[letter])) {
  const re = new RegExp(`(:root \\{[\\s\\S]*?--${k}: )#[0-9A-Fa-f]{6}`);
  if (!re.test(html)) throw new Error(`could not reseed --${k}`);
  html = html.replace(re, `$1${v}`);
}

writeFileSync(`${app}index.html`, html);
copyFileSync(`${here}${letter}/icon.svg`, `${app}icon.svg`);
console.log(`installed art/${letter}. Now run: node make-icons.mjs`);
console.log('Then bump CACHE in sw.js and BUILD in index.html before deploying.');

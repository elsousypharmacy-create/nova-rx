// UX5: UI text floor of 12px. Scans CSS (and inline style) font sizes in the UI files.
// Printed sticker preview/print rules (pt units, .sticker-face, printPage) are exempt.
import fs from 'node:fs';
const FILES = ['index.html', 'sticker-studio.html', 'purchases.css'];
const FLOOR = 12;
const EXEMPT = /sticker-face|sticker-preview|function printPage|@page/;
const bad = [];
for (const f of FILES) {
  const root = new URL('../../' + f, import.meta.url);
  if (!fs.existsSync(root)) continue;
  fs.readFileSync(root, 'utf8').split('\n').forEach((line, i) => {
    if (EXEMPT.test(line)) return;
    for (const m of line.matchAll(/font-size\s*:\s*([0-9.]+)px|font\s*:[^;}]*?\b([0-9.]+)px/g)) {
      const v = parseFloat(m[1] ?? m[2]);
      if (v > 0 && v < FLOOR) bad.push(`${f}:${i + 1} ${m[0]}`);
    }
  });
}
if (bad.length) { console.error(`FAIL: ${bad.length} font size(s) < ${FLOOR}px\n` + bad.join('\n')); process.exit(1); }
console.log(`ok min-font: no UI font-size < ${FLOOR}px in ${FILES.join(', ')}`);

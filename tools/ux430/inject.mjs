#!/usr/bin/env node
// UX430: (re)insert the WhatsApp KPIs block (Home card + KPIs page) into an app HTML file, just before </body>.
// The KPI maths are the BEGIN/END-KPI-SHARED block of backend/src/wa-kpis.js, copied verbatim (tests check identity).
// Usage: node tools/ux430/inject.mjs FILE.html [FILE2.html ...]   (idempotent: replaces an existing UX430 block)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const src = fs.readFileSync(here('../../backend/src/wa-kpis.js'), 'utf8');
const a = src.indexOf('// BEGIN-KPI-SHARED'), b = src.indexOf('// END-KPI-SHARED');
if (a < 0 || b < 0) throw new Error('KPI shared block markers not found');
const shared = src.slice(a, b + '// END-KPI-SHARED'.length);
const css = fs.readFileSync(here('./wa-kpis.css'), 'utf8').trim();
const ui = fs.readFileSync(here('./wa-kpis.ui.js'), 'utf8').trim();
for (const part of [css, shared, ui]) if (/<\/(script|style)/i.test(part)) throw new Error('block contains a closing tag');
const BEGIN = '<!-- UX430:BEGIN WhatsApp KPIs -->', END = '<!-- UX430:END -->';
const block = BEGIN + '\n<style id="UX430_WA_KPI_CSS">\n' + css + '\n</style>\n<script id="UX430_WA_KPI">\n(function(){\n"use strict";\n' + shared + '\n' + ui + '\n})();\n</script>\n' + END;

for (const file of process.argv.slice(2)) {
  let html = fs.readFileSync(file, 'utf8');
  const i = html.indexOf(BEGIN), j = html.indexOf(END);
  if (i >= 0 && j > i) html = html.slice(0, i) + html.slice(j + END.length).replace(/^\n/, '');
  const k = html.lastIndexOf('</body>');
  if (k < 0) throw new Error(file + ': </body> not found');
  html = html.slice(0, k) + block + '\n' + html.slice(k);
  fs.writeFileSync(file, html);
  console.log('ux430 block ->', file, block.length, 'chars');
}

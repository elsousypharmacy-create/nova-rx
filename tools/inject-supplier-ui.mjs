#!/usr/bin/env node
// Packs the supplier lookup UI INTO one HTML file (the Worker serves a single page).
// Works on repo index.html and on the HTML extracted from a live Worker artifact:
// any existing <link>/<script> tags for the supplier files are removed first.
// Usage: node tools/inject-supplier-ui.mjs IN.html OUT.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// The UI model is an ES module that imports normalize.js. Each module is wrapped in its own
// function so helper names (round2, ...) cannot collide, and its exports are returned.
function wrapModule(src, label) {
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/gm)].map((m) => m[1]);
  if (!names.length) throw new Error(`${label} has no exports`);
  const body = src.replace(/^export\s+/gm, '');
  if (/^import\s/m.test(body.replace(/^import \{[^}]*\} from '\.\/normalize\.js';\s*$/m, ''))) {
    throw new Error(`${label} has an import this tool does not know how to inline`);
  }
  return { names, body };
}
const norm = wrapModule(read('worker/procurement/normalize.js'), 'normalize.js');
const model = wrapModule(read('worker/procurement/ui-model.js'), 'ui-model.js');
const modelBody = model.body.replace(/^import \{([^}]*)\} from '\.\/normalize\.js';\s*$/m, 'const {$1} = NOVA_NORMALIZE;');
const modelInline =
  `const NOVA_NORMALIZE = (function () {\n${norm.body}\nreturn { ${norm.names.join(', ')} };\n})();\n` +
  `window.NOVA_UI_MODEL = (function () {\n${modelBody}\nreturn { ${model.names.join(', ')} };\n})();\n`;

let lookup = read('supplier-lookup.js');
const importLine = /import\('\.\/worker\/procurement\/ui-model\.js'\)\.then\(function \(m\) \{ modelApi = m; \}\)\.catch\(function \(\) \{\}\);/;
if (!importLine.test(lookup)) throw new Error('supplier-lookup.js import line changed; update this tool');
lookup = lookup.replace(importLine, 'modelApi = window.NOVA_UI_MODEL;');

const css = read('supplier-lookup.css');
const provider = read('supplier-provider.js');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const block =
  '\n<style id="nova-supplier-css">\n' + css + '\n</style>\n' +
  '<script id="nova-supplier-model">\n(function(){\n' + safe(modelInline) + '\n})();\n</script>\n' +
  '<script id="nova-supplier-provider">\n' + safe(provider) + '\n</script>\n' +
  '<script id="nova-supplier-lookup">\n' + safe(lookup) + '\n</script>\n';

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) throw new Error('Usage: node tools/inject-supplier-ui.mjs IN.html OUT.html');
let html = fs.readFileSync(inFile, 'utf8');
html = html
  .replace(/<link[^>]*supplier-lookup\.css[^>]*>\s*/g, '')
  .replace(/<script[^>]*src="supplier-(?:lookup|provider)\.js"[^>]*><\/script>\s*/g, '')
  .replace(/<style id="nova-supplier-css">[\s\S]*?<\/style>\s*/g, '')
  .replace(/<script id="nova-supplier-(?:model|provider|lookup)">[\s\S]*?<\/script>\s*/g, '');
const at = html.lastIndexOf('</body>');
if (at < 0) throw new Error('no </body> in input');
fs.writeFileSync(outFile, html.slice(0, at) + block + html.slice(at));
console.log(`injected supplier UI: ${block.length} chars into ${path.basename(outFile)}`);

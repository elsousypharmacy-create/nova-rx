#!/usr/bin/env node
// PERF-02: index.html is a small shell; the big inline <script>/<style> blocks live in app/NNN-<slug>.js|css (the
// files you edit) and are served as content-hashed copies assets/app-NNN-<slug>.<hash>.js|css (generated, cacheable
// for a year, precached by sw.js). Script order and semantics are unchanged: every block is a classic, parser-blocking
// <script src> (or <link rel=stylesheet>) at exactly the place where the inline block was.
//
//   node tools/split-index.mjs              rebuild: re-hash app/*, rewrite the tags in index.html, regenerate
//                                           assets/app-*, drop stale assets/app-*, rewrite the sw.js precache list
//   node tools/split-index.mjs --check      exit 1 if index.html / assets / sw.js are not in sync with app/ (CI)
//   node tools/split-index.mjs --join [OUT] print (or write) the old single-file page: shell with every block inlined
//   node tools/split-index.mjs --extract    one-time migration: move big inline blocks of index.html into app/
//
// Adding a new block: create app/NNN-name.js (or .css) and put
//   <script src="/assets/app-NNN-name.0.js"></script>   (or <link rel="stylesheet" href="/assets/app-NNN-name.0.css">)
// where it must run, then run the rebuild. Small inline blocks in index.html are fine as well.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = 'app';
const OUT_DIR = 'assets';
const MIN_BYTES = 1024; // --extract: smaller blocks stay inline
// --extract: boot code that must stay inline (runs before anything is fetched: staff lock, splash, theme)
const KEEP_INLINE = new Set(['NOVA_STAFF_PRELOCK', 'NOVA_STAFF_GATE_CSS', 'NOVA_SPLASH', 'NOVA_THEME_JS', 'NOVA_THEME_CSS']);

// <script ATTRS src="/assets/app-NAME.HASH.js"></script>  |  <link rel="stylesheet" ATTRS href="/assets/app-NAME.HASH.css">
// | <link rel="prefetch" as="script" ATTRS href="/assets/app-NAME.HASH.js">  (RCV01 lazy block: downloaded in the background and
//   precached, but run only by the lazy loader in app/548-nova-providers.js when its page opens or the app is idle)
// | <link rel="prefetch" as="style" ATTRS href="/assets/app-NAME.HASH.css">  (startup diet CSS: same, attached as a stylesheet by
//   app/548 just before the lazy scripts run)
export const TAG_RE = /<script((?: [a-z-]+="[^"]*")*) src="\/assets\/app-([0-9]{3}-[a-z0-9-]+)\.([0-9a-f]+)\.js"><\/script>|<link rel="stylesheet"((?: [a-z-]+="[^"]*")*) href="\/assets\/app-([0-9]{3}-[a-z0-9-]+)\.([0-9a-f]+)\.css">|<link rel="prefetch" as="script"((?: [a-z-]+="[^"]*")*) href="\/assets\/app-([0-9]{3}-[a-z0-9-]+)\.([0-9a-f]+)\.js">|<link rel="prefetch" as="style"((?: [a-z-]+="[^"]*")*) href="\/assets\/app-([0-9]{3}-[a-z0-9-]+)\.([0-9a-f]+)\.css">/g;

export const hashOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const rd = (root, f) => fs.readFileSync(path.join(root, f), 'utf8');

/** Every split tag of the shell: { kind, attrs, name, hash, src, file, at, len } */
export function splitTags(shell) {
  const out = [];
  for (const m of shell.matchAll(TAG_RE)) {
    const lazyCss = m[11] !== undefined;
    const lazy = m[8] !== undefined || lazyCss;
    const js = m[2] !== undefined || m[8] !== undefined;
    const name = lazyCss ? m[11] : m[8] !== undefined ? m[8] : js ? m[2] : m[5];
    const hash = lazyCss ? m[12] : m[8] !== undefined ? m[9] : js ? m[3] : m[6];
    const ext = js ? 'js' : 'css';
    out.push({ kind: ext, lazy, attrs: lazyCss ? m[10] : m[8] !== undefined ? m[7] : js ? m[1] : m[4], name, hash, src: `${SRC_DIR}/${name}.${ext}`, file: `${OUT_DIR}/app-${name}.${hash}.${ext}`, at: m.index, len: m[0].length });
  }
  return out;
}

const tagFor = (kind, attrs, name, hash, lazy) => lazy
  ? kind === 'js'
    ? `<link rel="prefetch" as="script"${attrs} href="/assets/app-${name}.${hash}.js">`
    : `<link rel="prefetch" as="style"${attrs} href="/assets/app-${name}.${hash}.css">`
  : kind === 'js'
    ? `<script${attrs} src="/assets/app-${name}.${hash}.js"></script>`
    : `<link rel="stylesheet"${attrs} href="/assets/app-${name}.${hash}.css">`;

/** Shell with every split tag replaced by the inline block it came from (byte-identical to the pre-split page). */
export function joinHtml(shell, root = ROOT) {
  let s = String(shell);
  if (!s.includes('/assets/app-')) return s;
  return s.replace(TAG_RE, (all, ja, jn, jh, ca, cn, ch, la, ln, lh, sa, sn) => {
    // a lazy block joins as an ordinary inline script/style (the single-file page simply runs it eagerly)
    if (ln !== undefined) return `<script${la}>${rd(root, `${SRC_DIR}/${ln}.js`)}</script>`;
    if (sn !== undefined) return `<style${sa}>${rd(root, `${SRC_DIR}/${sn}.css`)}</style>`;
    const js = jn !== undefined;
    const body = rd(root, `${SRC_DIR}/${js ? jn : cn}.${js ? 'js' : 'css'}`);
    return js ? `<script${ja}>${body}</script>` : `<style${ca}>${body}</style>`;
  });
}

/** Text that tests grep: index.html joined with its split files. Accepts a path (default index.html). */
export function readAppHtml(file = path.join(ROOT, 'index.html')) {
  return joinHtml(fs.readFileSync(file instanceof URL ? fileURLToPath(file) : file, 'utf8'));
}

/** Expected state from app/ + the shell: { shell, assets: Map(file -> body), sw } */
export function build(root = ROOT) {
  const shell0 = rd(root, 'index.html');
  const tags = splitTags(shell0);
  const assets = new Map();
  let shell = '', last = 0;
  for (const t of tags) {
    const body = fs.readFileSync(path.join(root, t.src));
    const h = hashOf(body);
    const file = `${OUT_DIR}/app-${t.name}.${h}.${t.kind}`;
    if (assets.has(file)) throw new Error('block used twice: ' + t.src);
    assets.set(file, body);
    shell += shell0.slice(last, t.at) + tagFor(t.kind, t.attrs, t.name, h, t.lazy);
    last = t.at + t.len;
  }
  shell += shell0.slice(last);
  const list = [...assets.keys()].map(f => '/' + f);
  const ver = hashOf(list.join('\n'));
  let sw = rd(root, 'sw.js');
  const line = `const NOVA_APP_ASSETS=${JSON.stringify(list)};`;
  const swLines = sw.split('\n');
  if (!/^const NOVA_APP_ASSETS=/.test(swLines[0])) swLines.unshift(line); else swLines[0] = line;
  sw = swLines.join('\n').replace(/const CACHE='nova-rx-shell-v[^']*'/, `const CACHE='nova-rx-shell-v7-${ver}'`);
  if (!sw.includes(`nova-rx-shell-v7-${ver}`)) throw new Error('sw.js CACHE constant not found');
  return { shell, assets, sw };
}

function staleAssets(root, keep) {
  const dir = path.join(root, OUT_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^app-.*\.(js|css)$/.test(f)).map(f => `${OUT_DIR}/${f}`).filter(f => !keep.has(f));
}

export function check(root = ROOT) {
  const { shell, assets, sw } = build(root);
  const errs = [];
  if (rd(root, 'index.html') !== shell) errs.push('index.html tags do not match app/ (run: node tools/split-index.mjs)');
  for (const [f, body] of assets) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) errs.push('missing ' + f);
    else if (!fs.readFileSync(p).equals(body)) errs.push('stale ' + f);
  }
  for (const f of staleAssets(root, new Set(assets.keys()))) errs.push('unreferenced ' + f);
  if (rd(root, 'sw.js') !== sw) errs.push('sw.js precache list / CACHE version out of date');
  const used = new Set(splitTags(shell).map(t => t.src));
  if (fs.existsSync(path.join(root, SRC_DIR))) for (const f of fs.readdirSync(path.join(root, SRC_DIR))) if (/\.(js|css)$/.test(f) && !used.has(`${SRC_DIR}/${f}`)) errs.push(`${SRC_DIR}/${f} is not used by index.html`);
  return errs;
}

export function write(root = ROOT) {
  const { shell, assets, sw } = build(root);
  fs.mkdirSync(path.join(root, OUT_DIR), { recursive: true });
  for (const [f, body] of assets) fs.writeFileSync(path.join(root, f), body);
  for (const f of staleAssets(root, new Set(assets.keys()))) fs.unlinkSync(path.join(root, f));
  fs.writeFileSync(path.join(root, 'index.html'), shell);
  fs.writeFileSync(path.join(root, 'sw.js'), sw);
  return { shell, assets };
}

/** Raw-text aware scan of inline <script>/<style> blocks (skips comments). */
export function inlineBlocks(html) {
  const out = [];
  const re = /<!--|<(script|style)(\s[^>]*)?>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[0] === '<!--') { const e = html.indexOf('-->', m.index + 4); if (e < 0) break; re.lastIndex = e + 3; continue; }
    const tag = m[1].toLowerCase();
    const close = html.toLowerCase().indexOf('</' + tag, re.lastIndex);
    if (close < 0) throw new Error('unclosed <' + tag + '>');
    const closeEnd = html.indexOf('>', close) + 1;
    out.push({ tag, attrs: m[2] || '', start: m.index, bodyStart: re.lastIndex, bodyEnd: close, end: closeEnd });
    re.lastIndex = closeEnd;
  }
  return out;
}

export function extract(root = ROOT) {
  const html = rd(root, 'index.html');
  if (html.includes('/assets/app-')) throw new Error('index.html is already split');
  const blocks = inlineBlocks(html);
  let out = '', last = 0, n = 0;
  fs.mkdirSync(path.join(root, SRC_DIR), { recursive: true });
  for (const b of blocks) {
    const body = html.slice(b.bodyStart, b.bodyEnd);
    const id = (b.attrs.match(/\sid="([^"]+)"/) || [])[1] || '';
    if (/\ssrc=/.test(b.attrs) || /\stype=/.test(b.attrs) || Buffer.byteLength(body) < MIN_BYTES || KEEP_INLINE.has(id)) continue;
    if (!/^((?: [a-z-]+="[^"]*")*)$/.test(b.attrs)) throw new Error('unexpected attributes: ' + b.attrs);
    if (html.slice(b.bodyEnd, b.end) !== '</' + b.tag + '>') throw new Error('unexpected close tag at ' + b.bodyEnd);
    n += 10;
    const kind = b.tag === 'script' ? 'js' : 'css';
    const slug = (id ? id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '') || (kind === 'js' ? 'script' : 'style');
    const name = String(n).padStart(3, '0') + '-' + slug;
    fs.writeFileSync(path.join(root, `${SRC_DIR}/${name}.${kind}`), body);
    out += html.slice(last, b.start) + tagFor(kind, b.attrs, name, '0');
    last = b.end;
  }
  out += html.slice(last);
  fs.writeFileSync(path.join(root, 'index.html'), out);
  write(root);
  const joined = joinHtml(rd(root, 'index.html'), root);
  if (joined !== html) throw new Error('round trip failed: joined page differs from the original');
  return n / 10;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === '--check') {
    const errs = check();
    if (errs.length) { console.error('split-index: OUT OF SYNC\n  ' + errs.join('\n  ')); process.exit(1); }
    const { shell, assets } = build();
    console.log(`split-index: in sync (index.html ${Buffer.byteLength(shell)} bytes, ${assets.size} split files)`);
  } else if (cmd === '--join') {
    const j = readAppHtml();
    if (arg) fs.writeFileSync(arg, j); else process.stdout.write(j);
  } else if (cmd === '--extract') {
    console.log('extracted', extract(), 'blocks');
  } else if (!cmd) {
    const { shell, assets } = write();
    let total = 0; for (const b of assets.values()) total += b.length;
    console.log(`split-index: index.html ${Buffer.byteLength(shell)} bytes, ${assets.size} split files ${total} bytes`);
  } else { console.error('usage: split-index.mjs [--check | --join [OUT] | --extract]'); process.exit(2); }
}

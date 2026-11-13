// UX18: static scan of index.html — Arabic default, no English-only title=/help rows, accessible names, button tokens.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../auth-ui.js', import.meta.url), 'utf8');
const body = html.slice(html.indexOf('<body'), html.indexOf('<!-- APPLICATION LOGIC -->'));
const ar = /[؀-ۿ]/;
const fails = [];
// 1. title= / aria-label= must contain Arabic (or have no letters)  ("Search" is pinned by ux02-devices.check; the runtime dictionary translates it)
for (const m of body.matchAll(/\b(title|aria-label)="([^"]*)"/g))
  if (/[A-Za-z]{3}/.test(m[2]) && !ar.test(m[2]) && m[2] !== 'Search') fails.push(`English-only ${m[1]}="${m[2]}"`);
// 2. help modal rows
const help = body.slice(body.indexOf('id="helpModal"'));
const helpEnd = help.indexOf('<!-- TOAST');
for (const row of help.slice(0, helpEnd).matchAll(/<tr[\s\S]*?<\/tr>/g)) {
  const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]+>/g, ''));
  if (!ar.test(cells[1] || '')) fails.push('help row not Arabic: ' + (cells[1] || '').trim());
}
// 3. accessible names for buttons/selects
for (const m of body.matchAll(/<(button|select)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
  const text = m[3].replace(/<[^>]+>/g, '').trim();
  if (!/aria-label=|aria-labelledby=|\btitle=/.test(m[2]) && !text) fails.push(`no accessible name: <${m[1]} ${m[2].trim().slice(0, 60)}>`);
}
// auth-ui.js generated controls
for (const id of ['novaNewRole', 'novaNewOk'])
  if (!new RegExp(`id="${id}"[^>]*aria-label=`).test(auth)) fails.push(`${id} missing aria-label`);
// 4. unified button tokens
if (!/--nova-btn-radius/.test(html) || !/\.nova-page-btn\{[^}]*var\(--nova-btn-radius/.test(html)) fails.push('button radius token not used by .btn/.nova-page-btn');
// UX28: leftover English strings in the display layer (data/search keep English)
const pur = fs.readFileSync(new URL('../../purchases.html', import.meta.url), 'utf8') + fs.readFileSync(new URL('../../purchases.js', import.meta.url), 'utf8');
for (const [bad, why] of [['>No held invoices<', 'held empty state'], ['textContent = "Enter: Add Item"', 'search hint']]) if (html.includes(bad)) fails.push('English label left: ' + why);
if (!html.includes('لا توجد فواتير معلقة')) fails.push('held empty state not Arabic');
if (!html.includes('Enter: إضافة')) fails.push('search hint not Arabic');
if (/STOCK LIVE/.test(pur)) fails.push('purchases still shows STOCK LIVE');
if (!/المخزون الحي/.test(pur)) fails.push('purchases missing المخزون الحي');
if (/kpi\('مصدر الأسعار','STOCK LIVE'\)/.test(html)) fails.push('products KPI shows STOCK LIVE');
// display helpers behave: run them in isolation
const grab = n => html.match(new RegExp('const ' + n + ' = \\{[^}]*\\};'))[0];
const helperSrc = [grab('NOVA_AR_TIER'), grab('NOVA_AR_CAT'), ...['novaTierLabel', 'novaCategoryLabel', 'novaDisplayName'].map(n => html.match(new RegExp('window\\.' + n + ' = [^\\n]*'))[0])].join('\n');
const sandbox = { window: {}, localStorage: { getItem: () => 'ar' } };
new Function('window', 'localStorage', helperSrc)(sandbox.window, sandbox.localStorage);
const w = sandbox.window;
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: got "${a}" expected "${b}"`); };
eq(w.novaCategoryLabel('Topical'), 'موضعي', 'cat Topical'); eq(w.novaCategoryLabel('ENT'), 'أنف وأذن وحنجرة', 'cat ENT');
eq(w.novaTierLabel('Silver Member'), 'فضي', 'tier silver'); eq(w.novaTierLabel('Bronze Member'), 'برونزي', 'tier bronze'); eq(w.novaTierLabel('VIP Gold').includes('ذهبي'), true, 'tier gold');
eq(w.novaDisplayName('فولتارين جل 50 جم (Voltaren Emulgel)'), 'فولتارين جل 50 جم', 'hide English name');
eq(w.novaDisplayName('Panadol'), 'Panadol', 'Latin-only name kept');
// searchable: the underlying product name still carries the English text
if (!/name: "فولتارين جل 50 جم \(Voltaren Emulgel\)"/.test(html)) fails.push('English name no longer in data (search)');
// products table must route category/pack/name through the display layer
if (!/catLbl=c=>catAr\[c\]\?tr\(catAr\[c\],c\):esc\(window\.novaCategoryLabel\(c\)\)/.test(html)) fails.push('category not localized in table');
if (/nova-muted" title="[^>]*>'\+'—<\/span>/.test(html)) fails.push('pack fallback still —');
if (fails.length) { console.error('FAIL ux-i18n-consistency\n' + fails.join('\n')); process.exit(1); }
console.log('PASS ux-i18n-consistency');

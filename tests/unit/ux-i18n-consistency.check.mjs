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
// UX28: leftover English strings (display layer)
const must = [['No held invoices', 'لا توجد فواتير معلقة'], ['Enter: Add Item', 'Enter: إضافة']];
// English is allowed only as the explicit en-language branch of a ternary
for (const [en] of must) if (html.includes(en) && !new RegExp("===\\s*'en'\\)\\s*\\?\\s*['\"]" + en).test(html)) fails.push('leftover English string outside en branch: ' + en);
if (!html.includes('لا توجد فواتير معلقة') || !html.includes('Enter: إضافة')) fails.push('missing Arabic held/hint text');
if (!/Topical:'موضعي'/.test(html) || !/ENT:'أنف وأذن وحنجرة'/.test(html)) fails.push('Topical/ENT not translated');
if (/'\+'—<\/span>'/.test(html)) fails.push('pack fallback still em dash');
if (!html.includes('غير محدد')) fails.push('pack fallback غير محدد missing');
for (const t of ['ذهبي', 'فضي', 'برونزي']) if (!html.includes("'" + t + "'")) fails.push('tier label missing ' + t);
const pur = fs.readFileSync(new URL('../../purchases.html', import.meta.url), 'utf8') + fs.readFileSync(new URL('../../purchases.js', import.meta.url), 'utf8');
if (/STOCK LIVE/.test(pur.replace(/<!--[\s\S]*?-->/g, ''))) fails.push('STOCK LIVE visible in purchases');
if (!html.includes('المخزون الحي')) fails.push('المخزون الحي missing');
// display helper hides Latin parenthetical but data keeps it searchable
const disp = new Function('return ' + html.match(/window\.novaDisp = (.*?);\n/)[1])();
if (disp('فولتارين جل 50 جم (Voltaren Emulgel)') !== 'فولتارين جل 50 جم') fails.push('novaDisp does not hide English name');
if (!html.includes('(Voltaren Emulgel)')) fails.push('English name must stay in data for search');
if (fails.length) { console.error('FAIL ux-i18n-consistency\n' + fails.join('\n')); process.exit(1); }
console.log('PASS ux-i18n-consistency');

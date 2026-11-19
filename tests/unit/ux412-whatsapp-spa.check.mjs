// UX412: dedicated /whatsapp path — manifest start_url, HTML head rewrite, SW must
// not fall back to the cached POS shell, Worker route inject/strip is idempotent.
// No network, no deploy, never prints secrets.
// Run: node tests/unit/ux412-whatsapp-spa.check.mjs
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  patchWhatsAppHtml, novaWhatsAppSpaHtml, isWhatsAppPath,
  injectWorkerRoute, stripWaSpa, WA_SPA_FN,
} from '../../tools/whatsapp-spa.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest-whatsapp.webmanifest'), 'utf8'));
ck('manifest name NOVA WhatsApp', manifest.name === 'NOVA WhatsApp' && manifest.short_name === 'NOVA WhatsApp');
ck('manifest start_url is /whatsapp?app=whatsapp', manifest.start_url === '/whatsapp?app=whatsapp');
ck('manifest scope is /whatsapp', manifest.scope === '/whatsapp');
ck('manifest id is /whatsapp', manifest.id === '/whatsapp');
ck('manifest display standalone', manifest.display === 'standalone');
ck('manifest uses existing WhatsApp icons', Array.isArray(manifest.icons) && manifest.icons.some(i => i.src === '/icons/nova-whatsapp-192.png') && manifest.icons.some(i => i.src === '/icons/nova-whatsapp-512.png'));

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
ck('POS index keeps NOVA Rx head (iOS reads this on /)', html.includes('<meta name="apple-mobile-web-app-title" content="NOVA Rx">') && html.includes('href="/manifest.webmanifest?v=3">') && html.includes('<title>NOVA Rx |'));
ck('isWhatsAppPath covers /whatsapp and /wa', isWhatsAppPath('/whatsapp') && isWhatsAppPath('/whatsapp/') && isWhatsAppPath('/wa') && isWhatsAppPath('/wa/') && !isWhatsAppPath('/') && !isWhatsAppPath('/index.html') && !isWhatsAppPath('/whatsappx'));
ck('novaWhatsAppSpaHtml leaves / unchanged', novaWhatsAppSpaHtml('/', html) === html);
const wa = novaWhatsAppSpaHtml('/whatsapp', html);
ck('rewritten /whatsapp HTML has static NOVA WhatsApp title, apple title, manifest and icon',
  wa.includes('<title>NOVA WhatsApp</title>') &&
  wa.includes('<meta name="apple-mobile-web-app-title" content="NOVA WhatsApp">') &&
  wa.includes('<meta name="application-name" content="NOVA WhatsApp">') &&
  wa.includes('href="/manifest-whatsapp.webmanifest?v=2">') &&
  wa.includes('href="/icons/nova-whatsapp-180.png">') &&
  wa.includes('class="app-whatsapp"') &&
  !wa.includes('<title>NOVA Rx |'));
ck('embedded worker fn matches module rewrite', (() => {
  const names = (0, eval)(WA_SPA_FN + '; ({novaWhatsAppSpaHtml})');
  return names.novaWhatsAppSpaHtml('/whatsapp', html) === wa && names.novaWhatsAppSpaHtml('/', html) === html;
})());

const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
ck('SW cache is v6', sw.includes("const CACHE='nova-rx-shell-v6'") && !sw.includes("const CACHE='nova-rx-shell-v5'"));
ck('SW treats /whatsapp and ?app=whatsapp as network-first navigations', sw.includes("url.searchParams.get('app')==='whatsapp'") && sw.includes("path==='/whatsapp'") && sw.includes("path==='/wa'"));
ck('SW never falls back from a WhatsApp navigation to cached /', sw.includes("if(p==='/'||p==='/index.html')return Promise.reject"));

const art = readFileSync(join(ROOT, 'worker/live/nova-rx-preview.pur-04.js'), 'utf8');
ck('artifact has /whatsapp route and rewrite fn', art.includes('novaWhatsAppSpaHtml(url.pathname,') && art.includes("url.pathname==='/whatsapp'") && art.includes('function novaWhatsAppSpaHtml'));
const dir = mkdtempSync(join(tmpdir(), 'ux412-spa-'));
const copy = join(dir, 'w.js');
writeFileSync(copy, stripWaSpa(art));
const once = injectWorkerRoute(readFileSync(copy, 'utf8'));
const twice = injectWorkerRoute(once);
ck('inject is idempotent', once === twice);
ck('strip after inject restores pre-route worker (modulo nothing)', stripWaSpa(once) === readFileSync(copy, 'utf8'));
rmSync(dir, { recursive: true });

ck('index.html keeps /whatsapp even without the query', html.includes("path==='/whatsapp'||path==='/wa'") && html.includes('function waKeepUrl()') && html.includes("var swUrl = '/sw.js?v=6';"));
ck('index.html opens inbox in standalone when the launch URL is marked', html.includes("display-mode: standalone") && html.includes("sessionStorage.setItem('nova.wa.standalone','1')"));

console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
process.exit(fail ? 1 : 0);

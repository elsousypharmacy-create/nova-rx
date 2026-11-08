// PharmaOverseas price collection run (plain code, no AI).
// 1. Logs in once with a headless browser using the pharmacy's own account
//    (PO_USERNAME / PO_PASSWORD from secrets) and keeps the access token in
//    memory only.
// 2. Uses the connector to search each drug name and writes schema-valid
//    offers to the output file. Never prints the token or credentials.
// Usage: node tools/collectors/pharmaoverseas-prices.mjs queries.txt out.json
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createPharmaOverseasConnector } from '../../worker/procurement/connectors/pharmaoverseas.js';
import { validateOffer } from '../../worker/procurement/offer-schema.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [, , queriesPath, outPath] = process.argv;
const BASE = 'https://shop.pharmaemarket.com/pharma/en/EGP';

async function login() {
  const { PO_USERNAME, PO_PASSWORD } = process.env;
  if (!PO_USERNAME || !PO_PASSWORD) throw new Error('missing PO_USERNAME / PO_PASSWORD');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
    if (await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"]')) throw new Error('CAPTCHA on login page');
    await page.fill('input[name="username"], input[type="email"]', PO_USERNAME);
    await page.fill('input[name="password"], input[type="password"]', PO_PASSWORD);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => /oauth\/token/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 }),
      page.press('input[type="password"]', 'Enter'),
    ]);
    if (resp.status() !== 200) throw new Error(`login failed (status ${resp.status()})`);
    const body = await resp.json();
    if (!body.access_token) throw new Error('login response had no access token');
    return { token: body.access_token, expiresIn: body.expires_in };
  } finally {
    await browser.close();
  }
}

const queries = readFileSync(queriesPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const started = new Date().toISOString();
const { token, expiresIn } = await login();
console.log(`login ok (session ${Math.round((expiresIn || 0) / 3600)} h)`);

const connector = createPharmaOverseasConnector({ getAccessToken: async () => token });
const offers = [];
const errors = [];
for (const q of queries) {
  try {
    const res = await connector.search(q, { page: 1, pageSize: 24 });
    const fetchedAt = new Date().toISOString();
    let ok = 0;
    for (const raw of res.offers) {
      const offer = connector.toOffer(raw, { fetchedAt });
      const v = validateOffer(offer);
      if (v.ok) { offers.push(offer); ok += 1; } else errors.push({ query: q, code: raw.code, errors: v.errors });
    }
    console.log(`"${q}": ${ok} offers`);
  } catch (e) {
    errors.push({ query: q, error: e.code || e.name, message: e.message });
    console.log(`"${q}": ${e.code || e.name}`);
    if (e.code === 'AUTH_REQUIRED' || e.code === 'NOT_AUTHORIZED') break; // stop, never retry login
  }
}
writeFileSync(outPath, JSON.stringify({ supplierId: 'pharmaoverseas', started, finished: new Date().toISOString(), queries, offers, errors }, null, 2));
console.log(`total offers ${offers.length}, errors ${errors.length}`);

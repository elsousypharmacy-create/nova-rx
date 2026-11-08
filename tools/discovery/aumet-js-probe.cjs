// Reads the PUBLIC JavaScript of marketplace.aumet.com (no login, no account) and prints short
// code snippets around words that name the product-search parameter. Code only, no user data.
const { chromium } = require('playwright');
const fs = require('fs');

const OUT = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const scripts = new Set();
  page.on('response', (r) => {
    const u = r.url();
    if (/marketplace\.aumet\.com/.test(u) && /\.js(\?|$)/.test(u)) scripts.add(u.split('?')[0]);
  });
  await page.goto('https://marketplace.aumet.com/user/login', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  const result = { scripts: scripts.size, snippets: [] };
  const words = /spell\b|search_text|searchText|keyword|\bq:|\bterm\b|product_name|"name_like|query:/;
  for (const url of scripts) {
    let text = '';
    try { text = await (await page.request.get(url)).text(); } catch { continue; }
    if (!/api\/products/.test(text)) continue;
    let from = 0;
    for (let hits = 0; hits < 40 && result.snippets.length < 14; hits += 1) {
      const rest = text.slice(from);
      const m = rest.match(/api\/products/);
      if (!m) break;
      const at = from + m.index;
      const snippet = text.slice(Math.max(0, at - 220), at + 260).replace(/\s+/g, ' ');
      if (words.test(snippet)) result.snippets.push({ file: url.split('/').pop(), snippet });
      from = at + 12;
    }
  }
  fs.writeFileSync(OUT + '/aumet-js.json', JSON.stringify(result, null, 2));
  await browser.close();
})();

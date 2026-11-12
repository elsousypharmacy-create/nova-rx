// Renewal is read-only. Capture the storefront's own cart contract while aborting
// the attempted write; never construct account/cart ids or send quantity changes.
function validTemplate(t) {
  return t?.method === 'POST' && /^\/api\/v2\/cart\/\d+\/items$/.test(t.path) &&
    /^\d+$/.test(String(t.body?.entity_id ?? '')) &&
    /^\d+$/.test(String(t.body?.payment_method_id ?? ''));
}
async function guardAumetApi(ctx) {
  let captured = null;
  await ctx.route('**/api/**', async route => {
    const r = route.request(), u = new URL(r.url());
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.continue();
    if (u.hostname === 'marketplace.aumet.com') {
      let body = null;
      try { body = r.postDataJSON(); } catch {}
      const t = { method: r.method(), path: u.pathname, body };
      if (validTemplate(t)) captured = t;
    }
    // All API mutations are blocked, including unknown/new cart/order routes.
    return route.abort();
  });
  return () => captured;
}
async function captureAumetCart(page, captured) {
  const reject = page.locator('.cky-btn-reject:visible');
  if (await reject.count()) await reject.first().click();
  const quantity = page.locator('button.dialerQuantity.show-details:visible');
  if (await quantity.count()) {
    await quantity.first().click();
    await page.waitForTimeout(600);
    const numeric = page.locator('input[type="number"]:visible');
    if (!captured() && await numeric.count()) {
      await numeric.first().fill('1');
      await numeric.first().press('Tab');
      await page.waitForTimeout(1500);
    }
  }
  return captured();
}
async function verifyAumetCart(request, template, authorization, xsrf) {
  if (!validTemplate(template)) throw Error('cart-context-missing');
  const r = await request.get('https://marketplace.aumet.com' + template.path, {
    headers: { Accept:'application/json', Authorization:authorization || '', 'X-XSRF-TOKEN':xsrf || '' },
    timeout:15000, maxRedirects:0,
  });
  if (r.status() !== 200) throw Error('cart-read-verification-failed');
  let d; try { d = await r.json(); } catch { throw Error('cart-read-verification-failed'); }
  if (String(d?.data?.buyer?.id) !== String(template.body.entity_id) || !Array.isArray(d?.data?.sellers)) {
    throw Error('cart-read-verification-failed');
  }
}
module.exports = { guardAumetApi, captureAumetCart, verifyAumetCart };

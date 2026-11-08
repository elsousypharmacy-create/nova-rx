// Live check of the plain-HTTP login + connector search (runs on GitHub, secrets from env).
// Prints only counts and one public product line. Never prints credentials or tokens.
import { loginPharmaOverseas } from '../../worker/procurement/auth/pharmaoverseas-login.js';
import { createPharmaOverseasConnector } from '../../worker/procurement/connectors/pharmaoverseas.js';

const t0 = Date.now();
try {
  const { accessToken, expiresAt } = await loginPharmaOverseas({ username: process.env.PO_USERNAME, password: process.env.PO_PASSWORD });
  console.log(`login ok in ${Date.now() - t0} ms, session about ${Math.round((expiresAt - Date.now()) / 3600000)} h`);
  const connector = createPharmaOverseasConnector({ getAccessToken: async () => accessToken });
  for (const q of ['Panadol', 'Augmentin']) {
    const t1 = Date.now();
    const res = await connector.search(q, { page: 1, pageSize: 24 });
    const first = res.offers[0];
    const offer = first ? connector.toOffer(first, { fetchedAt: new Date().toISOString() }) : null;
    console.log(`"${q}": ${res.offers.length} products in ${Date.now() - t1} ms` + (offer ? `, first: ${offer.productName} ${offer.unitPrice} (public ${offer.publicPrice})` : ''));
  }
} catch (e) {
  console.log(`failed: ${e.code || e.name}: ${String(e.message).slice(0, 140)}`);
  process.exitCode = 1;
}

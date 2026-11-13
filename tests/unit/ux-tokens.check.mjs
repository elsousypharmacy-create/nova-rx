import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const ux = createRequire(import.meta.url)('../../ux-tokens.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('contrast math: black/white = 21, same = 1', () => {
  assert.equal(Math.round(ux.contrast('#000000', '#ffffff')), 21);
  assert.equal(ux.contrast('#123456', '#123456'), 1);
});
t('dark theme passes WCAG AA', () => assert.deepEqual(ux.audit('dark'), []));
t('light theme passes WCAG AA', () => assert.deepEqual(ux.audit('light'), []));
t('audit detects a failing pair', () => {
  ux.THEMES.dark['text-dim'] = '#202428';
  try { assert.equal(ux.audit('dark').length, 1); } finally { ux.THEMES.dark['text-dim'] = '#808b96'; }
});
t('bad theme / color / message rejected', () => {
  assert.throws(() => ux.audit('x'), /bad-theme/);
  assert.throws(() => ux.contrast('red', '#fff'), /bad-color/);
  assert.throws(() => ux.message('nope'), /unknown-message/);
});
t('both themes define the same tokens', () =>
  assert.deepEqual(Object.keys(ux.THEMES.dark).sort(), Object.keys(ux.THEMES.light).sort()));
t('messages are Arabic', () => Object.values(ux.MESSAGES).forEach(m => assert.match(m, /[؀-ۿ]/)));
t('apply sets rtl, lang ar, theme tokens, Cairo', () => {
  const attrs = {}, css = {};
  const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, style: { setProperty: (k, v) => { css[k] = v; } } } };
  ux.apply(doc);
  assert.equal(attrs.dir, 'rtl'); assert.equal(attrs.lang, 'ar'); assert.equal(attrs['data-theme'], 'dark');
  assert.match(css['--nx-font'], /^Cairo/); assert.equal(css['--nx-bg-base'], '#08090b');
  ux.apply(doc, 'light'); assert.equal(attrs['data-theme'], 'light');
});
console.log(n + ' tests passed');

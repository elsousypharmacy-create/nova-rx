import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const h=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
assert.match(h,/\.nova-page-view\{padding-bottom:calc\(72px/,'page-view bottom padding rule');
assert.match(h,/\.totals-breakdown\{margin-bottom:72px\}/,'totals spacing rule');
assert.match(h,/@media\(max-width:600px\)\{#novaAiLaunch\{[^}]*border-radius:50%/,'icon-only round FAB <=600px');
assert.match(h,/<button id="novaAiLaunch"[^>]*aria-label="طباعة استيكرات الأدوية"/,'Arabic aria-label');
console.log('labels-fab check passed');

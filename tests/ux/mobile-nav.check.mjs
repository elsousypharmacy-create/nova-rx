import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const h=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
assert.match(h,/UX2: mobile nav edge fade[\s\S]*max-width:780px[\s\S]*overflow-x:auto[\s\S]*mask-image:linear-gradient/,'nav css');
assert.match(h,/scrollbar-width:none/);
assert.match(h,/scrollIntoView\(\{inline:'center'/,'scrollIntoView call');
console.log('mobile-nav check passed');

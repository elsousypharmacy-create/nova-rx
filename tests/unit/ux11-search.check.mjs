import { readAppHtml } from '../lib/app-html.mjs'; // PERF-02: index.html + split app/ files
import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const h=readAppHtml(process.env.NOVA_UX_HTML||'index.html','utf8');const src=h.slice(h.indexOf('const searchStockLabel ='),h.indexOf('      const extractStrength ='));
const ctx={novaEn:()=>false,normDigits:s=>String(s)};vm.createContext(ctx);vm.runInContext(src+';this.label=searchStockLabel;this.review=sourceMeasureNeedsReview;',ctx);
for(const stock of [null,undefined,'',NaN,'0'])assert.equal(ctx.label({stock}),'الرصيد غير معروف');
assert.equal(ctx.label({stock:0}),'الرصيد: صفر');assert.equal(ctx.label({stock:12}),'الرصيد: 12');
assert.equal(ctx.review('500G'),true);assert.equal(ctx.review('500mg'),false);assert.equal(ctx.review('50g'),false);
ctx.novaEn=()=>true;assert.equal(ctx.label({stock:null}),'Stock unknown');
console.log('PASS UX11 stock unknown/zero/positive, source review flag, English (logic only)');

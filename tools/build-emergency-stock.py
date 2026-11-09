#!/usr/bin/env python3
"""STOCK LIVE (CSV export) -> data/emergency-stock.json for the public /emergency page.
Keeps only code, gtin, Arabic/English name, price (public price) and units. Stock, cost, expiry and batches are NOT exported.
Usage: build-emergency-stock.py STOCK.csv OUT.json EXPORTED_AT_ISO"""
import csv, json, re, sys, html
src, out, exported = sys.argv[1:4]
def clean(s): return re.sub(r'\s+', ' ', html.unescape(s or '')).strip()
def good(s): return len(s) > 1 and not re.fullmatch(r'[.\-_*\s]+', s)
items, seen = [], set()
for r in csv.DictReader(open(src, encoding='utf-8', newline='')):
    try: price = float(str(r.get('price', '')).replace(',', ''))
    except ValueError: continue
    code = re.sub(r'\D', '', r.get('code') or '')
    gtin = re.sub(r'\D', '', r.get('gtin') or '')
    ar, en = clean(r.get('namear')), clean(r.get('nameen'))
    name = ar if good(ar) else en
    if price <= 0 or not code or not good(name) or code in seen: continue
    seen.add(code)
    it = {'code': code, 'namear': name, 'price': round(price, 2)}
    if good(en) and en != name: it['nameen'] = en
    if 8 <= len(gtin) <= 14 and gtin != code: it['gtin'] = gtin
    try:
        u = float(r.get('units') or 1)
        if u > 1: it['units'] = u
    except ValueError: pass
    items.append(it)
json.dump({'source': 'STOCK LIVE', 'exportedAt': exported, 'items': items}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(items), 'items')

// CAT-04 local CSV/XLSX catalog import with column mapping, row-error preview, dry-run, source-key deduplication, and reversible commit (rollback).
// Pure local module: no network, no backend writes, keeps STOCK LIVE untouched.

import { normalizeBarcode, normalizeDigits, sanitizeCatalogText } from './unified-catalog.js';
import { canonicalPackaging } from './unit-conversion.js';

const MAX_PRICE = 1e9;

export function normalizeSourceKey(raw) {
  const s = normalizeDigits(sanitizeCatalogText(raw)).toLowerCase();
  return s.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function parseStrictPositivePrice(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 && raw <= MAX_PRICE ? { ok: true, value: Math.round(raw * 100) / 100 } : { ok: false };
  }
  if (typeof raw !== 'string') return { ok: false };
  const s = normalizeDigits(raw).replace(/\u066C/g, ',').replace(/\u066B/g, '.').trim();
  if (!s) return { ok: false };
  if (!(/^\d+(\.\d+)?$/.test(s) || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s))) return { ok: false };
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function detectDelimiter(headerLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i];
    if (ch === '"') {
      if (inQuotes && headerLine[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && ch in counts) {
      counts[ch]++;
    }
  }
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

export function parseCsv(rawText, fileName = 'import.csv') {
  if (typeof rawText !== 'string') return { ok: false, error: 'invalid-csv' };
  const text = rawText.replace(/^\uFEFF/, '');
  if (!text.trim()) return { ok: false, error: 'empty-file' };

  const firstNewline = text.search(/\r?\n/);
  const firstLine = firstNewline === -1 ? text : text.slice(0, firstNewline);
  const delim = detectDelimiter(firstLine);

  const matrix = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      matrix.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (inQuotes) return { ok: false, error: 'unclosed-quote' };
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    matrix.push(row);
  }

  const nonEmpty = matrix.map((values, idx) => ({ rowNumber: idx + 1, values }))
    .filter(r => r.values.some(v => sanitizeCatalogText(v) !== ''));

  if (nonEmpty.length < 2) return { ok: false, error: 'empty-file' };
  const headers = nonEmpty[0].values.map(h => sanitizeCatalogText(h));
  const rows = nonEmpty.slice(1);
  return { ok: true, format: 'csv', fileName, headers, rows };
}

function decodeXmlEntities(str) {
  return String(str ?? '')
    .replace(/_x000D_/gi, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

async function inflateRawBytes(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    const { inflateRawSync } = await import('node:zlib');
    return new Uint8Array(inflateRawSync(bytes));
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function readZipEntries(inputBytes) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const minEocd = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const cdCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let ptr = cdOffset;

  for (let i = 0; i < cdCount && ptr + 46 <= bytes.length; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) return null;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return null;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > bytes.length) return null;
    const slice = bytes.subarray(dataStart, dataStart + compSize);
    entries.set(name, { method, slice });
  }

  async function readText(name) {
    const entry = entries.get(name);
    if (!entry) return null;
    if (entry.method === 0) return decoder.decode(entry.slice);
    if (entry.method === 8) {
      const inflated = await inflateRawBytes(entry.slice);
      return decoder.decode(inflated);
    }
    throw new Error('unsupported-compression');
  }

  return { entries, readText };
}

export async function parseXlsx(inputBytes, fileName = 'import.xlsx') {
  try {
    const bytes = inputBytes instanceof ArrayBuffer ? new Uint8Array(inputBytes)
      : inputBytes instanceof Uint8Array ? inputBytes : null;
    if (!bytes) return { ok: false, error: 'invalid-xlsx' };
    const zip = await readZipEntries(bytes);
    if (!zip) return { ok: false, error: 'invalid-xlsx' };

    const sharedStrings = [];
    const sstXml = await zip.readText('xl/sharedStrings.xml');
    if (sstXml) {
      const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
      let m;
      while ((m = siRe.exec(sstXml)) !== null) {
        const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        let tm;
        let text = '';
        while ((tm = tRe.exec(m[1])) !== null) text += decodeXmlEntities(tm[1]);
        sharedStrings.push(text);
      }
    }

    let sheetName = 'xl/worksheets/sheet1.xml';
    if (!zip.entries.has(sheetName)) {
      sheetName = [...zip.entries.keys()].find(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k)) || '';
    }
    if (!sheetName) return { ok: false, error: 'invalid-xlsx' };
    const sheetXml = await zip.readText(sheetName);
    if (!sheetXml) return { ok: false, error: 'invalid-xlsx' };

    const rawRows = [];
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    let rm;
    let fallbackRowNum = 0;
    while ((rm = rowRe.exec(sheetXml)) !== null) {
      fallbackRowNum++;
      const rAttr = rm[1].match(/\br="(\d+)"/);
      const rowNumber = rAttr ? Number(rAttr[1]) : fallbackRowNum;
      const cells = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      let nextCol = 0;
      while ((cm = cellRe.exec(rm[2])) !== null) {
        const attrs = cm[1] || '';
        const inner = cm[2] || '';
        const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
        const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : nextCol;
        nextCol = colIdx + 1;
        while (cells.length < colIdx) cells.push('');
        const typeMatch = attrs.match(/\bt="([^"]+)"/);
        const cellType = typeMatch ? typeMatch[1] : '';
        let val = '';
        if (cellType === 'inlineStr') {
          const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
          let tm;
          while ((tm = tRe.exec(inner)) !== null) val += decodeXmlEntities(tm[1]);
        } else {
          const vMatch = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
          const rawV = vMatch ? decodeXmlEntities(vMatch[1]) : '';
          if (cellType === 's') {
            const idx = Number(rawV);
            val = Number.isInteger(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : '';
          } else {
            val = rawV;
          }
        }
        cells[colIdx] = String(val).trim();
      }
      if (cells.some(c => sanitizeCatalogText(c) !== '')) {
        rawRows.push({ rowNumber, values: cells });
      }
    }

    if (rawRows.length < 2) return { ok: false, error: 'empty-file' };
    const headers = rawRows[0].values.map(h => sanitizeCatalogText(h));
    const rows = rawRows.slice(1).map(r => {
      const vals = [...r.values];
      while (vals.length < headers.length) vals.push('');
      return { rowNumber: r.rowNumber, values: vals };
    });
    return { ok: true, format: 'xlsx', fileName, headers, rows };
  } catch (_) {
    return { ok: false, error: 'invalid-xlsx' };
  }
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function colIndexToLetters(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

export function buildXlsxBytes(matrix) {
  const rowsXml = (Array.isArray(matrix) ? matrix : []).map((row, rIdx) => {
    const rNum = rIdx + 1;
    const cellsXml = (Array.isArray(row) ? row : []).map((cell, cIdx) => {
      const ref = `${colIndexToLetters(cIdx)}${rNum}`;
      if (typeof cell === 'number' && Number.isFinite(cell)) {
        return `<c r="${ref}"><v>${cell}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
    }).join('');
    return `<row r="${rNum}">${cellsXml}</row>`;
  }).join('');

  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Catalog" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`]
  ];

  const enc = new TextEncoder();
  const localParts = [];
  const cdParts = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const dataBytes = enc.encode(content);
    const crc = crc32(dataBytes);

    const lh = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    lh.set(dataBytes, 30 + nameBytes.length);
    localParts.push(lh);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    cdParts.push(cd);

    offset += lh.length;
  }

  const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const p of localParts) { out.set(p, pos); pos += p.length; }
  for (const p of cdParts) { out.set(p, pos); pos += p.length; }
  out.set(eocd, pos);
  return out;
}

const HEADER_ALIASES = {
  sourceKey: ['sourcekey', 'source_key', 'source key', 'code', 'id', 'item_code', 'itemcode', 'sku', 'كود', 'الكود', 'كود الصنف', 'رقم الصنف', 'مفتاح المصدر', 'معرف الصنف'],
  name: ['name', 'namear', 'name_ar', 'arabicname', 'product', 'title', 'item', 'الاسم', 'الصنف', 'اسم الصنف', 'اسم الدواء', 'الاسم العربي', 'المنتج'],
  nameEn: ['nameen', 'name_en', 'englishname', 'english_name', 'الاسم الانجليزي', 'الاسم الإنجليزي', 'اسم انجليزي'],
  barcode: ['barcode', 'gtin', 'ean', 'barcodes', 'الباركود', 'باركود', 'الترقيم الدولي'],
  price: ['price', 'public_price', 'retail_price', 'unit_price', 'السعر', 'سعر البيع', 'سعر الجمهور', 'سعر الوحدة'],
  pack: ['pack', 'form', 'unit', 'العبوة', 'الوحدة', 'الشكل الصيدلي'],
  stripsPerBox: ['stripsperbox', 'strips_per_box', 'strips', 'شرائط بالعلبة', 'عدد الشرائط'],
  unitsPerStrip: ['unitsperstrip', 'units_per_strip', 'tabletsperstrip', 'tablets_per_strip', 'وحدات بالشريط', 'أقراص بالشريط', 'اقراص بالشريط'],
  unitsPerBox: ['unitsperbox', 'units_per_box', 'packsize', 'pack_size', 'وحدات بالعلبة', 'أقراص بالعلبة', 'اقراص بالعلبة'],
  generic: ['generic', 'activeingredient', 'active_ingredient', 'المادة الفعالة', 'الاسم العلمي'],
  strength: ['strength', 'concentration', 'التركيز'],
  category: ['category', 'group', 'التصنيف', 'القسم']
};

export function guessColumnMapping(headers = []) {
  const norm = h => sanitizeCatalogText(h).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const normCompact = h => norm(h).replace(/\s+/g, '');
  const mapping = {
    sourceKey: -1, name: -1, nameEn: -1, barcode: -1, price: -1,
    pack: -1, stripsPerBox: -1, unitsPerStrip: -1, unitsPerBox: -1,
    generic: -1, strength: -1, category: -1
  };
  const used = new Set();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex((h, i) => {
      if (used.has(i)) return false;
      const nh = norm(h), nc = normCompact(h);
      return aliases.some(a => a === nh || a.replace(/\s+/g, '') === nc);
    });
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  if (mapping.sourceKey < 0 && mapping.barcode >= 0) {
    mapping.sourceKey = mapping.barcode;
  }
  return mapping;
}

function cellAt(rowValues, colIdx) {
  if (!Number.isInteger(colIdx) || colIdx < 0 || colIdx >= rowValues.length) return '';
  return sanitizeCatalogText(rowValues[colIdx]);
}

function collectExistingKeys(items) {
  const sourceKeys = new Map();
  const barcodes = new Map();
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || item.code || item.sourceKey || '');
    for (const candidate of [item.sourceKey, item.id, item.code]) {
      const k = normalizeSourceKey(candidate);
      if (k && !sourceKeys.has(k)) sourceKeys.set(k, id);
    }
    for (const rawB of [item.barcode, item.gtin, ...(Array.isArray(item.barcodes) ? item.barcodes : [])]) {
      const b = normalizeBarcode(rawB);
      if (b && !barcodes.has(b)) barcodes.set(b, id);
      const bk = normalizeSourceKey(rawB);
      if (bk && !sourceKeys.has(bk)) sourceKeys.set(bk, id);
    }
  }
  return { sourceKeys, barcodes };
}

export function createCatalogImporter({
  stockLiveItems = [],
  storage = null,
  storageKey = 'nova-rx-catalog-imports-v1',
  now = () => new Date().toISOString()
} = {}) {
  const baseStockLive = Object.freeze(
    (Array.isArray(stockLiveItems) ? stockLiveItems : []).map(item => Object.freeze({ ...item }))
  );

  function loadBatches() {
    if (!storage || typeof storage.getItem !== 'function') return memBatches;
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveBatches(batches) {
    memBatches = batches;
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(storageKey, JSON.stringify(batches));
    }
  }

  let memBatches = [];
  if (storage && typeof storage.getItem === 'function') {
    memBatches = loadBatches();
  }

  function getImportedItems() {
    const batches = loadBatches();
    const out = [];
    for (const b of batches) {
      if (b && Array.isArray(b.items)) {
        for (const item of b.items) out.push(Object.freeze({ ...item }));
      }
    }
    return out;
  }

  function dryRun(parsedInput, customMapping = null) {
    const parsed = typeof parsedInput === 'string' ? parseCsv(parsedInput) : parsedInput;
    if (!parsed || !parsed.ok || !Array.isArray(parsed.headers) || !Array.isArray(parsed.rows)) {
      return { ok: false, error: (parsed && parsed.error) || 'invalid-input' };
    }
    const baseMap = guessColumnMapping(parsed.headers);
    const mapping = { ...baseMap };
    if (customMapping && typeof customMapping === 'object') {
      for (const k of Object.keys(mapping)) {
        if (customMapping[k] !== undefined && customMapping[k] !== null) {
          mapping[k] = Number(customMapping[k]);
        }
      }
    }

    const stockLiveIndex = collectExistingKeys(baseStockLive);
    const importedIndex = collectExistingKeys(getImportedItems());
    const seenInFileKeys = new Map();
    const seenInFileBarcodes = new Map();

    const toImport = [];
    const rowErrors = [];
    const duplicates = [];

    for (const row of parsed.rows) {
      const vals = Array.isArray(row.values) ? row.values : [];
      const rawSourceKey = cellAt(vals, mapping.sourceKey);
      const normKey = normalizeSourceKey(rawSourceKey);
      const rawName = cellAt(vals, mapping.name);
      const rawNameEn = cellAt(vals, mapping.nameEn);
      const rawBarcode = cellAt(vals, mapping.barcode);
      const rawPrice = cellAt(vals, mapping.price);
      const rawPack = cellAt(vals, mapping.pack);
      const rawStrips = cellAt(vals, mapping.stripsPerBox);
      const rawUnitsPerStrip = cellAt(vals, mapping.unitsPerStrip);
      const rawUnitsPerBox = cellAt(vals, mapping.unitsPerBox);
      const rawGeneric = cellAt(vals, mapping.generic);
      const rawStrength = cellAt(vals, mapping.strength);
      const rawCategory = cellAt(vals, mapping.category);

      const errors = [];
      if (!normKey) errors.push('source-key-missing');
      if (!rawName && !rawNameEn) errors.push('name-missing');

      const priceCheck = parseStrictPositivePrice(rawPrice);
      if (!priceCheck.ok) errors.push('price-invalid');

      let validBarcode = '';
      if (rawBarcode) {
        const nb = normalizeBarcode(rawBarcode);
        if (!nb) errors.push('barcode-invalid');
        else validBarcode = nb;
      }

      let packaging = null;
      if (rawStrips || rawUnitsPerStrip || rawUnitsPerBox) {
        const pkInput = {};
        if (rawStrips) pkInput.stripsPerBox = rawStrips;
        if (rawUnitsPerStrip) pkInput.unitsPerStrip = rawUnitsPerStrip;
        if (rawUnitsPerBox) pkInput.unitsPerBox = rawUnitsPerBox;
        const pkCheck = canonicalPackaging(pkInput);
        if (!pkCheck.ok) errors.push(pkCheck.error);
        else packaging = pkCheck.packaging;
      }

      const displayName = rawName && rawNameEn && rawName !== rawNameEn
        ? `${rawName} (${rawNameEn})`
        : (rawName || rawNameEn);

      if (errors.length > 0) {
        rowErrors.push(Object.freeze({
          rowNumber: row.rowNumber,
          sourceKey: rawSourceKey,
          name: displayName,
          errors: Object.freeze(errors)
        }));
        continue;
      }

      // Deduplicate against STOCK LIVE first (never touch STOCK LIVE)
      if (stockLiveIndex.sourceKeys.has(normKey) || (validBarcode && stockLiveIndex.barcodes.has(validBarcode))) {
        duplicates.push(Object.freeze({
          rowNumber: row.rowNumber,
          sourceKey: normKey,
          name: displayName,
          reason: 'existing-stock-live',
          existingId: stockLiveIndex.sourceKeys.get(normKey) || stockLiveIndex.barcodes.get(validBarcode)
        }));
        continue;
      }

      // Deduplicate against already committed imports
      if (importedIndex.sourceKeys.has(normKey) || (validBarcode && importedIndex.barcodes.has(validBarcode))) {
        duplicates.push(Object.freeze({
          rowNumber: row.rowNumber,
          sourceKey: normKey,
          name: displayName,
          reason: 'existing-imported',
          existingId: importedIndex.sourceKeys.get(normKey) || importedIndex.barcodes.get(validBarcode)
        }));
        continue;
      }

      // Deduplicate within the imported file itself by stable sourceKey (and barcode)
      if (seenInFileKeys.has(normKey) || (validBarcode && seenInFileBarcodes.has(validBarcode))) {
        duplicates.push(Object.freeze({
          rowNumber: row.rowNumber,
          sourceKey: normKey,
          name: displayName,
          reason: 'duplicate-in-file',
          firstRowNumber: seenInFileKeys.get(normKey) || seenInFileBarcodes.get(validBarcode)
        }));
        continue;
      }

      seenInFileKeys.set(normKey, row.rowNumber);
      if (validBarcode) seenInFileBarcodes.set(validBarcode, row.rowNumber);

      const cleanId = normalizeDigits(rawSourceKey).trim();
      toImport.push(Object.freeze({
        id: cleanId,
        sourceKey: normKey,
        barcode: validBarcode || cleanId,
        name: displayName,
        nameAr: rawName || '',
        nameEn: rawNameEn || '',
        price: priceCheck.value,
        pack: rawPack || '',
        packaging,
        generic: rawGeneric || '',
        strength: rawStrength || '',
        category: rawCategory || '',
        stock: null,
        imported: true,
        rowNumber: row.rowNumber
      }));
    }

    return Object.freeze({
      ok: true,
      dryRun: true,
      format: parsed.format || 'csv',
      fileName: parsed.fileName || '',
      headers: Object.freeze([...parsed.headers]),
      mapping: Object.freeze({ ...mapping }),
      totalRows: parsed.rows.length,
      validCount: toImport.length,
      errorCount: rowErrors.length,
      duplicateCount: duplicates.length,
      toImport: Object.freeze(toImport),
      rowErrors: Object.freeze(rowErrors),
      duplicates: Object.freeze(duplicates)
    });
  }

  function commit(dryRunReport, { confirmed = true, fileName = '' } = {}) {
    if (!confirmed) return { ok: false, error: 'confirmation-required' };
    if (!dryRunReport || !dryRunReport.ok || !Array.isArray(dryRunReport.toImport)) {
      return { ok: false, error: 'invalid-dry-run' };
    }

    const stockLiveIndex = collectExistingKeys(baseStockLive);
    const importedIndex = collectExistingKeys(getImportedItems());
    const seenKeys = new Set();
    const seenBarcodes = new Set();
    const batchItems = [];

    for (const item of dryRunReport.toImport) {
      const k = normalizeSourceKey(item.sourceKey || item.id);
      const b = normalizeBarcode(item.barcode);
      if (!k) continue;
      if (stockLiveIndex.sourceKeys.has(k) || (b && stockLiveIndex.barcodes.has(b))) continue;
      if (importedIndex.sourceKeys.has(k) || (b && importedIndex.barcodes.has(b))) continue;
      if (seenKeys.has(k) || (b && seenBarcodes.has(b))) continue;
      seenKeys.add(k);
      if (b) seenBarcodes.add(b);
      batchItems.push(Object.freeze({ ...item }));
    }

    if (batchItems.length === 0) {
      return { ok: false, error: 'nothing-to-import' };
    }

    const batches = loadBatches();
    const batchId = `IMP-${Date.now()}-${batches.length + 1}`;
    const stampedItems = batchItems.map(item => Object.freeze({ ...item, importBatchId: batchId }));
    const batch = Object.freeze({
      id: batchId,
      fileName: fileName || dryRunReport.fileName || 'import',
      format: dryRunReport.format || 'csv',
      committedAt: now(),
      count: stampedItems.length,
      items: Object.freeze(stampedItems)
    });

    try {
      saveBatches([...batches, batch]);
    } catch (_) {
      return { ok: false, error: 'storage' };
    }

    return {
      ok: true,
      batch,
      importedCount: stampedItems.length,
      totalCatalogCount: baseStockLive.length + getImportedItems().length
    };
  }

  function rollback(batchId = null) {
    const batches = loadBatches();
    if (batches.length === 0) return { ok: false, error: 'no-import-to-rollback' };
    const idx = batchId ? batches.findIndex(b => b.id === batchId) : batches.length - 1;
    if (idx < 0) return { ok: false, error: 'no-import-to-rollback' };
    const rolledBackBatch = batches[idx];
    const next = batches.filter((_, i) => i !== idx);
    try {
      saveBatches(next);
    } catch (_) {
      return { ok: false, error: 'storage' };
    }
    return {
      ok: true,
      rolledBackBatch,
      removedCount: Array.isArray(rolledBackBatch.items) ? rolledBackBatch.items.length : 0,
      remainingBatches: next.length,
      totalCatalogCount: baseStockLive.length + getImportedItems().length
    };
  }

  return {
    parseCsv,
    parseXlsx,
    buildXlsxBytes,
    guessColumnMapping,
    normalizeSourceKey,
    dryRun,
    commit,
    rollback,
    history: () => Object.freeze(loadBatches().map(b => Object.freeze({ ...b }))),
    getStockLive: () => baseStockLive,
    getImportedItems: () => Object.freeze(getImportedItems()),
    getCatalog: () => Object.freeze([...baseStockLive, ...getImportedItems()])
  };
}

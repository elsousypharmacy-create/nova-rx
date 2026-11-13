/* NOVA Rx — BI-04 reports and export (pure logic, no DOM, no network, frontend/local only).
   Filterable + paged reports, permission-aware (opts.can(action), default deny), with data limits.
   Exports: CSV (UTF-8 BOM, Excel-safe Arabic, formula-injection guard), XLSX (minimal stored-zip, RTL sheet),
   print-ready RTL HTML (the screen prints it to PDF through the browser; no PDF engine here).
   Heavy exports run as chunked local jobs (opts.schedule, default setTimeout) with a share-review step:
   an export must be approved by someone other than the requester before it can be released.
   Works as <script> (window.NovaBIReports) and Node. Not wired to a screen yet. */
(function (root) {
  'use strict';
  var MAX_ROWS = 50000, PAGE_MAX = 200, CHUNK = 500;
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cell(v) { return v == null ? '' : String(v); }

  /* def: {id, title, view: action, columns:[{key,label,type?:'number'}], rows:()=>array}. */
  function createReports(opts) {
    opts = opts || {};
    var can = opts.can || function () { return false; };
    var maxRows = opts.maxRows || MAX_ROWS;
    var schedule = opts.schedule || function (fn) { return setTimeout(fn, 0); };
    var now = opts.now || function () { return Date.now(); };
    var defs = {}, jobs = [];

    function define(def) {
      if (!def || !def.id || !Array.isArray(def.columns) || !def.columns.length || typeof def.rows !== 'function') fail('bad-report');
      defs[def.id] = def;
    }
    function get(id) { var d = defs[id]; if (!d) fail('report-not-found'); if (!can(d.view || 'reports.view')) fail('not-permitted'); return d; }
    function list() { return Object.keys(defs).filter(function (k) { return can(defs[k].view || 'reports.view'); }).map(function (k) { return { id: k, title: defs[k].title }; }); }

    /* filter: {q (text, any column), from, to (on dateKey), eq:{key:value}} */
    function filtered(d, f) {
      f = f || {};
      var q = f.q ? String(f.q).trim().toLowerCase() : '', dk = d.dateKey || 'date';
      return d.rows().filter(function (r) {
        if (f.from != null && !(r[dk] >= f.from)) return false;
        if (f.to != null && !(r[dk] <= f.to)) return false;
        if (f.eq) for (var k in f.eq) if (r[k] !== f.eq[k]) return false;
        if (q) return d.columns.some(function (c) { return cell(r[c.key]).toLowerCase().indexOf(q) >= 0; });
        return true;
      });
    }
    function page(id, f, p) {
      var d = get(id); p = p || {};
      var size = Math.min(Math.max(parseInt(p.size, 10) || 50, 1), PAGE_MAX), all = filtered(d, f);
      var pages = Math.max(1, Math.ceil(all.length / size)), no = Math.min(Math.max(parseInt(p.page, 10) || 1, 1), pages);
      return { columns: d.columns, rows: all.slice((no - 1) * size, no * size), page: no, pages: pages, total: all.length };
    }
    function snapshot(id, f) {
      if (!can('data.export')) fail('not-permitted');
      var d = get(id), all = filtered(d, f);
      if (all.length > maxRows) fail('too-many-rows');
      return { def: d, rows: all };
    }

    function csvCell(v) {
      var s = cell(v);
      if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function toCsv(snap) {
      var lines = [snap.def.columns.map(function (c) { return csvCell(c.label); }).join(',')];
      snap.rows.forEach(function (r) { lines.push(snap.def.columns.map(function (c) { return csvCell(r[c.key]); }).join(',')); });
      return '﻿' + lines.join('\r\n') + '\r\n';
    }

    function crcTable() { var t = [], n, k, c; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
    var CRC = null;
    function crc32(b) { CRC = CRC || crcTable(); var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
    function utf8(s) { return new TextEncoder().encode(s); }
    function zip(files) {
      var parts = [], central = [], off = 0;
      function u16(n) { return [n & 255, (n >> 8) & 255]; }
      function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
      files.forEach(function (f) {
        var name = utf8(f.name), data = utf8(f.data), crc = crc32(data);
        var head = [0x50, 0x4b, 3, 4].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
        parts.push(Uint8Array.from(head), name, data);
        central.push(Uint8Array.from([0x50, 0x4b, 1, 2].concat(u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), name);
        off += head.length + name.length + data.length;
      });
      var csize = 0; central.forEach(function (c) { csize += c.length; });
      var end = Uint8Array.from([0x50, 0x4b, 5, 6].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(off), u16(0)));
      var all = parts.concat(central, [end]), len = 0, out, p = 0; all.forEach(function (a) { len += a.length; });
      out = new Uint8Array(len); all.forEach(function (a) { out.set(a, p); p += a.length; });
      return out;
    }
    function colRef(i) { return String.fromCharCode(65 + i); }
    function toXlsx(snap) {
      var cols = snap.def.columns;
      function row(r, vals) {
        return '<row r="' + r + '">' + vals.map(function (v, i) {
          var ref = colRef(i) + r;
          if (r > 1 && cols[i].type === 'number' && v !== '' && isFinite(Number(v))) return '<c r="' + ref + '"><v>' + Number(v) + '</v></c>';
          return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(cell(v)) + '</t></is></c>';
        }).join('') + '</row>';
      }
      var rows = [row(1, cols.map(function (c) { return c.label; }))];
      snap.rows.forEach(function (r, i) { rows.push(row(i + 2, cols.map(function (c) { return r[c.key]; }))); });
      var ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
      return zip([
        { name: '[Content_Types].xml', data: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
        { name: '_rels/.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
        { name: 'xl/workbook.xml', data: X + '<workbook ' + ns + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
        { name: 'xl/worksheets/sheet1.xml', data: X + '<worksheet ' + ns + '><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData>' + rows.join('') + '</sheetData></worksheet>' }
      ]);
    }
    function toPrintHtml(snap) {
      var cols = snap.def.columns;
      return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>' + esc(snap.def.title || snap.def.id) + '</title><style>body{font-family:Tahoma,Arial,sans-serif;direction:rtl}table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:4px 8px;text-align:right}th{background:#eee}@page{size:A4}</style></head><body><h1>' +
        esc(snap.def.title || snap.def.id) + '</h1><table><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        snap.rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(cell(r[c.key])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></body></html>';
    }
    function render(snap, format) {
      if (format === 'csv') return toCsv(snap);
      if (format === 'xlsx') return toXlsx(snap);
      if (format === 'pdf') return toPrintHtml(snap);
      fail('bad-format');
    }

    /* Heavy job: snapshot is taken at request time (so limits/permissions are checked now), rendering runs after.
       States: queued -> pending-review -> approved|rejected -> released. Release needs approval by another actor. */
    function requestExport(id, f, format, actor, done) {
      if (typeof actor !== 'string' || !actor.trim()) fail('actor-required');
      if (['csv', 'xlsx', 'pdf'].indexOf(format) < 0) fail('bad-format');
      var snap = snapshot(id, f);
      var job = { id: 'j' + (jobs.length + 1), report: id, format: format, requestedBy: actor.trim(), at: now(), rows: snap.rows.length, status: 'queued', output: null };
      jobs.push(job);
      schedule(function () {
        try { job.output = render(snap, format); job.status = 'pending-review'; }
        catch (e) { job.status = 'failed'; job.error = e.code || 'failed'; }
        if (done) done(info(job));
      });
      return info(job);
    }
    function info(j) { return { id: j.id, report: j.report, format: j.format, requestedBy: j.requestedBy, rows: j.rows, status: j.status, reviewedBy: j.reviewedBy || null, error: j.error || null }; }
    function job(id) { for (var i = 0; i < jobs.length; i++) if (jobs[i].id === id) return jobs[i]; fail('job-not-found'); }
    function review(id, actor, approve) {
      var j = job(id);
      if (typeof actor !== 'string' || !actor.trim()) fail('actor-required');
      if (j.status !== 'pending-review') fail('not-reviewable');
      if (actor.trim() === j.requestedBy) fail('self-review');
      if (!can('data.export')) fail('not-permitted');
      j.status = approve ? 'approved' : 'rejected'; j.reviewedBy = actor.trim();
      return info(j);
    }
    function release(id) {
      var j = job(id);
      if (j.status !== 'approved') fail('review-required');
      j.status = 'released';
      return j.output;
    }
    function jobList() { return jobs.map(info); }

    return { define: define, list: list, page: page, snapshot: snapshot, render: render, requestExport: requestExport, review: review, release: release, jobs: jobList };
  }

  var api = { createReports: createReports, MAX_ROWS: MAX_ROWS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaBIReports = api;
})(typeof window !== 'undefined' ? window : this);

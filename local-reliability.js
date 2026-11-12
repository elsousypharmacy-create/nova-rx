/* NOVA Rx — OFF-05 local reliability, heavy work queue, health checks, requestId errors, degraded modes (supplier, AI, printer), and Arabic outage runbook.
   Frontend/local only (no backend writes). Works in Node (module.exports) and browser (window.NovaReliability / window.novaReliability). */
(function (root) {
  'use strict';

  var SERVICES = ['supplier', 'ai', 'printer'];
  var MOCK_KEY = 'nova.reliability.mocks';
  var ERR_KEY = 'nova.reliability.errors';
  var QUEUE_KEY = 'nova.reliability.queue';
  var PROBE_KEY = 'nova.reliability.probe';
  var ERR_MAX = 200;
  var QUEUE_MAX = 100;

  var SERVICE_META = {
    supplier: {
      id: 'supplier',
      labelAr: 'الموردون (Supplier)',
      labelEn: 'Supplier service',
      fallbackAr: 'وضع الموردين المخفض: اتصال الموردين متوقف — يتم حفظ النواقص في قائمة التحضير المحلية واستخدام أسعار الكتالوج المسجلة بدون إرسال سلة حية.',
      fallbackEn: 'Supplier degraded mode: supplier mock is down — using local shortage prep list and cached catalog prices only.'
    },
    ai: {
      id: 'ai',
      labelAr: 'الذكاء الاصطناعي (AI)',
      labelEn: 'AI assistant',
      fallbackAr: 'وضع الذكاء الاصطناعي المخفض: خدمة Gemini متوقفة — الإدخال اليدوي للجرعات وفحص التداخلات الدوائية المحلي يعملان مع إلزامية مراجعة الصيدلي.',
      fallbackEn: 'AI degraded mode: AI mock is down — manual dosage entry and local clinical interaction checks remain active with pharmacist review.'
    },
    printer: {
      id: 'printer',
      labelAr: 'الطابعة الحرارية (Printer)',
      labelEn: 'Thermal printer',
      fallbackAr: 'وضع الطابعة المخفض: الطابعة غير متصلة — يُحفظ الإيصال في طابور الطباعة المحلي مع إتاحة تنزيل PDF عربي أو مشاركته رقميًا فورًا.',
      fallbackEn: 'Printer degraded mode: printer mock is down — receipts are queued locally with instant Arabic PDF export.'
    }
  };

  var ERROR_MESSAGES = {
    'supplier-down': ['خدمة الموردين في الوضع المخفض — تم التحول إلى قائمة التحضير المحلية وأسعار الكتالوج.', 'Supplier mock is down — switched to local shortage prep list and catalog prices.'],
    'ai-down': ['خدمة الذكاء الاصطناعي في الوضع المخفض — أدخل البيانات يدويًا واعتمد على الفحص الدوائي المحلي.', 'AI mock is down — use manual entry and local clinical checks.'],
    'printer-down': ['الطابعة غير متصلة (وضع مخفض) — تم حفظ الإيصال لإعادة الطباعة ويمكنك تنزيل PDF الآن.', 'Printer is disconnected (degraded mode) — receipt queued locally; export PDF instead.'],
    'printer-disconnected': ['الطابعة غير متصلة (وضع مخفض) — تم حفظ الإيصال لإعادة الطباعة ويمكنك تنزيل PDF الآن.', 'Printer is disconnected (degraded mode) — receipt queued locally; export PDF instead.'],
    'storage-down': ['تعذر القراءة أو الكتابة في التخزين المحلي على هذا الجهاز — تحقق من المساحة المتاحة.', 'Local storage read/write failed on this device — check available space.'],
    'heavy-job-failed': ['تعذر إكمال المهمة الثقيلة في الطابور المحلي — يمكنك إعادة المحاولة.', 'Heavy local job failed — you can retry the job from the queue.']
  };

  var RUNBOOK = Object.freeze({
    id: 'OFF-05-RUNBOOK',
    titleAr: 'دليل التعامل مع الأعطال والانقطاع (OFF-05)',
    titleEn: 'Local Outage & Degraded Mode Runbook (OFF-05)',
    owner: Object.freeze({
      name: 'د. أحمد السوسي',
      roleAr: 'مالك الصيدلية والمدير المسؤول (Primary Incident Owner)',
      roleEn: 'Pharmacy Owner & Primary Incident Lead',
      onDutyAr: 'الصيدلي المدير المناوب بالفرع (On-Duty Pharmacist)',
      contactChannelAr: 'قناة طوارئ الصيدلية (واتساب الطوارئ + اتصال هاتفي مباشر بالحالات الحرجة P0)'
    }),
    alertPath: Object.freeze([
      Object.freeze({
        step: 1,
        stageAr: 'تنبيه فوري بالواجهة (UI Banner & Toast)',
        detailAr: 'إظهار شريط الوضع المخفض وتنبيه الخطأ متضمنًا معرف الطلب (requestId) وحالة الفحص الصحي (health) والبديل المحلي.'
      }),
      Object.freeze({
        step: 2,
        stageAr: 'تسجيل تلقائي في سجل الأعطال المحلي (Local Error Log)',
        detailAr: 'توثيق العطل في nova.reliability.errors مع requestId والمكوّن المتأثر ولقطة health والطابع الزمني.'
      }),
      Object.freeze({
        step: 3,
        stageAr: 'تصعيد للمسؤول (د. أحمد السوسي)',
        detailAr: 'اتصال هاتفي فوري + رسالة واتساب طوارئ تتضمن requestId خلال 5 دقائق للأعطال الحرجة (P0) وخلال 15 دقيقة لاستمرار الوضع المخفض (P1).'
      })
    ]),
    degradedProcedures: Object.freeze({
      supplier: 'إيقاف إرسال سلة الموردين الحية؛ حفظ النواقص في قائمة التحضير المحلية (BUY-04) وعدم فك قفل أي عملية معلقة إلا بموافقة المالك.',
      ai: 'إيقاف استدعاء Gemini؛ إدخال الجرعات وفواتير الشراء يدويًا مع تفعيل فحص التداخلات الدوائية المحلي (CLN-03) ومراجعة الصيدلي.',
      printer: 'حفظ الإيصال في طابور الطباعة المحلي وإصدار إيصال PDF عربي أو مشاركته رقميًا (POS-05) ثم إعادة الطباعة عند عودة الاتصال.',
      queue: 'تشغيل الأعمال الثقيلة (التصدير، الفهرسة، تجميع التقارير) على دفعات في الطابور المحلي دون تجميد شاشة البيع.'
    }),
    recoveryChecklist: Object.freeze([
      'تشغيل الفحص الصحي المحلي (checkHealth) والتأكد من عودة جميع المكونات إلى الحالة ok.',
      'استكمال المهام المعلقة في طابور الأعمال الثقيلة (runAllHeavyWork) وطابور الطباعة المحلي بدون تكرار.',
      'مراجعة طابور المزامنة (OFF-03 Outbox) واعتماد حل أي تعارضات (needs-review) بواسطة المدير أو المالك.'
    ])
  });

  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  function create(opts) {
    opts = opts || {};
    var storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : createMemoryStorage());
    var nowFn = opts.now || function () { return Date.now(); };
    var randFn = opts.rand || function () { return Math.random(); };
    var onError = typeof opts.onError === 'function' ? opts.onError : null;
    var onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : null;
    var seq = 0;
    var handlers = {};
    var runningQueue = false;

    function nextRequestId(prefix) {
      seq += 1;
      var t = nowFn();
      var d = new Date(t);
      var ymd = String(d.getUTCFullYear()) +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        String(d.getUTCDate()).padStart(2, '0');
      var rnd = Math.floor(randFn() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
      var p = String(prefix || 'REQ').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'REQ';
      return p + '-' + ymd + '-' + String(seq).padStart(4, '0') + '-' + rnd;
    }

    function defaultMocks() {
      var out = {};
      SERVICES.forEach(function (id) {
        out[id] = { id: id, status: 'ok', reason: '', updatedAt: new Date(nowFn()).toISOString(), requestId: null };
      });
      return out;
    }

    function readMocks() {
      var base = defaultMocks();
      try {
        var raw = storage.getItem(MOCK_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            SERVICES.forEach(function (id) {
              if (parsed[id] && (parsed[id].status === 'down' || parsed[id].status === 'degraded')) {
                base[id] = {
                  id: id,
                  status: 'down',
                  reason: String(parsed[id].reason || ''),
                  updatedAt: String(parsed[id].updatedAt || base[id].updatedAt),
                  requestId: parsed[id].requestId || null
                };
              } else if (parsed[id] && parsed[id].status === 'ok') {
                base[id] = {
                  id: id,
                  status: 'ok',
                  reason: '',
                  updatedAt: String(parsed[id].updatedAt || base[id].updatedAt),
                  requestId: parsed[id].requestId || null
                };
              }
            });
          }
        }
      } catch (_) {}
      return base;
    }

    function writeMocks(mocks) {
      try { storage.setItem(MOCK_KEY, JSON.stringify(mocks)); } catch (_) {}
    }

    function decorateService(entry) {
      var meta = SERVICE_META[entry.id];
      var down = entry.status !== 'ok';
      return {
        id: entry.id,
        status: down ? 'degraded' : 'ok',
        mockStatus: down ? 'down' : 'ok',
        degraded: down,
        reason: entry.reason || '',
        updatedAt: entry.updatedAt,
        requestId: entry.requestId || null,
        labelAr: meta.labelAr,
        labelEn: meta.labelEn,
        fallbackAr: down ? meta.fallbackAr : '',
        fallbackEn: down ? meta.fallbackEn : ''
      };
    }

    function getMockState(service) {
      if (SERVICES.indexOf(service) < 0) throw new Error('unknown-service');
      var mocks = readMocks();
      return decorateService(mocks[service]);
    }

    function setMockState(service, statusOrBool, reason) {
      if (SERVICES.indexOf(service) < 0) throw new Error('unknown-service');
      var isDown = statusOrBool === false || statusOrBool === 'down' || statusOrBool === 'degraded';
      var mocks = readMocks();
      var reqId = nextRequestId('SVC');
      mocks[service] = {
        id: service,
        status: isDown ? 'down' : 'ok',
        reason: isDown ? String(reason || (service + '-mock-down')) : '',
        updatedAt: new Date(nowFn()).toISOString(),
        requestId: reqId
      };
      writeMocks(mocks);
      var state = decorateService(mocks[service]);
      if (onStateChange) {
        try { onStateChange(state); } catch (_) {}
      }
      return state;
    }

    function degradedServices() {
      var mocks = readMocks();
      return SERVICES.map(function (id) { return decorateService(mocks[id]); }).filter(function (s) { return s.degraded; });
    }

    function isDegraded(service) {
      if (service) return getMockState(service).degraded;
      return degradedServices().length > 0;
    }

    function readQueue() {
      try {
        var raw = storage.getItem(QUEUE_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (_) {
        return [];
      }
    }

    function writeQueue(arr) {
      var trimmed = arr.slice(-QUEUE_MAX);
      storage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
      return trimmed;
    }

    function probeStorage() {
      var token = 'ok-' + String(nowFn());
      try {
        storage.setItem(PROBE_KEY, token);
        var back = storage.getItem(PROBE_KEY);
        if (typeof storage.removeItem === 'function') storage.removeItem(PROBE_KEY);
        return back === token ? { status: 'ok', detail: 'read-write-verified' } : { status: 'down', detail: 'probe-mismatch' };
      } catch (e) {
        return { status: 'down', detail: String((e && e.message) || 'storage-error') };
      }
    }

    function checkHealth(checkOpts) {
      checkOpts = checkOpts || {};
      var reqId = checkOpts.requestId || nextRequestId('HLTH');
      var checkedAt = new Date(nowFn()).toISOString();
      var stProbe = probeStorage();
      var mocks = readMocks();
      if (typeof checkOpts.printerConnected === 'boolean') {
        mocks.printer.status = checkOpts.printerConnected ? 'ok' : 'down';
      }
      var q = readQueue();
      var failedJobs = q.filter(function (j) { return j.status === 'failed'; }).length;
      var pendingJobs = q.filter(function (j) { return j.status === 'queued' || j.status === 'running'; }).length;
      var components = {
        storage: { status: stProbe.status, detail: stProbe.detail },
        supplier: decorateService(mocks.supplier),
        ai: decorateService(mocks.ai),
        printer: decorateService(mocks.printer),
        queue: {
          status: failedJobs > 0 ? 'degraded' : 'ok',
          queued: pendingJobs,
          failed: failedJobs,
          total: q.length
        }
      };
      var degList = SERVICES.map(function (id) { return components[id]; }).filter(function (c) { return c.degraded; });
      var overall = 'ok';
      if (components.storage.status === 'down') overall = 'down';
      else if (degList.length > 0 || components.queue.status !== 'ok') overall = 'degraded';

      var degNamesAr = degList.map(function (d) { return d.labelAr; });
      var degNamesEn = degList.map(function (d) { return d.labelEn; });
      var summaryAr = overall === 'ok'
        ? 'الفحص الصحي سليم (ok) — جميع الخدمات المحلية جاهزة.'
        : overall === 'down'
          ? 'عطل حرج (down) — التخزين المحلي غير متاح، انتقل فورًا لوضع الطوارئ وأبلغ المسؤول.'
          : 'النظام يعمل في الوضع المخفض (degraded): ' + (degNamesAr.length ? degNamesAr.join('، ') : 'طابور المهام الثقيلة') + '.';
      var summaryEn = overall === 'ok'
        ? 'Health check ok — all local services ready.'
        : overall === 'down'
          ? 'Health critical (down) — local storage unavailable; switch to emergency mode and alert owner.'
          : 'System operating in degraded mode: ' + (degNamesEn.length ? degNamesEn.join(', ') : 'heavy work queue') + '.';

      return {
        ok: overall === 'ok',
        status: overall,
        requestId: reqId,
        checkedAt: checkedAt,
        components: components,
        degradedServices: degList,
        summaryAr: summaryAr,
        summaryEn: summaryEn
      };
    }

    function readErrors() {
      try {
        var raw = storage.getItem(ERR_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (_) {
        return [];
      }
    }

    function writeErrors(arr) {
      try { storage.setItem(ERR_KEY, JSON.stringify(arr.slice(-ERR_MAX))); } catch (_) {}
    }

    function formatUserError(errRecord, lang) {
      var isEn = lang === 'en';
      var msg = isEn ? errRecord.messageEn : errRecord.messageAr;
      var healthLabel = isEn
        ? ('Health: ' + errRecord.health.status)
        : ('الحالة الصحية: ' + errRecord.health.status);
      var reqLabel = isEn
        ? ('Request ID: ' + errRecord.requestId)
        : ('معرف الطلب: ' + errRecord.requestId);
      return msg + ' [' + reqLabel + ' · ' + healthLabel + ']';
    }

    function reportError(input) {
      var raw = typeof input === 'string' ? { code: input } : (input || {});
      var code = String(raw.code || (raw.error && raw.error.code) || raw.message || 'local-error').trim();
      var component = String(raw.component || (SERVICES.indexOf(code.split('-')[0]) >= 0 ? code.split('-')[0] : 'app'));
      var reqId = String(raw.requestId || nextRequestId('ERR'));
      var h = checkHealth({ requestId: reqId });
      var pair = ERROR_MESSAGES[code] || [
        String(raw.messageAr || raw.message || ('حدث خطأ محلي (' + code + ') — راجع الحالة الصحية أو أعد المحاولة.')),
        String(raw.messageEn || raw.message || ('Local error (' + code + ') — check health status or retry.'))
      ];
      var fallbackAr = SERVICE_META[component] ? SERVICE_META[component].fallbackAr : '';
      var fallbackEn = SERVICE_META[component] ? SERVICE_META[component].fallbackEn : '';
      var rec = {
        requestId: reqId,
        code: code,
        component: component,
        at: new Date(nowFn()).toISOString(),
        messageAr: pair[0],
        messageEn: pair[1],
        fallbackAr: fallbackAr,
        fallbackEn: fallbackEn,
        detail: raw.detail ? String(raw.detail) : '',
        health: {
          status: h.status,
          ok: h.ok,
          requestId: h.requestId,
          checkedAt: h.checkedAt,
          degradedServices: h.degradedServices.map(function (d) { return d.id; }),
          components: {
            storage: h.components.storage.status,
            supplier: h.components.supplier.status,
            ai: h.components.ai.status,
            printer: h.components.printer.status,
            queue: h.components.queue.status
          }
        }
      };
      rec.userTextAr = formatUserError(rec, 'ar');
      rec.userTextEn = formatUserError(rec, 'en');
      var list = readErrors();
      list.push(rec);
      writeErrors(list);
      if (onError) {
        try { onError(copy(rec)); } catch (_) {}
      }
      return copy(rec);
    }

    function guardService(service, actionFn, fallbackFn) {
      if (SERVICES.indexOf(service) < 0) throw new Error('unknown-service');
      var st = getMockState(service);
      if (st.degraded) {
        var errRec = reportError({ code: service + '-down', component: service, detail: st.reason });
        var fb = typeof fallbackFn === 'function' ? fallbackFn(errRec, st) : null;
        return Promise.resolve({ ok: false, degraded: true, service: service, state: st, error: errRec, fallback: fb });
      }
      return Promise.resolve()
        .then(function () { return actionFn(); })
        .then(
          function (res) { return { ok: true, degraded: false, service: service, state: st, result: res }; },
          function (err) {
            setMockState(service, 'down', (err && err.message) || (service + '-error'));
            var nextSt = getMockState(service);
            var errRec = reportError({
              code: service + '-down',
              component: service,
              detail: String((err && err.message) || err || '')
            });
            var fb = typeof fallbackFn === 'function' ? fallbackFn(errRec, nextSt) : null;
            return { ok: false, degraded: true, service: service, state: nextSt, error: errRec, fallback: fb };
          }
        );
    }

    /* ---------- Heavy Local Work Queue ---------- */
    function registerHeavyHandler(type, fn) {
      if (!type || typeof fn !== 'function') throw new Error('bad-handler');
      handlers[type] = fn;
    }

    // Built-in heavy work processors (chunked, non-blocking)
    handlers['catalog-reindex'] = function (job, step) {
      var items = Array.isArray(job.items) ? job.items : [];
      var indexed = 0;
      return step(items, function (item) {
        if (item && (item.name || item.code || item.barcode)) indexed += 1;
      }).then(function () { return { indexed: indexed }; });
    };
    handlers['report-aggregation'] = function (job, step) {
      var items = Array.isArray(job.items) ? job.items : [];
      var sum = 0, count = 0;
      return step(items, function (inv) {
        sum += Number(inv && inv.total) || 0;
        count += 1;
      }).then(function () { return { invoices: count, total: Math.round(sum * 100) / 100 }; });
    };
    handlers['backup-prepare'] = function (job, step) {
      var items = Array.isArray(job.items) ? job.items : [];
      var rows = [];
      return step(items, function (row) { rows.push(row); }).then(function () {
        return { count: rows.length, bytes: JSON.stringify(rows).length };
      });
    };

    function enqueueHeavyWork(spec) {
      if (!spec || typeof spec !== 'object') throw new Error('bad-job');
      var type = String(spec.type || 'custom').trim();
      if (!type) throw new Error('missing-job-type');
      var key = spec.key ? String(spec.key).trim() : null;
      var q = readQueue();
      if (key) {
        for (var i = 0; i < q.length; i++) {
          if (q[i].key === key && (q[i].status === 'queued' || q[i].status === 'running' || q[i].status === 'completed')) {
            return copy(q[i]);
          }
        }
      }
      var items = Array.isArray(spec.items) ? copy(spec.items) : [];
      var chunkSize = Math.max(1, Math.min(500, Number(spec.chunkSize) || 25));
      var reqId = spec.requestId || nextRequestId('JOB');
      var id = spec.id || ('job-' + String(nowFn()) + '-' + String(seq));
      if (typeof spec.processor === 'function') {
        handlers['__job_' + id] = spec.processor;
      }
      var entry = {
        id: id,
        key: key,
        requestId: reqId,
        type: type,
        label: String(spec.label || type),
        status: 'queued',
        chunkSize: chunkSize,
        items: items,
        payload: spec.payload !== undefined ? copy(spec.payload) : null,
        progress: { processed: 0, total: items.length || 1, chunks: 0 },
        attempts: 0,
        queuedAt: new Date(nowFn()).toISOString(),
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        result: null,
        lastError: null
      };
      q.push(entry);
      writeQueue(q);
      if (onStateChange) {
        try { onStateChange({ type: 'queue', job: copy(entry) }); } catch (_) {}
      }
      return copy(entry);
    }

    function processChunks(items, chunkSize, eachFn, onChunk) {
      if (!items.length) {
        return Promise.resolve().then(function () {
          eachFn(null, 0);
          if (onChunk) onChunk(1, 1, 1);
        });
      }
      var idx = 0, chunks = 0;
      function nextSlice() {
        if (idx >= items.length) return Promise.resolve();
        return new Promise(function (resolve) { setTimeout(resolve, 0); }).then(function () {
          var end = Math.min(idx + chunkSize, items.length);
          for (var i = idx; i < end; i++) {
            eachFn(items[i], i);
          }
          idx = end;
          chunks += 1;
          if (onChunk) onChunk(idx, items.length, chunks);
          return nextSlice();
        });
      }
      return nextSlice();
    }

    function executeJobById(jobId) {
      var q = readQueue();
      var target = null;
      for (var i = 0; i < q.length; i++) {
        if (q[i].id === jobId) { target = q[i]; break; }
      }
      if (!target) return Promise.resolve(null);
      var t0 = nowFn();
      target.status = 'running';
      target.attempts += 1;
      target.startedAt = new Date(t0).toISOString();
      target.lastError = null;
      writeQueue(q);

      var stepHelper = function (items, fn) {
        return processChunks(items, target.chunkSize || 25, fn, function (done, total, chunks) {
          var curQ = readQueue();
          for (var k = 0; k < curQ.length; k++) {
            if (curQ[k].id === jobId) {
              curQ[k].progress = { processed: done, total: total, chunks: chunks };
              break;
            }
          }
          writeQueue(curQ);
        });
      };

      var customFn = handlers['__job_' + jobId] || handlers[target.type];
      var runPromise = Promise.resolve().then(function () {
        if (customFn) return customFn(copy(target), stepHelper);
        var count = 0;
        return stepHelper(target.items || [], function () { count += 1; }).then(function () {
          return { processed: count };
        });
      });

      return runPromise.then(
        function (res) {
          var curQ = readQueue(), doneJob = null;
          var t1 = nowFn();
          for (var k = 0; k < curQ.length; k++) {
            if (curQ[k].id === jobId) {
              curQ[k].status = 'completed';
              curQ[k].finishedAt = new Date(t1).toISOString();
              curQ[k].durationMs = Math.max(0, t1 - t0);
              curQ[k].result = res !== undefined ? res : { ok: true };
              if (curQ[k].progress.processed < curQ[k].progress.total) {
                curQ[k].progress.processed = curQ[k].progress.total;
                curQ[k].progress.chunks = Math.max(1, curQ[k].progress.chunks);
              }
              doneJob = copy(curQ[k]);
              break;
            }
          }
          writeQueue(curQ);
          if (onStateChange && doneJob) {
            try { onStateChange({ type: 'queue', job: doneJob }); } catch (_) {}
          }
          return doneJob;
        },
        function (err) {
          var errRec = reportError({
            code: 'heavy-job-failed',
            component: 'queue',
            requestId: target.requestId,
            detail: String((err && err.message) || err || 'job-error')
          });
          var curQ = readQueue(), failedJob = null;
          var t1 = nowFn();
          for (var k = 0; k < curQ.length; k++) {
            if (curQ[k].id === jobId) {
              curQ[k].status = 'failed';
              curQ[k].finishedAt = new Date(t1).toISOString();
              curQ[k].durationMs = Math.max(0, t1 - t0);
              curQ[k].lastError = {
                requestId: errRec.requestId,
                code: errRec.code,
                detail: errRec.detail,
                healthStatus: errRec.health.status
              };
              failedJob = copy(curQ[k]);
              break;
            }
          }
          writeQueue(curQ);
          if (onStateChange && failedJob) {
            try { onStateChange({ type: 'queue', job: failedJob }); } catch (_) {}
          }
          return failedJob;
        }
      );
    }

    function runNextHeavyJob() {
      if (runningQueue) return Promise.resolve({ skipped: true, job: null });
      var q = readQueue();
      var next = null;
      for (var i = 0; i < q.length; i++) {
        if (q[i].status === 'queued') { next = q[i]; break; }
      }
      if (!next) return Promise.resolve({ skipped: false, job: null });
      runningQueue = true;
      return executeJobById(next.id).then(
        function (job) { runningQueue = false; return { skipped: false, job: job }; },
        function (e) { runningQueue = false; throw e; }
      );
    }

    function runAllHeavyWork() {
      if (runningQueue) return Promise.resolve({ skipped: true, completed: 0, failed: 0, jobs: [] });
      var completed = 0, failed = 0, jobs = [];
      function loop() {
        var q = readQueue();
        var next = null;
        for (var i = 0; i < q.length; i++) {
          if (q[i].status === 'queued') { next = q[i]; break; }
        }
        if (!next) return Promise.resolve({ skipped: false, completed: completed, failed: failed, jobs: jobs });
        runningQueue = true;
        return executeJobById(next.id).then(function (done) {
          runningQueue = false;
          if (done) {
            jobs.push(done);
            if (done.status === 'completed') completed += 1;
            else if (done.status === 'failed') failed += 1;
          }
          return loop();
        }, function (e) {
          runningQueue = false;
          throw e;
        });
      }
      return loop();
    }

    function retryHeavyJob(jobId) {
      var q = readQueue(), found = null;
      for (var i = 0; i < q.length; i++) {
        if (q[i].id === jobId) {
          if (q[i].status !== 'failed') throw new Error('job-not-failed');
          q[i].status = 'queued';
          q[i].lastError = null;
          q[i].progress.processed = 0;
          q[i].progress.chunks = 0;
          found = copy(q[i]);
          break;
        }
      }
      if (!found) throw new Error('job-not-found');
      writeQueue(q);
      return found;
    }

    function clearCompletedJobs() {
      var q = readQueue().filter(function (j) { return j.status !== 'completed'; });
      writeQueue(q);
      return q.map(copy);
    }

    return {
      SERVICES: SERVICES.slice(),
      SERVICE_META: copy(SERVICE_META),
      RUNBOOK: RUNBOOK,
      getRunbook: function () { return RUNBOOK; },
      nextRequestId: nextRequestId,
      getMockState: getMockState,
      setMockState: setMockState,
      degradedServices: degradedServices,
      isDegraded: isDegraded,
      guardService: guardService,
      checkHealth: checkHealth,
      reportError: reportError,
      formatUserError: formatUserError,
      errors: function () { return readErrors().map(copy); },
      clearErrors: function () { try { storage.removeItem(ERR_KEY); } catch (_) {} },
      registerHeavyHandler: registerHeavyHandler,
      enqueueHeavyWork: enqueueHeavyWork,
      runNextHeavyJob: runNextHeavyJob,
      runAllHeavyWork: runAllHeavyWork,
      retryHeavyJob: retryHeavyJob,
      heavyQueue: function () { return readQueue().map(copy); },
      clearCompletedJobs: clearCompletedJobs
    };
  }

  function createMemoryStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  var api = {
    SERVICES: SERVICES,
    SERVICE_META: SERVICE_META,
    RUNBOOK: RUNBOOK,
    create: create,
    createMemoryStorage: createMemoryStorage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  root.NovaReliability = api;

  /* ---------- Browser UI Wiring ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isEn() {
    try {
      return (root.document && root.document.documentElement.lang === 'en') ||
        (root.localStorage && root.localStorage.getItem('nova-rx-language') === 'en');
    } catch (_) { return false; }
  }
  function tr(ar, en) { return isEn() ? en : ar; }

  var instance = create({
    storage: root.localStorage,
    onError: function (errRec) {
      renderErrorBanner(errRec);
      renderDegradedBanner();
      mountSettingsCard();
    },
    onStateChange: function () {
      renderDegradedBanner();
      mountSettingsCard();
    }
  });
  root.novaReliability = instance;

  function ensureBanners() {
    if (!root.document || !root.document.body) return null;
    var deg = root.document.getElementById('novaDegradedBanner');
    if (!deg) {
      deg = root.document.createElement('div');
      deg.id = 'novaDegradedBanner';
      deg.setAttribute('role', 'status');
      deg.setAttribute('aria-live', 'polite');
      deg.hidden = true;
      deg.style.cssText = 'background:#1b150a;color:#f5e6c8;border-bottom:1px solid #6b5322;padding:8px 16px;font-size:13px;display:none;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;z-index:8500';
      root.document.body.insertBefore(deg, root.document.body.firstChild);
    }
    var err = root.document.getElementById('novaErrorBanner');
    if (!err) {
      err = root.document.createElement('div');
      err.id = 'novaErrorBanner';
      err.setAttribute('role', 'alert');
      err.hidden = true;
      err.style.cssText = 'background:#241114;color:#ffd2cc;border-bottom:1px solid #753038;padding:8px 16px;font-size:13px;display:none;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;z-index:8501';
      root.document.body.insertBefore(err, deg.nextSibling);
    }
    return { deg: deg, err: err };
  }

  function renderDegradedBanner() {
    var b = ensureBanners();
    if (!b) return;
    var list = instance.degradedServices();
    if (!list.length) {
      b.deg.hidden = true;
      b.deg.style.display = 'none';
      b.deg.innerHTML = '';
      return;
    }
    var h = instance.checkHealth();
    b.deg.hidden = false;
    b.deg.style.display = 'flex';
    b.deg.setAttribute('data-health-status', h.status);
    b.deg.setAttribute('data-degraded-services', list.map(function (s) { return s.id; }).join(','));
    var itemsHtml = list.map(function (s) {
      return '<span data-degraded-item="' + esc(s.id) + '" style="display:inline-block;margin-inline-end:10px"><strong>' +
        esc(tr(s.labelAr, s.labelEn)) + ':</strong> ' + esc(tr(s.fallbackAr, s.fallbackEn)) + '</span>';
    }).join(' ');
    b.deg.innerHTML =
      '<div style="flex:1;min-width:240px">' +
        '<strong style="color:#ffd97d">' + esc(tr('⚠ الوضع المخفض نشط (Degraded Mode)', '⚠ Degraded Mode Active')) + '</strong> · ' +
        '<span data-health-badge="' + esc(h.status) + '">' + esc(tr('الحالة الصحية: ', 'Health: ') + h.status) + '</span> · ' +
        '<code dir="ltr" data-health-request-id="' + esc(h.requestId) + '" style="color:#9ed5f0">' + esc(h.requestId) + '</code>' +
        '<div style="margin-top:4px">' + itemsHtml + '</div>' +
      '</div>' +
      '<button type="button" id="novaRestoreMocksBtn" style="min-height:38px;min-width:44px;padding:6px 12px;background:#22303c;color:#e7ebf0;border:1px solid #486176;border-radius:8px;font-size:13px;font-family:inherit;cursor:pointer">' +
        esc(tr('استعادة الخدمات', 'Restore services')) +
      '</button>';
    var btn = b.deg.querySelector('#novaRestoreMocksBtn');
    if (btn) {
      btn.onclick = function () {
        SERVICES.forEach(function (id) { instance.setMockState(id, 'ok'); });
        if (root.novaReceipt && typeof root.novaReceipt.setPrinterConnected === 'function') {
          root.novaReceipt.setPrinterConnected(true);
        }
        renderDegradedBanner();
        mountSettingsCard();
      };
    }
  }

  function renderErrorBanner(errRec) {
    var b = ensureBanners();
    if (!b || !errRec) return;
    b.err.hidden = false;
    b.err.style.display = 'flex';
    b.err.setAttribute('data-request-id', errRec.requestId);
    b.err.setAttribute('data-health-status', errRec.health.status);
    b.err.setAttribute('data-error-code', errRec.code);
    b.err.innerHTML =
      '<div style="flex:1;min-width:240px">' +
        '<strong>' + esc(tr(errRec.messageAr, errRec.messageEn)) + '</strong> ' +
        '<span style="color:#f4b4ab">[' + esc(tr('معرف الطلب: ', 'Request ID: ')) +
          '<code dir="ltr" id="novaLastErrorReqId">' + esc(errRec.requestId) + '</code> · ' +
          esc(tr('الحالة الصحية: ', 'Health: ')) +
          '<strong id="novaLastErrorHealth">' + esc(errRec.health.status) + '</strong>]</span>' +
      '</div>' +
      '<button type="button" id="novaDismissErrorBtn" style="min-height:38px;min-width:44px;padding:6px 12px;background:#33191d;color:#ffd2cc;border:1px solid #753038;border-radius:8px;font-size:13px;font-family:inherit;cursor:pointer">' +
        esc(tr('إغلاق', 'Dismiss')) +
      '</button>';
    var closeBtn = b.err.querySelector('#novaDismissErrorBtn');
    if (closeBtn) {
      closeBtn.onclick = function () {
        b.err.hidden = true;
        b.err.style.display = 'none';
      };
    }
  }

  function mountSettingsCard() {
    if (!root.document) return;
    var grid = root.document.querySelector('.nova-settings-grid');
    if (!grid) return;
    var host = root.document.getElementById('novaReliabilityCard');
    if (!host) {
      host = root.document.createElement('div');
      host.id = 'novaReliabilityCard';
      host.className = 'nova-setting-card';
      host.style.gridColumn = '1 / -1';
      grid.appendChild(host);
    }
    var h = instance.checkHealth({
      printerConnected: root.novaReceipt && typeof root.novaReceipt.isPrinterConnected === 'function'
        ? root.novaReceipt.isPrinterConnected()
        : undefined
    });
    var q = instance.heavyQueue();
    var errs = instance.errors().slice(-5).reverse();
    var rb = instance.getRunbook();
    var btnStyle = 'min-height:38px;min-width:44px;padding:6px 12px;background:#1b242d;color:#e7ebf0;border:1px solid #3c4d5e;border-radius:8px;font-size:13px;font-family:inherit;cursor:pointer';

    var svcRows = SERVICES.map(function (id) {
      var st = instance.getMockState(id);
      var statusText = st.degraded ? tr('وضع مخفض (down)', 'degraded (down)') : tr('متصل (ok)', 'online (ok)');
      var toggleLabel = st.degraded ? tr('إعادة تفعيل', 'Restore') : tr('محاكاة عطل', 'Simulate down');
      return '<div data-service-row="' + esc(id) + '" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #26303a;font-size:13px">' +
        '<div><strong>' + esc(tr(st.labelAr, st.labelEn)) + '</strong> · <span data-service-state="' + esc(id) + '" style="color:' + (st.degraded ? '#ffd97d' : '#69c6a8') + '">' + esc(statusText) + '</span>' +
        (st.degraded ? '<div style="color:#d8c7a0;font-size:12px;margin-top:2px">' + esc(tr(st.fallbackAr, st.fallbackEn)) + '</div>' : '') +
        '</div>' +
        '<button type="button" data-toggle-mock="' + esc(id) + '" style="' + btnStyle + '">' + esc(toggleLabel) + '</button>' +
      '</div>';
    }).join('');

    var queueHtml = q.length
      ? q.slice(-5).map(function (j) {
          return '<li data-job-id="' + esc(j.id) + '" style="margin:4px 0;font-size:12px;color:#d6dee6">' +
            '<strong>' + esc(j.label) + '</strong> · <span>' + esc(j.status) + '</span> · ' +
            '<span>' + esc(j.progress.processed + '/' + j.progress.total) + '</span> · ' +
            '<code dir="ltr">' + esc(j.requestId) + '</code>' +
          '</li>';
        }).join('')
      : '<li style="font-size:12px;color:#9eacb9">' + esc(tr('لا توجد مهام ثقيلة في الطابور', 'No heavy jobs queued')) + '</li>';

    var errsHtml = errs.length
      ? errs.map(function (e) {
          return '<li data-error-item="' + esc(e.requestId) + '" style="margin:4px 0;font-size:12px;color:#ffb4a8">' +
            '<code dir="ltr">' + esc(e.requestId) + '</code> · <strong>' + esc(e.code) + '</strong> · ' +
            '<span>' + esc(tr('الصحة: ', 'health: ') + e.health.status) + '</span> — ' +
            esc(tr(e.messageAr, e.messageEn)) +
          '</li>';
        }).join('')
      : '<li style="font-size:12px;color:#9eacb9">' + esc(tr('لا توجد أخطاء مسجلة', 'No errors recorded')) + '</li>';

    host.innerHTML =
      '<h3>' + esc(tr('الاعتمادية والوضع المخفض ودليل الأعطال (OFF-05)', 'Local Reliability, Degraded Mode & Outage Runbook (OFF-05)')) + '</h3>' +
      '<p id="novaHealthSummary" data-health-status="' + esc(h.status) + '" data-health-req="' + esc(h.requestId) + '" style="font-size:13px;color:#e7ebf0;margin:6px 0">' +
        '<strong>' + esc(tr('الفحص الصحي:', 'Health check:')) + '</strong> ' + esc(tr(h.summaryAr, h.summaryEn)) +
        ' · <code dir="ltr" id="novaHealthReqId">' + esc(h.requestId) + '</code>' +
      '</p>' +
      '<div style="margin:8px 0">' + svcRows + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">' +
        '<button type="button" id="novaRunHealthBtn" style="' + btnStyle + '">' + esc(tr('فحص الصحة الآن', 'Run health check')) + '</button>' +
        '<button type="button" id="novaEnqueueHeavyBtn" style="' + btnStyle + '">' + esc(tr('جدولة وتشغيل مهمة ثقيلة (فهرسة الكتالوج)', 'Queue & run heavy catalog reindex')) + '</button>' +
        '<button type="button" id="novaTestErrorBtn" style="' + btnStyle + '">' + esc(tr('اختبار رسالة خطأ بمعرف طلب', 'Test error with requestId')) + '</button>' +
      '</div>' +
      '<h4 style="margin:10px 0 4px;font-size:13px;color:#e7ebf0">' + esc(tr('طابور الأعمال الثقيلة المحلي', 'Heavy Local Work Queue')) + ' (<span id="novaHeavyQueueCount">' + q.length + '</span>)</h4>' +
      '<ul id="novaHeavyQueueList" style="margin:4px 0 10px;padding-inline-start:18px">' + queueHtml + '</ul>' +
      '<h4 style="margin:10px 0 4px;font-size:13px;color:#e7ebf0">' + esc(tr('سجل الأخطاء المحسوبة (مع requestId وحالة الصحة)', 'Structured Error Log (with requestId & health)')) + '</h4>' +
      '<ul id="novaReliabilityErrors" style="margin:4px 0 10px;padding-inline-start:18px">' + errsHtml + '</ul>' +
      '<div id="novaRunbookBox" style="margin-top:10px;padding:10px 12px;background:#0e1419;border:1px solid #303841;border-radius:8px;font-size:12px;color:#d6dee6">' +
        '<strong style="font-size:13px;color:#e7ebf0">' + esc(rb.titleAr) + '</strong>' +
        '<div style="margin-top:4px"><strong>المسؤول (Owner):</strong> <span id="novaRunbookOwner">' + esc(rb.owner.name + ' — ' + rb.owner.roleAr) + '</span> · المناوب: ' + esc(rb.owner.onDutyAr) + '</div>' +
        '<div style="margin-top:4px"><strong>مسار الإنذار والتصعيد (Alert Path):</strong> <span id="novaRunbookAlertPath">' +
          esc(rb.alertPath.map(function (a) { return a.step + ') ' + a.stageAr + ': ' + a.detailAr; }).join(' | ')) +
        '</span></div>' +
      '</div>';

    host.querySelectorAll('[data-toggle-mock]').forEach(function (btn) {
      btn.onclick = function () {
        var svc = btn.getAttribute('data-toggle-mock');
        var cur = instance.getMockState(svc);
        var nextDown = !cur.degraded;
        instance.setMockState(svc, nextDown ? 'down' : 'ok', nextDown ? 'manual-toggle' : '');
        if (svc === 'printer' && root.novaReceipt && typeof root.novaReceipt.setPrinterConnected === 'function') {
          root.novaReceipt.setPrinterConnected(!nextDown);
        }
        if (nextDown) {
          instance.reportError({ code: svc + '-down', component: svc, detail: 'simulated-outage' });
        } else {
          renderDegradedBanner();
          mountSettingsCard();
        }
      };
    });

    var hBtn = host.querySelector('#novaRunHealthBtn');
    if (hBtn) hBtn.onclick = function () { mountSettingsCard(); renderDegradedBanner(); };

    var qBtn = host.querySelector('#novaEnqueueHeavyBtn');
    if (qBtn) {
      qBtn.onclick = function () {
        var catalogItems = (root.novaCatalog && Array.isArray(root.novaCatalog.items) && root.novaCatalog.items.length)
          ? root.novaCatalog.items.slice(0, 120)
          : [{ code: '101', name: 'Concor 5mg' }, { code: '102', name: 'Panadol Extra' }, { code: '103', name: 'Augmentin 1g' }];
        instance.enqueueHeavyWork({
          type: 'catalog-reindex',
          label: tr('إعادة فهرسة الكتالوج المحلي', 'Local catalog reindex'),
          items: catalogItems,
          chunkSize: 40
        });
        instance.runAllHeavyWork().then(function () { mountSettingsCard(); });
      };
    }

    var eBtn = host.querySelector('#novaTestErrorBtn');
    if (eBtn) {
      eBtn.onclick = function () {
        instance.reportError({ code: 'supplier-down', component: 'supplier', detail: 'manual-diagnostic' });
      };
    }
  }

  function hookServices() {
    // 1. Hook printer (novaReceipt)
    if (root.novaReceipt && !root.novaReceipt.__reliabilityHooked) {
      root.novaReceipt.__reliabilityHooked = true;
      var origSetConn = root.novaReceipt.setPrinterConnected;
      var origPrint = root.novaReceipt.print;
      var origReprint = root.novaReceipt.reprint;
      if (typeof origSetConn === 'function') {
        root.novaReceipt.setPrinterConnected = function (connected) {
          var r = origSetConn.call(root.novaReceipt, connected);
          instance.setMockState('printer', connected ? 'ok' : 'down', connected ? '' : 'printer-disconnected');
          return r;
        };
      }
      if (typeof origPrint === 'function') {
        root.novaReceipt.print = function () {
          if (instance.isDegraded('printer') && typeof origSetConn === 'function' && root.novaReceipt.isPrinterConnected()) {
            origSetConn.call(root.novaReceipt, false);
          }
          var res = origPrint.apply(root.novaReceipt, arguments);
          if (res && res.ok === false && res.error === 'printer-disconnected') {
            var errRec = instance.reportError({ code: 'printer-disconnected', component: 'printer' });
            res.requestId = errRec.requestId;
            res.health = errRec.health;
          }
          return res;
        };
      }
      if (typeof origReprint === 'function') {
        root.novaReceipt.reprint = function () {
          if (instance.isDegraded('printer') && typeof origSetConn === 'function' && root.novaReceipt.isPrinterConnected()) {
            origSetConn.call(root.novaReceipt, false);
          }
          var res = origReprint.apply(root.novaReceipt, arguments);
          if (res && res.ok === false && res.error === 'printer-disconnected') {
            var errRec = instance.reportError({ code: 'printer-disconnected', component: 'printer' });
            res.requestId = errRec.requestId;
            res.health = errRec.health;
          }
          return res;
        };
      }
    }

    // 2. Hook supplier provider (NOVA_SUPPLIER_PROVIDER)
    if (root.NOVA_SUPPLIER_PROVIDER && !root.NOVA_SUPPLIER_PROVIDER.__reliabilityHooked) {
      root.NOVA_SUPPLIER_PROVIDER.__reliabilityHooked = true;
      var sp = root.NOVA_SUPPLIER_PROVIDER;
      ['search', 'listSuppliers', 'testSupplier', 'previewSupplierCart', 'addToSupplierCart'].forEach(function (fnName) {
        var orig = sp[fnName];
        if (typeof orig !== 'function') return;
        sp[fnName] = function () {
          var args = arguments;
          if (instance.isDegraded('supplier')) {
            var errRec = instance.reportError({ code: 'supplier-down', component: 'supplier', detail: fnName });
            var e = new Error(errRec.userTextAr);
            e.code = 'supplier-down';
            e.requestId = errRec.requestId;
            e.health = errRec.health;
            return Promise.reject(e);
          }
          return Promise.resolve().then(function () { return orig.apply(sp, args); }).catch(function (err) {
            var errRec = instance.reportError({
              code: 'supplier-down',
              component: 'supplier',
              detail: String((err && err.message) || err || fnName)
            });
            if (err && typeof err === 'object') {
              err.requestId = err.requestId || errRec.requestId;
              err.health = err.health || errRec.health;
            }
            throw err;
          });
        };
      });
    }

    // 3. Hook AI fetch routes (/api/ai/*) when AI mock is down
    if (typeof root.fetch === 'function' && !root.fetch.__reliabilityHooked) {
      var origFetch = root.fetch.bind(root);
      var wrappedFetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/ai/') !== -1 && instance.isDegraded('ai')) {
          var errRec = instance.reportError({ code: 'ai-down', component: 'ai', detail: url });
          var body = JSON.stringify({
            ok: false,
            code: 'AI_DEGRADED_MODE',
            requestId: errRec.requestId,
            health: errRec.health,
            error: errRec.userTextAr
          });
          return Promise.resolve(new Response(body, {
            status: 503,
            headers: { 'content-type': 'application/json', 'x-request-id': errRec.requestId }
          }));
        }
        return origFetch(input, init);
      };
      wrappedFetch.__reliabilityHooked = true;
      root.fetch = wrappedFetch;
    }
  }

  function bootBrowser() {
    if (!root.document || !root.document.body) return;
    ensureBanners();
    hookServices();
    renderDegradedBanner();
    mountSettingsCard();
    var view = root.document.getElementById('novaPageView');
    if (view && typeof MutationObserver !== 'undefined' && !view.__reliabilityObserved) {
      view.__reliabilityObserved = true;
      var obs = new MutationObserver(function () {
        if (root.document.querySelector('.nova-settings-grid') && !root.document.getElementById('novaReliabilityCard')) {
          mountSettingsCard();
        }
      });
      obs.observe(view, { childList: true });
    }
  }

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.addEventListener('DOMContentLoaded', bootBrowser);
    } else {
      bootBrowser();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

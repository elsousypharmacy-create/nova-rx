
    (function () {
      "use strict";

      // --- DEMO DATA REPOSITORY ---
      const DEMO_PRODUCTS = [
        { id: "PRD001", barcode: "6281001234567", name: "كونكور 5 مجم (Concor 5mg)", generic: "Bisoprolol Fumarate", form: "30 Tabs", price: 38.50, stock: 45, category: "Chronic", packaging: { stripsPerBox: 3, unitsPerStrip: 10 } },
        { id: "PRD002", barcode: "6281001234568", name: "بانادول إكسترا (Panadol Extra)", generic: "Paracetamol 500mg + Caffeine 65mg", form: "24 Caplets", price: 12.00, stock: 120, category: "Analgesic", packaging: { stripsPerBox: 2, unitsPerStrip: 12 } },
        { id: "PRD003", barcode: "6281001234569", name: "أوجمنتين 1 جم (Augmentin 1g)", generic: "Amoxicillin / Clavulanic Acid", form: "14 Tabs", price: 64.50, stock: 28, category: "Antibiotic", packaging: { stripsPerBox: 2, unitsPerStrip: 7 } },
        { id: "PRD004", barcode: "6281001234570", name: "جلوكوفاج 500 مجم (Glucophage 500mg)", generic: "Metformin HCl", form: "50 Tabs", price: 18.25, stock: 80, category: "Chronic", packaging: { stripsPerBox: 5, unitsPerStrip: 10 } },
        { id: "PRD005", barcode: "6281001234571", name: "ليبيتور 20 مجم (Lipitor 20mg)", generic: "Atorvastatin Calcium", form: "30 Tabs", price: 92.00, stock: 35, category: "Lipid", packaging: { stripsPerBox: 3, unitsPerStrip: 10 } },
        { id: "PRD006", barcode: "6281001234572", name: "نيكسيوم 40 مجم (Nexium 40mg)", generic: "Esomeprazole Magnesium", form: "28 Tabs", price: 85.50, stock: 40, category: "GI Care", packaging: { stripsPerBox: 4, unitsPerStrip: 7 } },
        { id: "PRD007", barcode: "6281001234573", name: "أوميبرازول 20 مجم (Omeprazole 20mg)", generic: "Omeprazole", form: "14 Caps", price: 22.00, stock: 60, category: "GI Care", packaging: { stripsPerBox: 2, unitsPerStrip: 7 } },
        { id: "PRD008", barcode: "6281001234574", name: "سولبادين فوار (Solpadeine Soluble)", generic: "Paracetamol + Codeine + Caffeine", form: "24 Tabs", price: 16.50, stock: 55, category: "Analgesic", packaging: { stripsPerBox: 2, unitsPerStrip: 12 } },
        { id: "PRD009", barcode: "6281001234575", name: "فيتامين د3 50,000 وحدة (Vitamin D3)", generic: "Cholecalciferol", form: "12 Caps", price: 45.00, stock: 90, category: "Vitamins", packaging: { stripsPerBox: 2, unitsPerStrip: 6 } },
        { id: "PRD010", barcode: "6281001234576", name: "سيتريزين 10 مجم (Cetirizine 10mg)", generic: "Cetirizine Dihydrochloride", form: "20 Tabs", price: 14.75, stock: 70, category: "Antihistamine", packaging: { stripsPerBox: 2, unitsPerStrip: 10 } },
        { id: "PRD011", barcode: "6281001234577", name: "فولتارين جل 50 جم (Voltaren Emulgel)", generic: "Diclofenac Diethylamine", form: "50g Tube", price: 26.00, stock: 32, category: "Topical" },
        { id: "PRD012", barcode: "6281001234578", name: "بخاخ أوتريفين 0.1% (Otrivin Nasal)", generic: "Xylometazoline HCl", form: "10ml Spray", price: 11.50, stock: 50, category: "ENT" }
      ];

      const DEMO_CUSTOMERS = [
        {
          id: "CUST001",
          name: "د. طارق المنصور (Dr. Tariq Al-Mansoor)",
          phone: "0501234567",
          tier: "VIP Gold",
          points: 480,
          visits: 24,
          offers: [
            "خصم 10% على أدوية القلب والضغط (Chronic Care)",
            "فحص سكر وضغط مجاني عند كل زيارة",
            "قسيمة مشتريات متاحة بقيمة 30 ج.م"
          ],
          pastInvoices: [
            {
              id: "INV-2026-0891",
              date: "2026-10-28 18:45",
              branch: "فرع السليمانية (#01)",
              total: 130.50,
              items: [
                { productId: "PRD001", name: "كونكور 5 مجم (Concor 5mg)", pastPrice: 36.00, qty: 1 },
                { productId: "PRD005", name: "ليبيتور 20 مجم (Lipitor 20mg)", pastPrice: 90.00, qty: 1 }
              ]
            },
            {
              id: "INV-2026-0742",
              date: "2026-09-15 14:10",
              branch: "فرع العليا (#03)",
              total: 97.50,
              items: [
                { productId: "PRD002", name: "بانادول إكسترا (Panadol Extra)", pastPrice: 12.00, qty: 1 },
                { productId: "PRD006", name: "نيكسيوم 40 مجم (Nexium 40mg)", pastPrice: 85.50, qty: 1 }
              ]
            }
          ]
        },
        {
          id: "CUST002",
          name: "سارة عبد الله العتيبي (Sara Al-Otaibi)",
          phone: "0559876543",
          tier: "Silver Member",
          points: 210,
          visits: 11,
          offers: [
            "توصيل مجاني للطلبات أكثر من 100 ج.م",
            "خصم 5% على منتجات العناية بالفيتامينات"
          ],
          pastInvoices: [
            {
              id: "INV-2026-0810",
              date: "2026-10-20 20:15",
              branch: "فرع الروضة (#05)",
              total: 109.50,
              items: [
                { productId: "PRD003", name: "أوجمنتين 1 جم (Augmentin 1g)", pastPrice: 64.50, qty: 1 },
                { productId: "PRD009", name: "فيتامين د3 50,000 وحدة", pastPrice: 45.00, qty: 1 }
              ]
            }
          ]
        },
        {
          id: "CUST003",
          name: "فهد محمد الشهري (Fahad Al-Shehri)",
          phone: "0543219876",
          tier: "Bronze Member",
          points: 85,
          visits: 5,
          offers: [
            "نقاط ولاء مضاعفة على المسكنات"
          ],
          pastInvoices: [
            {
              id: "INV-2026-0934",
              date: "2026-11-01 11:30",
              branch: "فرع السليمانية (#01)",
              total: 42.50,
              items: [
                { productId: "PRD011", name: "فولتارين جل 50 جم (Voltaren)", pastPrice: 26.00, qty: 1 },
                { productId: "PRD008", name: "سولبادين فوار (Solpadeine)", pastPrice: 16.50, qty: 1 }
              ]
            }
          ]
        },
        {
          id: "CUST004",
          name: "نورة إبراهيم الدوسري (Noura Al-Dossari)",
          phone: "0561122334",
          tier: "VIP Gold",
          points: 520,
          visits: 19,
          offers: [
            "خصم 15% على رعاية مرضى السكر",
            "استشارة دوائية مجانية دورية"
          ],
          pastInvoices: [
            {
              id: "INV-2026-0688",
              date: "2026-10-12 17:05",
              branch: "فرع الشاطئ (#07)",
              total: 81.50,
              items: [
                { productId: "PRD004", name: "جلوكوفاج 500 مجم (Glucophage)", pastPrice: 17.50, qty: 2 },
                { productId: "PRD009", name: "فيتامين د3 50,000 وحدة", pastPrice: 45.00, qty: 1 }
              ]
            }
          ]
        }
      ];

      // SALE-02: demo customers (and their demo invoices) are for development only. A real pharmacy starts
      // with an empty customer list; customers saved on this device are added back below. Dev = file://,
      // localhost/127.0.0.1/[::1], or localStorage 'nova-rx-demo-mode' = '1'.
      (function () {
        let demo = false;
        try {
          const h = location.hostname;
          demo = location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || localStorage.getItem('nova-rx-demo-mode') === '1';
        } catch (e) { demo = false; }
        window.NOVA_DEMO_MODE = demo;
        if (!demo) DEMO_CUSTOMERS.length = 0;
      })();

      // --- APPLICATION STATE ---
      window.NOVA_DEMO = { products: DEMO_PRODUCTS, customers: DEMO_CUSTOMERS };
      // --- REAL PRICE LIST (read-only STOCK LIVE snapshot, prices only) ---
      // Same-origin `/emergency/stock.json`. If it is missing (file://, offline, 404, bad data) the 12 demo products stay.
      const dispName = n => { const t = String(n ?? ""); const r = t.replace(/\s*\([A-Za-z][A-Za-z0-9 .%\/+-]*\)\s*$/, ""); return /[\u0600-\u06FF]/.test(r) ? r : t; };
      window.novaDispName = dispName;
      const novaEn = () => localStorage.getItem('nova-rx-language') === 'en';
      const tierAr = t => novaEn() ? t : (({'VIP Gold':'ذهبي','Silver Member':'فضي','Bronze Member':'برونزي'})[t] || t);
      window.novaTierAr = tierAr;
      const escH = s => String(s ?? "").replace(/[&<>"'`]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
      const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩", FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
      const normDigits = s => String(s ?? "").replace(/[٠-٩۰-۹]/g, d => { const i = AR_DIGITS.indexOf(d); return String(i >= 0 ? i : FA_DIGITS.indexOf(d)); });
      const foldKey = s => normDigits(s).toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
        .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
        .replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ء/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
      const splitToks = s => foldKey(s).replace(/(\p{L})(\p{N})/gu, "$1 $2").replace(/(\p{N})(\p{L})/gu, "$1 $2").split(" ").filter(Boolean);
      const NUM_RE = /^\d+$/;
      const normCode = s => normDigits(s).replace(/[\s-]+/g, "");
      const STRENGTH_RE = /(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?\s*(?:mg|g|mcg|ug|ml|iu|%|مجم|مج|ملجم|جم|جرام|مكج|مل|وحدة|وحده))(?![\p{L}])/iu;
      const PACK_RE = /(\d+\s*(?:tab(?:let)?s?|cap(?:let|sule)?s?|amp(?:oule)?s?|sachets?|strips?|vials?|bottles?|drops?|spra?y|tube|قرص|أقراص|اقراص|حبة|حبه|كبسولة|كبسوله|امبول|أمبول|شريط|كيس|عبوة|علبة|علبه|وحدة|وحده))(?![\p{L}])/iu;
      // UX11: presentation only. Unknown stock is never coerced to zero; source text is never corrected.
      const searchStockLabel = p => Number.isFinite(p && p.stock)
        ? (p.stock === 0 ? (novaEn() ? 'Stock: 0' : 'الرصيد: صفر') : (novaEn() ? 'Stock: ' : 'الرصيد: ') + p.stock)
        : (novaEn() ? 'Stock unknown' : 'الرصيد غير معروف');
      const sourceMeasureNeedsReview = value => /(?:^|\s)(?:[1-9]\d{2,})(?:[.,]\d+)?\s*(?:g|جم|جرام)\b/iu.test(normDigits(value));
      const extractStrength = p => {
        if (!p) return "";
        if (p.strength) return String(p.strength);
        const m = String(p.name || p.nameAr || p.nameEn || "").match(STRENGTH_RE) || String(p.generic || p.activeIngredient || "").match(STRENGTH_RE);
        return m ? m[1].trim() : "";
      };
      const extractPack = p => {
        if (!p) return "";
        if (p.pack) return String(p.pack);
        if (p.form) return String(p.form);
        if (p.packaging && window.novaPackagingLabel) { const lbl = window.novaPackagingLabel(p.packaging); if (lbl) return lbl; }
        if (Number.isInteger(p.packSize) && p.packSize > 1) return p.packSize + " Tabs";
        const m = String(p.name || p.nameAr || p.nameEn || "").match(PACK_RE);
        return m ? m[1].trim() : "";
      };
      // Optimal string alignment distance (insert, delete, replace, adjacent swap), bounded by max.
      const editDist = (a, b, max) => {
        if (Math.abs(a.length - b.length) > max) return max + 1;
        let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
          const cur = [i]; let rowMin = i;
          for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
            cur[j] = v; if (v < rowMin) rowMin = v;
          }
          if (rowMin > max) return max + 1;
          prev2 = prev; prev = cur;
        }
        return prev[b.length];
      };
      // UX63: small static Arabic generic-name / indication aliases -> Latin generic already in product records. Lower-ranked tier (score 5 < exact 10 / prefix 7).
      const ALIAS_RAW = {
        "اموكسيسيلين": "amoxicillin", "أموكسيسيللين": "amoxicillin", "اموكسيسللين": "amoxicillin", "اموكسيلين": "amoxicillin",
        "ديكلوفيناك": "diclofenac", "ديكلوفينيك": "diclofenac",
        "باراسيتامول": "paracetamol", "بارسيتامول": "paracetamol",
        "ايبوبروفين": "ibuprofen", "اسبرين": "aspirin",
        "ميتفورمين": "metformin", "ميتفورمن": "metformin",
        "اتورفاستاتين": "atorvastatin", "اتورفاستاتن": "atorvastatin",
        "كولسترول": "atorvastatin", "كوليسترول": "atorvastatin",
        "سترزين": "cetirizine", "سيتيريزين": "cetirizine", "سيتريزين": "cetirizine",
        "اوميبرازول": "omeprazole", "ايزوميبرازول": "esomeprazole",
        "بيسوبرولول": "bisoprolol", "زيلوميتازولين": "xylometazoline",
        "مسكن": "paracetamol", "مسكن صداع": "paracetamol", "صداع": "paracetamol", "مسكن الم": "paracetamol",
        "بخاخ انف": "xylometazoline", "بخاخ الانف": "xylometazoline", "احتقان الانف": "xylometazoline", "زكام": "xylometazoline",
        "حساسيه": "cetirizine", "مضاد حساسيه": "cetirizine", "مضاد حيوي": "amoxicillin", "سكر": "metformin", "ضغط": "bisoprolol"
      };
      const ALIASES = new Map(Object.entries(ALIAS_RAW).map(([k, v]) => [foldKey(k), v]));
      const aliasFor = k => {
        if (ALIASES.has(k)) return ALIASES.get(k);
        if (k.length >= 5 && /[\u0600-\u06FF]/.test(k)) for (const [ak, v] of ALIASES) if (ak.length >= 5 && editDist(k, ak, 1) <= 1) return v;
        return null;
      };
      // CAT-05 instant search index: Arabic folding, Latin names, 1-2 edit typos, whole-number strength/pack, exact barcode.
      const createCatalogIndex = list => {
        const products = Array.isArray(list) ? list : [];
        const postings = new Map(), barcodes = new Map(), codes = new Map(), byLength = new Map(), meta = [], bList = [];
        products.forEach((p, i) => {
          if (!p.name && (p.nameAr || p.nameEn)) p.name = p.nameAr && p.nameEn ? p.nameAr + " (" + p.nameEn + ")" : (p.nameAr || p.nameEn);
          if (!p.barcode && (p.gtin || (p.barcodes && p.barcodes[0]) || p.code)) p.barcode = String(p.gtin || (p.barcodes && p.barcodes[0]) || p.code);
          const str = extractStrength(p), pk = extractPack(p);
          const text = [p.name, p.nameAr, p.nameEn, p.generic, p.activeIngredient, str, pk, p.category].filter(Boolean).join(" ");
          const toks = new Set(splitToks(text));
          const strengthNums = new Set(splitToks(str).filter(t => NUM_RE.test(t)));
          const packNums = new Set(splitToks(pk).filter(t => NUM_RE.test(t)));
          for (const n of strengthNums) toks.add(n);
          for (const n of packNums) toks.add(n);
          for (const t of toks) { let a = postings.get(t); if (!a) { a = []; postings.set(t, a); } a.push(i); }
          for (const rawB of [p.barcode, p.gtin, ...(Array.isArray(p.barcodes) ? p.barcodes : [])].filter(Boolean)) {
            const nb = normCode(rawB);
            if (nb) { if (!barcodes.has(nb)) barcodes.set(nb, i); bList.push([nb, i]); }
          }
          const cid = normCode(p.id || p.code || "").toLowerCase();
          if (cid && !codes.has(cid)) codes.set(cid, i);
          meta.push({ str, pk, strengthNums, packNums, fName: foldKey([p.name, p.nameAr, p.nameEn].filter(Boolean).join(" ")), active: p.active !== false });
        });
        const sorted = [...postings.keys()].sort();
        for (const t of sorted) if (!NUM_RE.test(t)) { let a = byLength.get(t.length); if (!a) { a = []; byLength.set(t.length, a); } a.push(t); }
        const lowerBound = t => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < t) lo = mid + 1; else hi = mid; } return lo; };
        const matchWord = (t, singleWord) => {
          const best = new Map(), give = (tok, sc) => { for (const i of postings.get(tok)) if (!(best.get(i) >= sc)) best.set(i, sc); };
          if (postings.has(t)) give(t, 10);
          if (NUM_RE.test(t)) {
            if (singleWord && t.length >= 3 && t.length <= 7) for (const [nb, i] of bList) if (nb.includes(t) && !(best.get(i) >= 2)) best.set(i, 2);
            return best;
          }
          const minPref = singleWord ? 1 : 2;
          if (t.length >= minPref) {
            const sc = t.length >= 3 ? 7 : 4;
            for (let k = lowerBound(t); k < sorted.length && sorted[k].startsWith(t); k++) if (sorted[k] !== t && !NUM_RE.test(sorted[k])) give(sorted[k], sc);
          }
          if (best.size === 0 && t.length >= 4) {
            const maxScan = t.length >= 7 ? 2 : 1;
            for (let len = t.length - maxScan; len <= t.length + maxScan; len++) {
              const maxd = (t.length >= 8 || (t.length >= 7 && len >= 9)) ? 2 : 1;
              for (const tok of byLength.get(len) || []) { const d = editDist(t, tok, maxd); if (d <= maxd) give(tok, 4 - d); }
            }
          }
          return best;
        };
        const search = (query, limit = 40) => {
          if (typeof query !== "string") return [];
          const q = query.slice(0, 200).trim();
          if (!q) return [];
          const nq = normCode(q);
          if (nq.length >= 5 && (barcodes.has(nq) || codes.has(nq.toLowerCase()))) {
            const out = [], seen = new Set();
            if (barcodes.has(nq)) { const i = barcodes.get(nq); seen.add(i); out.push(products[i]); }
            if (codes.has(nq.toLowerCase())) { const i = codes.get(nq.toLowerCase()); if (!seen.has(i)) out.push(products[i]); }
            return out.slice(0, limit);
          }
          if (/^\d{8,14}$/.test(nq)) return [];
          const words = [...new Set(splitToks(q))].slice(0, 8);
          if (!words.length) return [];
          let scores = null;
          const lowTier = lat => { const r = matchWord(lat, true); for (const [i, v] of r) r.set(i, Math.min(v, 5)); return r; };
          if (words.length > 1) {
            const pa = aliasFor(words.join(" "));
            if (pa) { const m = lowTier(pa); if (m.size) scores = m; }
          }
          for (const w of scores ? [] : words) {
            let m = matchWord(w, words.length === 1);
            if (!m.size) { const al = aliasFor(w); if (al) m = lowTier(al); }
            if (!m.size) return [];
            if (scores === null) { scores = new Map(m); continue; }
            const next = new Map();
            for (const [i, s] of scores) if (m.has(i)) next.set(i, s + m.get(i));
            scores = next;
            if (!scores.size) return [];
          }
          const phrase = words.join(" "), ranked = [];
          for (const [i, base] of scores) {
            const m = meta[i]; let sc = base;
            if (m.fName.includes(phrase)) sc += 6;
            if (m.fName.startsWith(phrase)) sc += 3;
            for (const w of words) if (NUM_RE.test(w)) { if (m.strengthNums.has(w)) sc += 3; if (m.packNums.has(w)) sc += 2; }
            if (!m.active) sc -= 1000;
            ranked.push({ p: products[i], sc, i });
          }
          ranked.sort((a, b) => b.sc - a.sc || a.i - b.i);
          return ranked.slice(0, limit).map(x => x.p);
        };
        return { search, products, len: products.length, first: products[0], last: products[products.length - 1] };
      };
      let activeSearchIdx = null;
      const getSearchIndex = () => {
        const list = (window.NOVA_DEMO && Array.isArray(window.NOVA_DEMO.products)) ? window.NOVA_DEMO.products : DEMO_PRODUCTS;
        if (!activeSearchIdx || activeSearchIdx.products !== list || activeSearchIdx.len !== list.length || activeSearchIdx.first !== list[0] || activeSearchIdx.last !== list[list.length - 1]) {
          activeSearchIdx = createCatalogIndex(list);
        }
        return activeSearchIdx;
      };
      window.addEventListener("nova-catalog", () => { activeSearchIdx = null; });
      const searchProducts = (q, limit = 40) => getSearchIndex().search(q, limit);
      const findExactBarcodeProduct = q => {
        const raw = String(q ?? "").trim(), nq = normCode(raw);
        if (!raw) return null;
        const list = (window.NOVA_DEMO && Array.isArray(window.NOVA_DEMO.products)) ? window.NOVA_DEMO.products : DEMO_PRODUCTS;
        return list.find(p => p.barcode === raw || (nq && (normCode(p.barcode) === nq || (p.gtin && normCode(p.gtin) === nq) || (Array.isArray(p.barcodes) && p.barcodes.some(b => normCode(b) === nq))))) || null;
      };
      const UNIT_ALIAS = { mg: "مجم", مجم: "mg", مج: "mg", ملجم: "mg", g: "جم", جم: "g", جرام: "g", ml: "مل", مل: "ml", tab: "قرص", tabs: "قرص", قرص: "tabs", اقراص: "tabs", حبه: "tabs" };
      const highlightText = (text, query) => {
        const str = String(text ?? "");
        const qWords = splitToks(query);
        const nq = normCode(query);
        if (!str || (!qWords.length && !nq)) return escH(str);
        return str.split(/([\p{L}\p{N}]+)/gu).map(part => {
          if (!part || !/[\p{L}\p{N}]/u.test(part)) return escH(part);
          const pToks = splitToks(part), pCode = normCode(part);
          const hit = (nq.length >= 4 && pCode.length >= 4 && pCode.includes(nq)) || pToks.some(pt => qWords.some(qt => {
            if (pt === qt || UNIT_ALIAS[pt] === qt) return true;
            if (NUM_RE.test(qt) || NUM_RE.test(pt)) return false;
            if (qt.length >= 2 && pt.startsWith(qt)) return true;
            if (qt.length >= 4 && pt.length >= 3) { const md = (qt.length >= 8 || (qt.length >= 7 && pt.length >= 9)) ? 2 : 1; return editDist(qt, pt, md) <= md; }
            return false;
          }));
          return hit ? `<mark class="sugg-hl">${escH(part)}</mark>` : escH(part);
        }).join("");
      };
      window.novaSearch = {
        search: searchProducts,
        createIndex: createCatalogIndex,
        highlight: highlightText,
        extractStrength,
        extractPack,
        rebuild: () => { activeSearchIdx = null; return getSearchIndex(); },
        benchmark: (count = 5000) => {
          const arBase = ["بانادول", "أوجمنتين", "كونكور", "جافيسكون", "أوميبرازول", "زيرتك", "فولتارين", "ليبيتور", "جلوكوفاج", "أسبرين", "إيبوبروفين", "سيتريزين"];
          const enBase = ["Panadol", "Augmentin", "Concor", "Gaviscon", "Omeprazole", "Zyrtec", "Voltaren", "Lipitor", "Glucophage", "Aspirin", "Ibuprofen", "Cetirizine"];
          const strengths = ["5 مجم", "10 مجم", "20 مجم", "40 مجم", "100 مجم", "250 مجم", "500 مجم", "1000 مجم"];
          const packs = ["10 أقراص", "14 كبسولة", "20 قرص", "24 قرص", "30 قرص", "50 قرص"];
          const mock = Array.from({ length: count }, (_, i) => {
            const ar = arBase[i % arBase.length], en = enBase[i % enBase.length], st = strengths[i % strengths.length], pk = packs[i % packs.length];
            const bc = String(6221000000000 + i);
            return { id: "M" + (10000 + i), barcode: bc, name: `${ar} ${i} ${st} (${en} ${st})`, strength: st, pack: pk, form: pk, generic: en + " Active", price: 15 + (i % 90) };
          });
          const t0 = performance.now(), idx = createCatalogIndex(mock), buildMs = performance.now() - t0;
          const queries = Array.from({ length: 200 }, (_, k) => [
            "اوجمنتين 500", "بانادول 24", "panadool 500", "concor 10", "أسبيرين", "كبسوله 14", String(6221000000000 + (k * 17) % count), "gavsicon 250"
          ][k % 8]);
          queries.slice(0, 16).forEach(q => idx.search(q, 40));
          const times = queries.map(q => { const a = performance.now(); idx.search(q, 40); return performance.now() - a; }).sort((a, b) => a - b);
          const p50Ms = times[Math.floor(times.length * 0.5)], p95Ms = times[Math.floor(times.length * 0.95)], maxMs = times[times.length - 1];
          return { catalogSize: idx.len, queries: queries.length, buildMs, p50Ms, p95Ms, maxMs, pass: p95Ms <= 150 };
        }
      };
      window.novaFold = foldKey;
      // CAT-01 (this device only): flag likely duplicates for pharmacist review. Same non-empty barcode, or same normalized name (strength glued to its unit) + same pack text. Read-only: never merges or edits anything.
      window.novaDuplicates = list => {
        const nk = p => foldKey(p.name).replace(/(\d) (mg|mcg|g|ml|iu|gm)\b/g, "$1$2");
        const by = (kind, keyOf) => {
          const m = new Map();
          for (const p of list || []) { const k = keyOf(p); if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(p); }
          return [...m].filter(e => e[1].length > 1).map(e => ({ reason: kind, key: e[0], items: e[1] }));
        };
        return by("barcode", p => String(p.barcode == null ? "" : p.barcode).replace(/\s/g, "")).concat(by("name", p => { const n = nk(p); return n ? n + "|" + foldKey(p.pack || "") : ""; }));
      };
      // Read-only packaging text from the catalog packaging link (same field names/rules as worker/catalog/unit-conversion.js). Invalid or missing -> "" (shown as a dash), never a guess.
      window.novaPackagingLabel = def => {
        if (!def || typeof def !== "object") return "";
        const n = v => { const x = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return Number.isInteger(x) && x > 0 && x <= 100000 ? x : undefined; };
        const us = n(def.unitsPerStrip ?? def.tabletsPerStrip), sb = n(def.stripsPerBox), ub = n(def.unitsPerBox), bc = n(def.boxesPerCarton ?? def.packsPerCarton);
        for (const [raw, v] of [[def.unitsPerStrip ?? def.tabletsPerStrip, us], [def.stripsPerBox, sb], [def.unitsPerBox, ub], [def.boxesPerCarton ?? def.packsPerCarton, bc]]) if (raw !== undefined && raw !== null && v === undefined) return "";
        if (us && sb && ub && us * sb !== ub) return "";
        const box = ub || (us && sb ? us * sb : undefined), parts = [];
        if (box) parts.push("العلبة " + box + " وحدة");
        if (us) parts.push("الشريط " + us + " وحدة");
        if (sb) parts.push(sb + " شريط/علبة");
        if (box && bc) parts.push("الكرتونة " + bc + " علبة");
        return parts.join(" • ");
      };
      // CAT-02 (this device only): per-item unit conversions (box/strip/tablet). Selling in a smaller unit deducts the exact fraction from box stock; unknown or unavailable conversions are refused.
      window.novaUnits = (function () {
        const PK = "nova-rx-packaging-v1", clean = x => Math.round(x * 1e9) / 1e9;
        const UNITS = { box: "box", pack: "box", "علبة": "box", strip: "strip", "شريط": "strip", tablet: "tablet", unit: "tablet", piece: "tablet", cap: "tablet", capsule: "tablet", "قرص": "tablet", "وحدة": "tablet", "حبة": "tablet", "كبسولة": "tablet" };
        const LABELS = { box: { ar: "علبة", en: "Box" }, strip: { ar: "شريط", en: "Strip" }, tablet: { ar: "قرص", en: "Tablet" } };
        const canonicalUnit = u => (typeof u === "string" ? UNITS[u.trim().toLowerCase()] || null : null);
        const posInt = v => { const x = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v; return Number.isInteger(x) && x > 0 && x <= 100000 ? x : undefined; };
        const validatePackaging = def => {
          if (def === undefined || def === null) return { ok: true, packaging: null, perBox: { box: 1 } };
          if (typeof def !== "object" || Array.isArray(def)) return { ok: false, error: "packaging-invalid" };
          const rawUs = def.unitsPerStrip ?? def.tabletsPerStrip, rawSb = def.stripsPerBox, rawUb = def.unitsPerBox;
          const us = posInt(rawUs), sb = posInt(rawSb), ub = posInt(rawUb);
          for (const [r, v] of [[rawUs, us], [rawSb, sb], [rawUb, ub]]) if (r !== undefined && r !== null && v === undefined) return { ok: false, error: "packaging-invalid" };
          if (us && sb && ub && us * sb !== ub) return { ok: false, error: "packaging-inconsistent" };
          const perBox = { box: 1 };
          if (sb) perBox.strip = sb;
          const tabs = ub || (us && sb ? us * sb : undefined);
          if (tabs) perBox.tablet = tabs;
          const packaging = (us || sb || ub) ? { ...(sb ? { stripsPerBox: sb } : {}), ...(us ? { unitsPerStrip: us } : {}), ...(tabs ? { unitsPerBox: tabs } : {}) } : null;
          return { ok: true, packaging, perBox };
        };
        const readStore = () => { try { const o = JSON.parse(localStorage.getItem(PK) || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (_) { return {}; } };
        const findProd = item => {
          if (!item) return null;
          if (typeof item === "object") return DEMO_PRODUCTS.find(p => p.id === item.productId || p.id === item.id || (item.barcode && p.barcode === item.barcode)) || item;
          const k = String(item); return DEMO_PRODUCTS.find(p => p.id === k || p.barcode === k || p.name === k) || null;
        };
        const getPackaging = item => {
          const store = readStore(), p = findProd(item);
          const keys = [typeof item === "string" ? item : null, item && item.productId, item && item.id, item && item.barcode, p && p.id, p && p.barcode].filter(Boolean);
          for (const k of keys) if (store[k] !== undefined) return store[k];
          return (item && item.packaging) || (p && p.packaging) || null;
        };
        const setPackaging = (item, def) => {
          const v = validatePackaging(def); if (!v.ok) return v;
          const p = findProd(item), key = typeof item === "string" ? item : (p && (p.barcode || p.id)) || (item && (item.barcode || item.productId || item.id));
          if (!key) return { ok: false, error: "item-unknown" };
          const store = readStore();
          if (v.packaging) store[key] = v.packaging; else delete store[key];
          if (p) { if (v.packaging) { store[p.id] = v.packaging; store[p.barcode] = v.packaging; } p.packaging = v.packaging; p.pack = v.packaging && window.novaPackagingLabel ? window.novaPackagingLabel(v.packaging) : ""; }
          try { localStorage.setItem(PK, JSON.stringify(store)); } catch (_) { return { ok: false, error: "storage" }; }
          return { ok: true, packaging: v.packaging, perBox: v.perBox };
        };
        const availableUnits = item => {
          const v = validatePackaging(getPackaging(item));
          if (!v.ok) return ["box"];
          return ["box", ...(v.perBox.strip ? ["strip"] : []), ...(v.perBox.tablet ? ["tablet"] : [])];
        };
        const convert = (item, qty, unit = "box") => {
          const canon = canonicalUnit(unit);
          if (!canon) return { ok: false, error: "unit-unknown" };
          const q = typeof qty === "number" ? qty : (typeof qty === "string" && /^\d+$/.test(qty.trim()) ? Number(qty.trim()) : NaN);
          if (!Number.isSafeInteger(q) || q <= 0) return { ok: false, error: "quantity-invalid" };
          const v = validatePackaging(getPackaging(item));
          if (!v.ok) return v;
          const factor = v.perBox[canon];
          if (!factor) return { ok: false, error: "unit-unavailable" };
          const p = findProd(item), boxPrice = Number((item && item.boxPrice !== undefined ? item.boxPrice : (p && p.price !== undefined ? p.price : item && item.price)) ?? 0);
          const cents = Math.round(boxPrice * 100);
          const unitPrice = Math.floor((2 * cents + factor) / (2 * factor)) / 100;
          const lineTotal = Math.floor((2 * cents * q + factor) / (2 * factor)) / 100;
          return { ok: true, unit: canon, qty: q, perBox: factor, stockFraction: clean(q / factor), unitPrice, lineTotal };
        };
        const label = (u, lang) => { const c = canonicalUnit(u) || "box"; const l = lang || (localStorage.getItem("nova-rx-language") === "en" ? "en" : "ar"); return LABELS[c][l]; };
        return { canonicalUnit, validatePackaging, getPackaging, setPackaging, availableUnits, convert, label };
      })();
      window.novaCatalog = { source: "demo", exportedAt: null, count: DEMO_PRODUCTS.length };
      function loadRealPrices() {
        if (location.protocol === "file:") return;
        // Browsers log every HTTP 404 as a console error, whatever JS does with it. So on a loopback static host
        // (no Worker route) and after a remembered miss we do not request the file at all: cached snapshot or demo data.
        const MISS_KEY = "nova-stock-missing-v1", SNAP_KEY = "nova-stock-snapshot-v1", MISS_TTL = 6 * 3600 * 1000;
        const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
        const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
        const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
        const apply = txt => {
          let j; try { j = JSON.parse(String(txt).replace(/^\uFEFF/, "")); } catch (e) { return false; }
          const raw = Array.isArray(j) ? j : j && j.items;
          if (!Array.isArray(raw)) return false;
          const seen = new Set(), out = [];
          for (const r of raw) {
            const code = String(r.code == null ? "" : r.code).replace(/[^\d]/g, "");
            const gtin = String(r.gtin == null ? "" : r.gtin).replace(/[^\d]/g, "");
            const nameAr = String(r.namear || r.name || "").trim(), nameEn = String(r.nameen || "").trim();
            const price = Number(r.price);
            if ((!code && !gtin) || !(nameAr || nameEn) || !Number.isFinite(price) || price <= 0 || seen.has(code || gtin)) continue;
            seen.add(code || gtin);
            const pk = window.novaPackagingLabel ? window.novaPackagingLabel(r.packaging) : ""; out.push({ id: code || gtin, barcode: gtin || code, pack: pk, packaging: pk ? r.packaging : null, name: nameAr && nameEn ? nameAr + " (" + nameEn + ")" : nameAr || nameEn, generic: "", form: "", price: Math.round(price * 100) / 100, stock: null, category: "", real: true });
          }
          if (out.length < 50) return false; // an almost empty file is not a catalog: keep the demo data
          DEMO_PRODUCTS.splice(0, DEMO_PRODUCTS.length, ...out);
          const ts = Date.parse(j && j.exportedAt);
          window.novaCatalog = { source: "STOCK LIVE", exportedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null, count: out.length };
          window.dispatchEvent(new CustomEvent("nova-catalog"));
          return true;
        };
        const snap = lsGet(SNAP_KEY);
        if (snap) apply(snap);
        const missAt = Number(lsGet(MISS_KEY));
        if (missAt && Date.now() - missAt < MISS_TTL) return;
        if (loopback && !window.NOVA_STOCK_PROBE && !/[?&]stock=1\b/.test(location.search)) return;
        fetch("/emergency/stock.json", { cache: "no-cache" }).then(r => (r.ok ? r.text() : (lsSet(MISS_KEY, String(Date.now())), null))).then(txt => {
          if (!txt) return;
          if (apply(txt)) { try { if (txt.length < 2500000) lsSet(SNAP_KEY, txt); } catch (e) {} }
        }).catch(() => {});
      }
      loadRealPrices();
      window.novaCartItems=()=>{try{return state.invoiceLines.map(x=>({name:x.name,qty:x.qty}))}catch(e){return[]}};
      const state = {
        mode: "PRODUCT", // "CUSTOMER" or "PRODUCT"
        attachedCustomer: null,
        customerGateSkipped: true,
        customerGatePending: false,
        invoiceLines: [],
        percentDiscount: 0,
        fixedDiscount: 0,
        searchQuery: "",
        selectedIndex: -1,
        suggestions: [],
        checkoutPaymentMethod: "cash",
        cashReceived: 0
      };

      // Recover an unfinished invoice after an accidental reload (browser-local only).
      const ACTIVE_INVOICE_KEY = 'nova-rx-active-invoice-v1';
      let restoredCustomerId = null;
      try {
        const draft = JSON.parse(localStorage.getItem(ACTIVE_INVOICE_KEY) || 'null');
        if (draft && Array.isArray(draft.lines)) {
          state.invoiceLines = draft.lines.filter(l =>
            l && typeof l.productId === 'string' && typeof l.name === 'string' &&
            Number.isFinite(l.price) && l.price >= 0 &&
            Number.isSafeInteger(l.qty) && l.qty >= 1 && l.qty <= 999 &&
            Number.isFinite(l.discount) && l.discount >= 0
          ).slice(0, 500);
          state.percentDiscount = Number.isFinite(draft.percentDiscount) ? draft.percentDiscount : 0;
          state.fixedDiscount = Number.isFinite(draft.fixedDiscount) ? draft.fixedDiscount : 0;
          restoredCustomerId = draft.customerId != null ? String(draft.customerId) : null;
        }
      } catch (_) {}
      function persistActiveInvoice() {
        try {
          if (!state.invoiceLines.length && !state.attachedCustomer) localStorage.removeItem(ACTIVE_INVOICE_KEY);
          else localStorage.setItem(ACTIVE_INVOICE_KEY, JSON.stringify({
            lines: state.invoiceLines, percentDiscount: state.percentDiscount,
            fixedDiscount: state.fixedDiscount,
            customerId: state.attachedCustomer ? state.attachedCustomer.id : null
          }));
        } catch (_) { /* Browser storage may be unavailable; keep checkout usable. */ }
      }

      // Demo-only customer registry, persisted in this browser (no server sync).
      const DEMO_CUSTOMERS_KEY = 'nova-rx-demo-customers-v1';
      try {
        const savedCustomers = JSON.parse(localStorage.getItem(DEMO_CUSTOMERS_KEY) || '[]');
        if (Array.isArray(savedCustomers)) savedCustomers.filter(c => c && c.id && c.phone).forEach(c => {
          if (!DEMO_CUSTOMERS.some(existing => existing.id === c.id || existing.phone === c.phone)) DEMO_CUSTOMERS.push({...c,pastInvoices:Array.isArray(c.pastInvoices)?c.pastInvoices:[]});
        });
      } catch (_) {}
      function saveDemoCustomers() {
        try { localStorage.setItem(DEMO_CUSTOMERS_KEY, JSON.stringify(DEMO_CUSTOMERS.filter(c => String(c.id).startsWith('DEMO-')))); return true; }
        catch (_) { showToast('تعذر حفظ العميل على هذا المتصفح.', 'error'); return false; }
      }

      // --- DOM ELEMENT REFERENCES ---
      const elements = {
        modePill: document.getElementById("modePill"),
        modePillText: document.getElementById("modePillText"),
        searchModeTag: document.getElementById("searchModeTag"),
        mainSearchInput: document.getElementById("mainSearchInput"),
        searchHintText: document.getElementById("searchHintText"),
        suggestionsBox: document.getElementById("suggestionsBox"),
        invoiceTableBody: document.getElementById("invoiceTableBody"),
        emptyInvoiceState: document.getElementById("emptyInvoiceState"),
        totalItemsCount: document.getElementById("totalItemsCount"),
        displaySubtotal: document.getElementById("displaySubtotal"),
        discountRow: document.getElementById("discountRow"),
        displayDiscount: document.getElementById("displayDiscount"),
        displayVat: document.getElementById("displayVat"),
        displayGrandTotal: document.getElementById("displayGrandTotal"),
        inputPercentDiscount: document.getElementById("inputPercentDiscount"),
        inputFixedDiscount: document.getElementById("inputFixedDiscount"),
        btnCheckout: document.getElementById("btnCheckout"),
        btnNewSale: document.getElementById("btnNewSale"),
        btnAddLoyalty: document.getElementById("btnAddLoyalty"),
        btnClearInvoice: document.getElementById("btnClearInvoice"),
        btnHelpShortcuts: document.getElementById("btnHelpShortcuts"),
        customerEmptyBox: document.getElementById("customerEmptyBox"),
        customerSelectedBox: document.getElementById("customerSelectedBox"),
        sidebarCustBadge: document.getElementById("sidebarCustBadge"),
        btnAttachLoyalty: document.getElementById("btnAttachLoyalty"),
        custCardName: document.getElementById("custCardName"),
        custCardPhone: document.getElementById("custCardPhone"),
        custCardTier: document.getElementById("custCardTier"),
        custCardVisits: document.getElementById("custCardVisits"),
        custCardPoints: document.getElementById("custCardPoints"),
        custOffersList: document.getElementById("custOffersList"),
        btnChangeCust: document.getElementById("btnChangeCust"),
        btnRemoveCust: document.getElementById("btnRemoveCust"),
        historySearchInput: document.getElementById("historySearchInput"),
        pastInvoicesContainer: document.getElementById("pastInvoicesContainer"),
        checkoutModal: document.getElementById("checkoutModal"),
        modalAmountDue: document.getElementById("modalAmountDue"),
        modalCustomerInfo: document.getElementById("modalCustomerInfo"),
        inputCashReceived: document.getElementById("inputCashReceived"),
        displayChangeDue: document.getElementById("displayChangeDue"),
        btnCloseCheckout: document.getElementById("btnCloseCheckout"),
        btnCancelCheckout: document.getElementById("btnCancelCheckout"),
        btnConfirmPayment: document.getElementById("btnConfirmPayment"),
        receiptModal: document.getElementById("receiptModal"),
        receiptSlipContent: document.getElementById("receiptSlipContent"),
        btnCloseReceipt: document.getElementById("btnCloseReceipt"),
        btnPrintReceiptBtn: document.getElementById("btnPrintReceiptBtn"),
        btnReceiptNewSale: document.getElementById("btnReceiptNewSale"),
        helpModal: document.getElementById("helpModal"),
        btnCloseHelp: document.getElementById("btnCloseHelp"),
        btnDismissHelp: document.getElementById("btnDismissHelp"),
        toastContainer: document.getElementById("toastContainer")
      };

      // --- HELPER / UTILITY FUNCTIONS ---
      function addedPrefix() { return localStorage.getItem('nova-rx-language') === 'en' ? 'Added to invoice: ' : 'أُضيف: '; }
      function showToast(msg, type = "info") {
        // One message at a time: a new toast replaces the old one (they used to pile up over the totals).
        elements.toastContainer.replaceChildren();
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.setAttribute("role", type === 'error' ? "alert" : "status");
        toast.setAttribute("aria-live", type === 'error' ? "assertive" : "polite");
        toast.innerHTML = `
          <span style="color:${type === 'error' ? 'var(--accent-red)' : 'var(--accent-cyan-light)'}">●</span>
          <span dir="auto">${msg}</span>
        `;
        elements.toastContainer.appendChild(toast);
        setTimeout(() => {
          toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
          toast.style.opacity = "0";
          toast.style.transform = "translateY(-10px)";
          setTimeout(() => toast.remove(), 300);
        }, window.matchMedia && matchMedia('(max-width:600px)').matches ? 2500 : (type === 'error' ? 4500 : 2200));
      }

      // UX66: undo toast (6s) + Ctrl+Z for destructive cart actions.
      let pendingUndo = null;
      function expireUndo() {
        if (!pendingUndo) return;
        const u = pendingUndo; pendingUndo = null;
        clearTimeout(u.timer);
        u.toast && u.toast.remove();
        if (u.onExpire) { try { u.onExpire(); } catch (_) {} }
      }
      function runUndo() {
        if (!pendingUndo) return false;
        const u = pendingUndo; pendingUndo = null;
        clearTimeout(u.timer);
        u.toast && u.toast.remove();
        u.restore();
        showToast("تم التراجع.");
        return true;
      }
      function showUndoToast(msg, restore, onExpire) {
        expireUndo();
        showToast(msg);
        const toast = elements.toastContainer.lastElementChild;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = "btnUndoToast";
        btn.className = "toast-undo";
        btn.textContent = "تراجع";
        btn.title = "Ctrl+Z";
        btn.style.cssText = "margin-inline-start:8px;background:transparent;border:1px solid currentColor;color:inherit;border-radius:4px;padding:2px 10px;cursor:pointer;font:inherit;min-height:24px";
        btn.addEventListener("click", () => { runUndo(); elements.mainSearchInput.focus(); });
        toast.appendChild(btn);
        pendingUndo = { restore, onExpire, toast, timer: setTimeout(expireUndo, 6000) };
      }
      document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z") && pendingUndo) {
          e.preventDefault();
          runUndo();
        }
      }, true);
      function snapshotCart() {
        return {
          lines: JSON.parse(JSON.stringify(state.invoiceLines)),
          percent: state.percentDiscount, fixed: state.fixedDiscount,
          customer: state.attachedCustomer
        };
      }
      function restoreCart(snap) {
        state.invoiceLines = JSON.parse(JSON.stringify(snap.lines));
        state.percentDiscount = snap.percent;
        state.fixedDiscount = snap.fixed;
        elements.inputPercentDiscount.value = snap.percent || "";
        elements.inputFixedDiscount.value = snap.fixed || "";
        if (snap.customer && (!state.attachedCustomer || state.attachedCustomer.id !== snap.customer.id)) attachCustomer(snap.customer);
        else if (!snap.customer && state.attachedCustomer) detachCustomer();
        renderInvoice();
        elements.mainSearchInput.focus();
      }

      function formatMoney(val) {
        return (Math.max(0, val) || 0).toFixed(2) + " EGP";
      }

      // --- SWITCH SEARCH MODE ---
      function setSearchMode(newMode) {
        state.mode = newMode;
        if (newMode === "CUSTOMER") {
          elements.modePill.className = "status-pill customer-mode";
          elements.modePillText.textContent = "Customer Search Mode";
          elements.searchModeTag.className = "search-mode-tag customer";
          elements.searchModeTag.textContent = "Customer";
          const customerPh = "Search customer by name or phone... (Press Enter to skip)";
          elements.mainSearchInput.placeholder = customerPh;
          // Keep i18n cache in sync so MutationObserver apply() does not restore the previous mode's placeholder.
          elements.mainSearchInput.dataset.novaOriginalplaceholder = customerPh;
          elements.searchHintText.textContent = "Enter: Select / Skip";
        } else {
          elements.modePill.className = "status-pill product-mode";
          elements.modePillText.textContent = "Product / Barcode Scan Mode";
          elements.searchModeTag.className = "search-mode-tag product";
          elements.searchModeTag.textContent = "Product";
          const productPh = "Scan barcode or type medicine name...";
          elements.mainSearchInput.placeholder = productPh;
          elements.mainSearchInput.dataset.novaOriginalplaceholder = productPh;
          elements.searchHintText.textContent = novaEn() ? "Enter: Add Item" : "Enter: إضافة";
        }
        closeSuggestions();
        elements.mainSearchInput.value = "";
        elements.mainSearchInput.focus();
      }

      // --- SEARCH & AUTOCOMPLETE ENGINE ---
      // UX17: "*3 query" or "query*3" sets the quantity of the added line.
      function parseQtyQuery(raw) {
        const t = String(raw || "").trim();
        let m = t.match(/^\*\s*(\d{1,3})\s+(.+)$/) || t.match(/^\*(\d{1,3})(\D.*)$/);
        if (m) return { qty: Math.max(1, +m[1]), query: m[2].trim() };
        m = t.match(/^(.*\D)\s*\*\s*(\d{1,3})$/) || t.match(/^(\d+)\s*\*\s*(\d{1,3})$/);
        if (m && m[1].trim()) return { qty: Math.max(1, +m[2]), query: m[1].trim() };
        return { qty: 1, query: t };
      }
      function addProductWithQty(product, qty) {
        const r = addProductToInvoice(product);
        if (qty > 1 && r && r.ok !== false) {
          const line = state.invoiceLines.find(l => l.productId === product.id && (l.unit || "box") === r.unit);
          if (line) { line.qty += qty - 1; renderInvoice(); warnOversell(line); }
        }
        return r;
      }

      function handleSearchInput(e) {
        const query = state.mode === "PRODUCT" ? parseQtyQuery(e.target.value).query : e.target.value.trim();
        state.searchQuery = query;

        if (query.length === 0) {
          closeSuggestions();
          return;
        }

        if (state.mode === "CUSTOMER") {
          const normalize = window.novaNormAr || (value => value.toLowerCase());
          const q = normalize(query);
          const phone = /^[+٠-٩۰-۹0-9 ()-]+$/.test(query) ? custPhoneDigits(query) : "";
          const matches = DEMO_CUSTOMERS.filter(c =>
            normalize(c.name).includes(q) || (phone && custPhoneDigits(c.phone).includes(phone))
          );
          // UX-P40c: a full phone number with no customer is offered for registration, not searched as medicines (an exact barcode still wins)
          const newPhone = !matches.length && isNewCustomerPhone(query);
          const products = matches.length || newPhone ? [] : searchProducts(query).slice(0, 40);
          if (products.length) renderProductSuggestions(products);
          else renderCustomerSuggestions(matches);
        } else {
          renderProductSuggestions(searchProducts(query).slice(0, 40));
        }
      }

      // --- UX-P40c: quick customer registration from an unknown phone number ---
      function custPhoneDigits(value) {
        return String(value ?? "").replace(/[٠-٩۰-۹]/g, d => String(d.charCodeAt(0) - (d < '۰' ? 0x660 : 0x6f0))).replace(/[^0-9]/g, "");
      }
      // a phone number = only phone characters, 9 to 15 digits, no customer with it, and not an exact product barcode
      function isNewCustomerPhone(query) {
        const q = String(query || "").trim();
        if (!/^[+٠-٩۰-۹0-9 ()-]+$/.test(q)) return false;
        const p = custPhoneDigits(q);
        if (p.length < 9 || p.length > 15) return false;
        if (DEMO_CUSTOMERS.some(c => custPhoneDigits(c.phone) === p)) return false;
        return !findExactBarcodeProduct(q);
      }
      function openQuickRegister(query) {
        const en = novaEn(), phone = custPhoneDigits(query);
        const old = document.getElementById("novaQuickReg"); if (old) { if (old._close) old._close(); else old.remove(); }
        closeSuggestions();
        const ov = document.createElement("div");
        ov.id = "novaQuickReg"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "novaQuickRegT");
        ov.style.cssText = "position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:16px";
        const inp = "width:100%;box-sizing:border-box;min-height:44px;padding:8px 10px;background:#0d1014;border:1px solid #2a3139;border-radius:8px;color:#e8eef3;font:inherit;font-size:15px";
        ov.innerHTML = `<form id="novaQuickRegForm" novalidate style="width:min(400px,100%);box-sizing:border-box;background:#14181d;border:1px solid #343b44;border-radius:14px;padding:18px;color:#e8eef3;display:flex;flex-direction:column;gap:10px">
          <h3 id="novaQuickRegT" style="margin:0;font-size:17px;font-weight:800">${en ? "Register new customer" : "تسجيل عميل جديد"}</h3>
          <label for="novaQrPhone" style="font-size:13px;color:#aab1bb">${en ? "Mobile" : "الموبايل"}</label>
          <input id="novaQrPhone" type="tel" inputmode="tel" dir="ltr" autocomplete="off" value="${escH(phone)}" style="${inp};text-align:left">
          <label for="novaQrName" style="font-size:13px;color:#aab1bb">${en ? "Name" : "الاسم"}</label>
          <input id="novaQrName" autocomplete="off" dir="auto" style="${inp}" placeholder="${en ? "Customer name" : "اسم العميل"}">
          <div id="novaQrErr" role="alert" style="color:#ff8a8f;min-height:18px;font-size:13px"></div>
          <div style="display:flex;gap:8px"><button type="submit" class="btn btn-primary" style="min-height:44px;flex:1">${en ? "Save and attach" : "حفظ وربط بالفاتورة"}</button><button type="button" class="btn btn-secondary" id="novaQrCancel" style="min-height:44px">${en ? "Cancel" : "إلغاء"}</button></div>
        </form>`;
        document.body.appendChild(ov);
        const form = ov.querySelector("form"), ph = ov.querySelector("#novaQrPhone"), nm = ov.querySelector("#novaQrName"), err = ov.querySelector("#novaQrErr");
        const close = () => { document.removeEventListener("keydown", onKey, true); ov.remove(); elements.mainSearchInput.focus(); };
        ov._close = close;
        function onKey(e) {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
          else if (e.key === "Tab") { const f = [...ov.querySelectorAll("input,button")]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); } }
          else if (/^F\d+$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); }   // no POS shortcuts behind the dialog
        }
        document.addEventListener("keydown", onKey, true);
        ov.addEventListener("mousedown", e => { if (e.target === ov) close(); });
        ov.querySelector("#novaQrCancel").addEventListener("click", close);
        form.addEventListener("submit", e => {
          e.preventDefault();
          const p = custPhoneDigits(ph.value), name = nm.value.trim();
          if (p.length < 9 || p.length > 15) { err.textContent = en ? "Mobile number must be 9 to 15 digits." : "رقم الموبايل من 9 إلى 15 رقم."; ph.focus(); return; }
          if (!name) { err.textContent = en ? "Type the customer's name." : "اكتب اسم العميل."; nm.focus(); return; }
          let customer = DEMO_CUSTOMERS.find(c => custPhoneDigits(c.phone) === p);
          if (!customer) {
            customer = { id: "DEMO-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), name, phone: p, tier: "جديد", points: 0, visits: 0, pastInvoices: [] };
            DEMO_CUSTOMERS.push(customer);
            if (!saveDemoCustomers()) { DEMO_CUSTOMERS.pop(); err.textContent = en ? "Could not save on this browser." : "تعذر حفظ العميل على هذا المتصفح."; return; }
          }
          close();
          attachCustomer(customer);
          setSearchMode("PRODUCT");
          showToast((en ? "Customer registered and attached: " : "تم تسجيل العميل وربطه بالفاتورة: ") + customer.name);
        });
        nm.focus();
      }

      function renderCustomerSuggestions(matches) {
        elements.suggestionsBox.dataset.mode = "CUSTOMER";
        state.suggestions = matches;
        state.selectedIndex = matches.length === 1 ? 0 : -1;
        if (matches.length === 0) {
          const en = novaEn(), q = state.searchQuery;
          // UX-P40c: register only from a phone number (names repeat, numbers do not)
          elements.suggestionsBox.innerHTML = isNewCustomerPhone(q) ? `
            <div class="nova-cust-new" style="padding:12px; text-align:center; font-size:13px;">
              <div style="color:var(--text-main,#e8eef3);font-weight:700">${en ? "Number" : "الرقم"} <bdi dir="ltr">${escH(custPhoneDigits(q))}</bdi> ${en ? "is not registered" : "مش مسجل"}</div>
              <div><button type="button" class="btn btn-primary" id="novaCustRegBtn" style="min-height:44px;margin-top:8px">${en ? "Register" : "سجّله"}</button></div>
              <div style="color:var(--text-dim);font-size:11px;margin-top:6px">${en ? "Enter = register · clear the box and Enter = cash sale" : "Enter = تسجيل · امسح الخانة وEnter = بيع نقدي"}</div>
            </div>` : `
            <div style="padding:12px; color:var(--text-dim); text-align:center; font-size:12px;">
              ${en ? "No customer with this name. Type their mobile number to register them, or clear the box and press Enter for a cash sale." : "مفيش عميل بالاسم ده. اكتب رقم موبايله عشان تسجّله، أو امسح الخانة واضغط Enter لبيع نقدي."}
            </div>`;
          elements.suggestionsBox.classList.add("open");
          return;
        }

        elements.suggestionsBox.innerHTML = matches.map((cust, idx) => `
          <div class="suggestion-item ${idx === state.selectedIndex ? 'selected' : ''}" data-idx="${idx}">
            <div>
              <div class="sugg-primary" dir="auto">${escH(cust.name)}</div>
              <div class="sugg-sub">${novaEn() ? "Phone" : "الموبايل"}: <bdi>${escH(cust.phone)}</bdi> · ${novaEn() ? "Visits" : "الزيارات"}: ${escH(cust.visits)}</div>
            </div>
            <div class="sugg-meta">
              <span class="sugg-tag" style="background:#4c1d95; color:#ddd6fe;">${tierAr(cust.tier)}</span>
              <div style="font-size:12px; color:#a78bfa; margin-top:2px;">${cust.points} Pts</div>
            </div>
          </div>
        `).join("");
        elements.suggestionsBox.classList.add("open");
      }

      window.novaShortages = {
        KEY: "nova-rx-shortages-v1",
        list() { try { const v = JSON.parse(localStorage.getItem(this.KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } },
        add(text, qty) {
          text = String(text || "").trim(); if (!text) return 0;
          const d = new Date(), date = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
          const l = this.list(); let e = l.find(x => x.text === text && x.date === date);
          if (e) e.count = (e.count || 1) + 1; else { e = { text, date, qty: qty || 1, count: 1 }; l.push(e); }
          try { localStorage.setItem(this.KEY, JSON.stringify(l)); } catch (er) { return 0; }
          return e.count;
        }
      };

      function renderProductSuggestions(matches) {
        elements.suggestionsBox.dataset.mode = "PRODUCT";
        state.suggestions = matches;
        state.selectedIndex = matches.length > 0 ? 0 : -1;
        if (matches.length === 0) {
          elements.suggestionsBox.innerHTML = `
            <div style="padding:12px; color:var(--text-dim); text-align:center; font-size:12px;">
              No products found matching "${escH(state.searchQuery)}".
              <div><button type="button" class="btn btn-secondary" id="novaShortageBtn" style="min-height:44px;margin-top:8px">سجّل نقص</button></div>
            </div>
          `;
          elements.suggestionsBox.classList.add("open");
          return;
        }

        const q = state.searchQuery;
        const heading = state.mode === "CUSTOMER"
          ? `<div class="sugg-sub" style="padding:8px 12px">${novaEn() ? "Matching medicines" : "أصناف مطابقة"}</div>`
          : "";
        elements.suggestionsBox.innerHTML = heading + matches.map((prod, idx) => {
          const str = extractStrength(prod), pk = extractPack(prod), gen = prod.generic || prod.activeIngredient || "";
          const measureNote = sourceMeasureNeedsReview(str) ? (novaEn() ? 'Source value — verify pack/strength' : 'قيمة من المصدر — راجع العبوة والتركيز') : (novaEn() ? 'Source description' : 'وصف المصدر');
          const sub = [
            gen ? `<span class="sugg-generic">${highlightText(gen, q)}</span>` : "",
            str ? `<span class="sugg-strength" data-hl="strength" title="${escH(measureNote)}">${highlightText(str, q)} <small>${escH(measureNote)}</small></span>` : "",
            pk && pk !== str ? `<span class="sugg-pack" data-hl="pack">${highlightText(pk, q)}</span>` : ""
          ].filter(Boolean).join(" • ");
          return `
          <div class="suggestion-item ${idx === state.selectedIndex ? 'selected' : ''}" data-idx="${idx}">
            <div class="sugg-product-text">
              <div class="sugg-primary" dir="auto" data-hl="name">${highlightText(prod.name, q)}</div>
              <div class="sugg-sub">${sub}</div>
            </div>
            <div class="sugg-meta">
              <div class="sugg-price">${Number(prod.price || 0).toFixed(2)} EGP</div>
              <span class="sugg-stock" data-stock-known="${Number.isFinite(prod.stock)}">${escH(searchStockLabel(prod))}</span>
              <span class="sugg-tag" data-hl="barcode">${highlightText(prod.barcode, q)}</span>
            </div>
          </div>
        `;
        }).join("");
        elements.suggestionsBox.classList.add("open");
      }

      function closeSuggestions() {
        elements.suggestionsBox.classList.remove("open");
        elements.suggestionsBox.innerHTML = "";
        delete elements.suggestionsBox.dataset.mode;
        state.suggestions = [];
        state.selectedIndex = -1;
      }

      // --- KEYBOARD NAVIGATION FOR SEARCH INPUT ---
      function handleSearchKeyDown(e) {
        const parsedQ = state.mode === "PRODUCT" ? parseQtyQuery(elements.mainSearchInput.value) : { qty: 1, query: elements.mainSearchInput.value.trim() };
        const query = parsedQ.query;
        const lineQty = parsedQ.qty;

        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (state.suggestions.length > 0) {
            state.selectedIndex = (state.selectedIndex + 1) % state.suggestions.length;
            updateSelectedSuggestionDOM();
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (state.suggestions.length > 0) {
            state.selectedIndex = (state.selectedIndex < 0 ? state.suggestions.length - 1 : (state.selectedIndex - 1 + state.suggestions.length) % state.suggestions.length);
            updateSelectedSuggestionDOM();
          }
        } else if (e.key === "Enter") {
          if (e.isComposing) return;
          e.preventDefault();

          // Workflow A: Enter on blank customer search skips customer and switches to Product Mode!
          if (state.mode === "CUSTOMER" && query === "") {
            setSearchMode("PRODUCT");
            showToast("Customer skipped (Walk-in). Switched to Product Scan mode.");
            return;
          }

          // A matching customer takes priority over a product with the same digits.
          if (state.mode === "CUSTOMER" && (elements.suggestionsBox.dataset.mode !== "CUSTOMER" || !state.suggestions.length)) {
            const barcodeMatch = findExactBarcodeProduct(query);
            if (barcodeMatch) {
              addProductToInvoice(barcodeMatch);
              setSearchMode("PRODUCT");
              showToast(addedPrefix() + escH(barcodeMatch.name));
              return;
            }
          }

          // UX-P40c: a full phone number with no customer opens the quick registration
          if (state.mode === "CUSTOMER" && (elements.suggestionsBox.dataset.mode !== "CUSTOMER" || !state.suggestions.length) && isNewCustomerPhone(query)) {
            openQuickRegister(query);
            return;
          }

          // When a medicine name is typed in customer mode with no matching customer,
          // preserve the query and continue the search as a product instead of trapping the cashier.
          if (state.mode === "CUSTOMER" && (elements.suggestionsBox.dataset.mode !== "CUSTOMER" || !state.suggestions.length)) {
            setSearchMode("PRODUCT");
            elements.mainSearchInput.value = query;
            handleSearchInput({ target: elements.mainSearchInput });
            showToast("No customer found. Searching medicines instead.");
            return;
          }

          // UX17: Enter on an empty product search with lines opens checkout
          if (state.mode === "PRODUCT" && query === "" && state.invoiceLines.length > 0) {
            openCheckout();
            return;
          }

          // In Product Mode with query: check exact barcode match first
          if (state.mode === "PRODUCT") {
            const exactBarcode = findExactBarcodeProduct(query);
            if (exactBarcode) {
              addProductWithQty(exactBarcode, lineQty);
              elements.mainSearchInput.value = "";
              closeSuggestions();
              showToast(addedPrefix() + escH(exactBarcode.name));
              return;
            }
          }

          // UX83: unknown barcode-looking query (digits only, >=6, Arabic digits too) with no suggestion:
          // error toast, keep the shortage option visible, select the text so the next scan replaces it.
          if (state.mode === "PRODUCT" && state.suggestions.length === 0) {
            const digits = String(query).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
            if (/^\d{6,}$/.test(digits) && !findExactBarcodeProduct(query)) {
              state.searchQuery = query;
              renderProductSuggestions([]);
              showToast((localStorage.getItem('nova-rx-language') === 'en' ? 'No product for barcode: ' : 'لا يوجد صنف بهذا الباركود: ') + escH(query), 'error');
              elements.mainSearchInput.focus();
              elements.mainSearchInput.select();
              return;
            }
          }

          // Otherwise select from active dropdown if present
          if (state.suggestions.length > 0) {
            const selected = state.suggestions[Math.max(0, state.selectedIndex)];
            if (state.mode === "CUSTOMER") {
              if (state.selectedIndex < 0) {
                showToast(novaEn() ? "Choose a customer from the results." : "اختار عميل من النتايج.");
                return;
              }
              attachCustomer(selected);
              setSearchMode("PRODUCT");
            } else {
              addProductWithQty(selected, lineQty);
              elements.mainSearchInput.value = "";
              closeSuggestions();
            }
          }
        } else if (e.key === "Escape") {
          closeSuggestions();
        }
      }

      function updateSelectedSuggestionDOM() {
        const items = elements.suggestionsBox.querySelectorAll(".suggestion-item");
        items.forEach((item, idx) => {
          if (idx === state.selectedIndex) {
            item.classList.add("selected");
            item.scrollIntoView({ block: "nearest" });
          } else {
            item.classList.remove("selected");
          }
        });
      }

      // --- CUSTOMER PROFILE ACTIONS ---
      function attachCustomer(customer) {
        state.attachedCustomer = customer;
        window.novaAttachedCustomer = customer;   // UX-P40c: the side-rail customer card reads the debt by customer id
        state.customerGateSkipped = true;
        elements.customerEmptyBox.style.display = "none";
        elements.customerSelectedBox.style.display = "flex";
        elements.sidebarCustBadge.style.display = "block";

        // Prefer explicit bilingual fields; split legacy "Arabic (English)" display names.
        const fullName = String(customer.name || "").trim();
        let arabicName = String(customer.nameAr || customer.arabicName || "").trim();
        let englishName = String(customer.nameEn || customer.englishName || "").trim();
        if (!arabicName && !englishName) {
          const match = fullName.match(/^(.+?)\s*\(([^()]*)\)\s*$/);
          if (match && /[\u0600-\u06FF]/.test(match[1]) && /[A-Za-z]/.test(match[2])) {
            arabicName = match[1].trim();
            englishName = match[2].trim();
          } else {
            arabicName = fullName;
          }
        }
        elements.custCardName.textContent = arabicName || englishName;
        const englishLine = document.getElementById("custCardNameEn");
        englishLine.textContent = arabicName ? englishName : "";
        englishLine.hidden = !(arabicName && englishName);
        elements.custCardPhone.textContent = customer.phone;
        elements.custCardTier.textContent = tierAr(customer.tier);
        elements.custCardVisits.textContent = customer.visits;
        elements.custCardPoints.textContent = customer.points;

        // Render Offers (subtle green accents)
        // Render Past Invoices
        renderPastInvoices(customer.pastInvoices);
        renderRefillBox(customer);
        closeSuggestions();
        persistActiveInvoice();
        showToast(`Customer attached: ${customer.name}`);
        if (state.customerGatePending) { state.customerGatePending = false; openCheckout(); }
      }

      function detachCustomer() {
        state.attachedCustomer = null;
        window.novaAttachedCustomer = null;
        state.customerGateSkipped = true;
        elements.customerEmptyBox.style.display = "flex";
        elements.customerSelectedBox.style.display = "none";
        elements.sidebarCustBadge.style.display = "none";
        elements.historySearchInput.value = "";
        persistActiveInvoice();
        showToast("Customer detached. Operating in Walk-in mode.");
        if (!elements.checkoutModal.classList.contains("active") && !elements.receiptModal.classList.contains("active")) {
          elements.mainSearchInput.focus();
        }
      }

      function latestInvoice(customer) {
        return [...((customer && customer.pastInvoices) || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
      }

      const REFILL_EARLY_DAYS = 20, REFILL_LATE_DAYS = 40; // UX71: calm timing hint thresholds (no medical advice)
      function daysSinceDate(dateStr) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
        if (!m) return null;
        const now = new Date();
        const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const b = Date.UTC(+m[1], +m[2] - 1, +m[3]);
        return Math.max(0, Math.round((a - b) / 86400000));
      }

      function renderRefillBox(customer) {
        const box = document.getElementById("custRefillBox");
        const last = latestInvoice(customer);
        box.hidden = !last;
        const daysRow = document.getElementById("custDaysSince");
        daysRow.hidden = true;
        if (!last) return;
        const chronic = new Set();
        (customer.pastInvoices || []).forEach(inv => (inv.items || []).forEach(it => {
          const p = DEMO_PRODUCTS.find(x => x.id === it.productId);
          if (p && p.category === "Chronic") chronic.add(p.name.replace(/\s*\(.*\)\s*$/, ""));
        }));
        document.getElementById("custChronicList").textContent = chronic.size ? [...chronic].join("، ") : "لا يوجد";
        document.getElementById("custLastPurchase").textContent = String(last.date).slice(0, 10);
        const n = daysSinceDate(last.date);
        if (n !== null) {
          document.getElementById("custDaysText").textContent = `صُرف منذ ${n} يوم`;
          const hint = chronic.size ? (n < REFILL_EARLY_DAYS ? "مبكر" : n > REFILL_LATE_DAYS ? "متأخر" : "") : "";
          document.getElementById("custRefillHint").textContent = hint;
          daysRow.hidden = false;
        }
      }

      function refillLastInvoice() {
        const last = latestInvoice(state.attachedCustomer);
        if (!last) return;
        let added = 0, skipped = [];
        (last.items || []).forEach(it => {
          const product = DEMO_PRODUCTS.find(p => p.id === it.productId);
          const qty = Number(it.qty) || 1;
          if (!product || !(product.stock >= qty)) { skipped.push(it.name); return; }
          for (let i = 0; i < qty; i++) addProductToInvoice(product);
          added++;
        });
        showToast(skipped.length ? `أُعيد صرف ${added} صنف، غير متاح: ${skipped.join("، ")}` : `تمت إعادة صرف ${added} صنف`, skipped.length ? "error" : undefined);
        elements.mainSearchInput.focus();
      }

      // UX322: chronic refill view (local demo data only; no messages, no therapy decisions)
      const CHRONIC_CYCLE_DAYS = 30;
      window.novaChronic = {
        cycleDays: CHRONIC_CYCLE_DAYS,
        list(customer) {
          const m = new Map();
          ((customer && customer.pastInvoices) || []).forEach(inv => (inv.items || []).forEach(it => {
            const p = DEMO_PRODUCTS.find(x => x.id === it.productId);
            if (!p || p.category !== "Chronic") return;
            const d = String(inv.date).slice(0, 10), e = m.get(p.id);
            if (!e || d > e.lastDate) m.set(p.id, { productId: p.id, name: p.name.replace(/\s*\(.*\)\s*$/, ""), lastDate: d });
          }));
          return [...m.values()].map(e => {
            const n = daysSinceDate(e.lastDate), dt = new Date(e.lastDate + "T00:00:00Z");
            dt.setUTCDate(dt.getUTCDate() + CHRONIC_CYCLE_DAYS);
            return { ...e, nextDue: dt.toISOString().slice(0, 10), daysSince: n, due: n !== null && n >= CHRONIC_CYCLE_DAYS };
          }).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
        },
        dueList(customer) { return this.list(customer).filter(x => x.due); },
        refill(customerId) {
          const c = DEMO_CUSTOMERS.find(x => String(x.id) === String(customerId));
          if (!c) return false;
          attachCustomer(c);
          const tab = document.querySelector('[data-page="sale"]'); if (tab) tab.click();
          refillLastInvoice();
          return true;
        }
      };

      function renderPastInvoices(invoices, filterText = "") {
        // Group repeat purchases into one clean row per product, newest first.
        const grouped = new Map();
        [...(invoices || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach(inv => {
          (inv.items || []).forEach(item => {
            const key = item.productId || item.name;
            if (!grouped.has(key)) grouped.set(key, { ...item, purchases: 0, totalQty: 0, lastDate: inv.date });
            const entry = grouped.get(key);
            entry.purchases += 1;
            entry.totalQty += Number(item.qty) || 0;
          });
        });
        const f = String(filterText || "").trim().toLocaleLowerCase();
        const products = [...grouped.values()].filter(item => !f || item.name.toLocaleLowerCase().includes(f)).sort((a,b) => b.purchases - a.purchases || String(b.lastDate).localeCompare(String(a.lastDate)));
        elements.pastInvoicesContainer.innerHTML = products.map(item => {
          const product = DEMO_PRODUCTS.find(p => p.id === item.productId);
          const price = product ? product.price : item.pastPrice;
          const date = String(item.lastDate || "").slice(0, 10);
          return `
            <div class="cust-purchase-row">
              <div class="cust-purchase-info">
                <div class="cust-purchase-name" dir="auto">${escH(item.name)}</div>
                <div class="cust-purchase-meta" dir="auto">
                  <span>آخر شراء: ${date}</span>
                  ${item.purchases > 1 ? `<span>${item.purchases} مرات</span>` : ""}
                </div>
              </div>
              <div class="cust-purchase-side">
                <span class="cust-purchase-price">${Number(price || 0).toFixed(2)} EGP</span>
                <button class="btn-add-history" data-prod-id="${item.productId}" title="إضافة للفاتورة بالسعر الحالي" aria-label="إضافة ${escH(item.name)} للفاتورة">+</button>
              </div>
            </div>`;
        }).join("") || '<div class="cust-purchase-empty">مفيش منتجات مطابقة</div>';
      }

      // --- INVOICE LINE ITEMS & RECALCULATION ---
      const UNIT_PREF_KEY = "nova.unitPref";
      function getUnitPref(productId) {
        try { return (JSON.parse(localStorage.getItem(UNIT_PREF_KEY) || "{}") || {})[productId] || null; } catch { return null; }
      }
      function setUnitPref(productId, unit) {
        try {
          const m = JSON.parse(localStorage.getItem(UNIT_PREF_KEY) || "{}") || {};
          m[productId] = unit;
          localStorage.setItem(UNIT_PREF_KEY, JSON.stringify(m));
        } catch {}
      }
      function addProductToInvoice(product, unit) {
        if (!unit) {
          const pref = getUnitPref(product.id);
          unit = pref && window.novaUnits.availableUnits(product).includes(pref) ? pref : "box";
        }
        const conv = window.novaUnits.convert(product, 1, unit);
        if (!conv.ok) {
          showToast("تحويل الوحدة غير متاح لهذا الصنف", "error");
          return conv;
        }
        const existingLine = state.invoiceLines.find(line => line.productId === product.id && (line.unit || "box") === conv.unit);
        if (existingLine) {
          existingLine.qty += 1;
        } else {
          state.invoiceLines.push({
            productId: product.id,
            name: product.name,
            generic: product.generic,
            barcode: product.barcode,
            form: product.form,
            unit: conv.unit,
            unitFactor: conv.perBox,
            category: product.category || '',
            boxPrice: product.price,
            price: conv.unitPrice, // Unit price for the selected sale unit
            qty: 1,
            discount: 0
          });
        }
        if (state.checkoutReserved && state.invoiceKey) { state.checkoutReserved = false; window.novaStock.release(state.invoiceKey); }
        renderInvoice();
        const k = window.novaStock && window.novaStock.keyOf(product);
        if (k && window.novaStock.hasLots(k)) {
          const line = state.invoiceLines.find(l => l.productId === product.id);
          const pick = line && window.novaStock.fefoPick(k, window.novaStock.boxQty(line));
          if (pick && !pick.ok && (pick.reason === "expired" || pick.reason === "recalled")) {
            showToast((pick.reason === "recalled" ? "ممنوع: تشغيلة مسحوبة (Recall): " : "ممنوع بيع صنف منتهي الصلاحية: ") + escH(product.name) + " — المتاح الصالح " + pick.available, "error");
            return conv;
          }
          if (pick && pick.ok && pick.hasNearExpiry) {
            const w = pick.nearExpiry[0];
            showToast("تنبيه قرب انتهاء الصلاحية: " + escH(product.name) + " — تشغيلة " + escH(w.lot) + " (" + w.daysLeft + " يوم)");
            return conv;
          }
        }
        showToast(addedPrefix() + escH(product.name));
        return conv;
      }

      function updateLineUnit(productId, newUnit) {
        const line = state.invoiceLines.find(l => l.productId === productId);
        if (!line) return { ok: false, error: "line-not-found" };
        const prod = DEMO_PRODUCTS.find(p => p.id === productId || p.barcode === line.barcode) || line;
        const conv = window.novaUnits.convert(prod, line.qty, newUnit);
        if (!conv.ok) {
          renderInvoice();
          showToast("تحويل الوحدة غير متاح لهذا الصنف", "error");
          return conv;
        }
        line.unit = conv.unit;
        setUnitPref(productId, conv.unit);
        line.unitFactor = conv.perBox;
        if (line.boxPrice === undefined && prod.price !== undefined) line.boxPrice = prod.price;
        line.price = conv.unitPrice;
        if (state.checkoutReserved && state.invoiceKey) { state.checkoutReserved = false; window.novaStock.release(state.invoiceKey); }
        renderInvoice();
        return conv;
      }
      window.novaUnits.setLineUnit = updateLineUnit;

      function updateLineQty(productId, newQty) {
        const line = state.invoiceLines.find(l => l.productId === productId);
        if (!line) return;
        const rawQty = String(newQty).trim();
        // Never interpret a scanned barcode or malformed input as a sale quantity.
        if (!/^\d+$/.test(rawQty)) {
          renderInvoice();
          showToast("Invalid quantity. Enter a number from 1 to 999.");
          return;
        }
        const q = Number(rawQty);
        if (!Number.isSafeInteger(q) || q > 999) {
          renderInvoice();
          showToast("Quantity cannot exceed 999.");
          return;
        }
        if (q === 0) {
          removeLine(productId);
        } else {
          line.qty = q;
          if (state.checkoutReserved && state.invoiceKey) { state.checkoutReserved = false; window.novaStock.release(state.invoiceKey); }
          renderInvoice();
          warnOversell(line);
          const k = window.novaStock && window.novaStock.keyOf(line);
          if (k && window.novaStock.hasLots(k)) {
            const pick = window.novaStock.fefoPick(k, window.novaStock.boxQty(line));
            if (!pick.ok && (pick.reason === "expired" || pick.reason === "recalled")) {
              showToast((pick.reason === "recalled" ? "ممنوع: تشغيلة مسحوبة (Recall): " : "ممنوع بيع صنف منتهي الصلاحية: ") + escH(line.name) + " — المتاح الصالح " + pick.available, "error");
            } else if (pick.ok && pick.hasNearExpiry) {
              const w = pick.nearExpiry[0];
              showToast("تنبيه قرب انتهاء الصلاحية: " + escH(line.name) + " — تشغيلة " + escH(w.lot) + " (" + w.daysLeft + " يوم)");
            }
          }
        }
      }

      function removeLineNow(productId) {
        const snap = snapshotCart();
        state.invoiceLines = state.invoiceLines.filter(l => l.productId !== productId);
        renderInvoice();
        showUndoToast("تم حذف الصنف", () => restoreCart(snap));
      }

      // #100: with accounts on the device, only a manager/owner may delete an item or give a big discount freely; anyone else needs a manager's approval.
      // No accounts (single-user device) = no gate. System-driven removals (stock clamp) call removeLineNow and are never gated.
      const salePolicy = {
        needsManager() {
          const A = window.novaAuth;
          try { if (!A || typeof A.hasAccounts !== 'function' || !A.hasAccounts()) return false; } catch (_) { return false; }
          const me = A.current && A.current();
          return !(me && (me.role === 'manager' || me.role === 'owner'));
        },
        discountLimitPct() { let v = NaN; try { v = parseFloat(localStorage.getItem('nova-rx-discount-limit-pct')); } catch (_) {} return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 10; },
        log(type, ap, detail) {
          try { const K = 'nova-rx-sale-approvals-v1', a = JSON.parse(localStorage.getItem(K) || '[]'); const arr = Array.isArray(a) ? a : []; arr.unshift({ type, approvedBy: ap.approvedBy, approverId: ap.approverId, unverified: !!ap.unverified, at: ap.at, detail }); localStorage.setItem(K, JSON.stringify(arr.slice(0, 500))); } catch (_) { /* audit trail is best effort */ }
        }
      };
      async function removeLine(productId) {
        if (!salePolicy.needsManager()) { removeLineNow(productId); return; }
        const line = state.invoiceLines.find(l => l.productId === productId);
        if (!line) return;
        renderInvoice(); // resets a typed quantity of 0 while the dialog is open
        const en = novaEn();
        if (!(await saleApprovalReady())) { showToast(en ? 'Approval is not available. Reload the page and try again.' : 'الموافقة مش متاحة. أعد تحميل الصفحة وحاول تاني.', 'error'); return; }
        const ap = await window.novaSaleApproval.request({ title: en ? 'Delete item' : 'حذف صنف من الفاتورة', message: (en ? 'A manager must approve deleting: ' : 'حذف الصنف ده محتاج موافقة مدير: ') + (line.name || '') });
        if (!ap) return;
        if (!state.invoiceLines.some(l => l.productId === productId)) return;
        salePolicy.log('line-delete', ap, { name: line.name, qty: line.qty, price: line.price });
        removeLineNow(productId);
      }

      // AUDIT-02 (Gemini Neon draft, reviewed): F2 / F4 on an invoice with lines open an in-app dialog instead of window.confirm.
      // F2: «علّق وابدأ جديدة» (default) / «امسحها وابدأ جديدة» / «رجوع». F4: «امسح الفاتورة» / «رجوع». Clearing keeps the undo toast.
      let activeInvoiceDialog = null;
      function openInvoiceActionDialog({ title, message, actions }) {
        if (activeInvoiceDialog) return;
        const prevFocus = document.activeElement;
        const en = novaEn();
        const overlay = document.createElement("div");
        overlay.id = "novaInvoiceActionDialog";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "novaInvoiceActionTitle");
        overlay.setAttribute("aria-describedby", "novaInvoiceActionDesc");
        overlay.dir = en ? "ltr" : "rtl";
        overlay.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.62);padding:16px";
        const card = document.createElement("div");
        card.style.cssText = "width:100%;max-width:420px;background:#14181d;color:#f1f3f5;border:1px solid #343b44;border-radius:14px;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:12px";
        const heading = document.createElement("h3");
        heading.id = "novaInvoiceActionTitle";
        heading.textContent = title;
        heading.style.cssText = "margin:0;font-size:17px;font-weight:800";
        const body = document.createElement("p");
        body.id = "novaInvoiceActionDesc";
        body.textContent = message;
        body.style.cssText = "margin:0;font-size:14px;line-height:1.6;color:#aab1bb";
        const btnWrap = document.createElement("div");
        btnWrap.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:4px";
        const buttons = [];
        function closeDialog(restoreFocus = true) {
          if (!activeInvoiceDialog) return;
          document.removeEventListener("keydown", onKeyDown, true);
          overlay.remove();
          activeInvoiceDialog = null;
          if (restoreFocus) {
            if (prevFocus && typeof prevFocus.focus === "function" && document.contains(prevFocus)) prevFocus.focus();
            else elements.mainSearchInput.focus();
          }
        }
        actions.forEach(action => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.dataset.action = action.id;
          btn.textContent = action.label;
          btn.className = "btn " + (action.variant === "primary" ? "btn-primary" : action.variant === "danger" ? "btn-danger" : "btn-secondary");
          btn.style.cssText = "min-height:44px;width:100%;font-weight:700;justify-content:center";
          btn.addEventListener("click", () => {
            closeDialog(action.id === "cancel");
            if (typeof action.onSelect === "function") action.onSelect();
          });
          buttons.push(btn);
          btnWrap.appendChild(btn);
        });
        function onKeyDown(e) {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeDialog(true); return; }
          if (e.key === "Tab") {
            e.preventDefault(); e.stopPropagation();
            const i = buttons.indexOf(document.activeElement);
            const n = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i === -1 || i >= buttons.length - 1 ? 0 : i + 1);
            buttons[n].focus();
            return;
          }
          if (e.key === "Enter") {
            e.stopPropagation();   // the POS Enter shortcuts must not run behind the dialog
            if (!buttons.includes(document.activeElement)) { e.preventDefault(); (buttons.find((b, i) => actions[i].variant !== "danger") || buttons[0]).click(); }
            return;
          }
          if (/^F\d+$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); }
        }
        overlay.addEventListener("click", e => { if (e.target === overlay) closeDialog(true); });
        card.append(heading, body, btnWrap);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        document.addEventListener("keydown", onKeyDown, true);
        activeInvoiceDialog = { overlay, close: closeDialog };
        // a stray Enter (barcode scanner) must never run a destructive choice: focus the first non-danger button
        (buttons.find((b, i) => actions[i].variant !== "danger") || buttons[0]).focus();
      }
      function executeClearInvoice(showUndo = true) {
        const snap = showUndo ? snapshotCart() : null;
        state.invoiceLines = [];
        state.coupon = '';
        state.percentDiscount = 0;
        state.fixedDiscount = 0;
        elements.inputPercentDiscount.value = "";
        elements.inputFixedDiscount.value = "";
        renderInvoice();
        // a held / already-saved invoice is not «cleared»: no undo (undo would duplicate the held invoice)
        if (showUndo) showUndoToast(novaEn() ? "Invoice cleared" : "تم مسح الفاتورة", () => restoreCart(snap));
        elements.mainSearchInput.focus();
      }
      function clearInvoice(alreadySaved = false) {
        if (state.invoiceLines.length === 0) {
          elements.mainSearchInput.focus();
          return;
        }
        if (alreadySaved === true) { executeClearInvoice(false); return; }
        const en = novaEn();
        openInvoiceActionDialog({
          title: en ? "Clear open invoice?" : "مسح الفاتورة المفتوحة؟",
          message: en ? "Clear all items from this open invoice? Saved invoices stay unchanged." : "مسح كل أصناف الفاتورة المفتوحة؟ الفواتير المحفوظة لن تتغير.",
          actions: [
            { id: "clear", label: en ? "Clear invoice" : "امسح الفاتورة", variant: "danger", onSelect: () => executeClearInvoice() },
            { id: "cancel", label: en ? "Back" : "رجوع", variant: "secondary" }
          ]
        });
        return false;
      }

      function lineOverStock(line) {
        try {
          if (!window.novaStock) return null;
          const k = window.novaStock.keyOf(line);
          const a = window.novaStock.available(k, state.invoiceKey);
          if (!Number.isFinite(a)) return null;
          const f = Number(line.unitFactor) > 1 ? Number(line.unitFactor) : 1;
          const need = window.novaStock.boxQty(line);
          if (need - a <= 1e-7) return null;
          return { available: Math.max(0, Math.floor(Math.max(0, a) * f + 1e-7)) };
        } catch (_) { return null; }
      }
      function warnOversell(line) {
        const o = line && lineOverStock(line);
        if (o) showToast("المخزون لا يكفي: " + escH(dispName(line.name)) + " — المتاح " + o.available, "error");
      }
      function clampLineToStock(productId) {
        const line = state.invoiceLines.find(l => l.productId === productId);
        const o = line && lineOverStock(line);
        if (!o) return;
        if (o.available <= 0) removeLineNow(productId); else updateLineQty(productId, String(o.available));
      }

      function renderInvoice() {
        persistActiveInvoice();
        if (state.invoiceLines.length === 0) {
          elements.invoiceTableBody.innerHTML = "";
          elements.emptyInvoiceState.style.display = "flex";
          elements.btnCheckout.disabled = true;
        } else {
          elements.emptyInvoiceState.style.display = "none";
          elements.btnCheckout.disabled = false;

          const offCalc = offersCalc();
          elements.invoiceTableBody.innerHTML = state.invoiceLines.map((line, idx) => {
            const segs = lineSegments(line);
            const lineGross = segs.reduce((s, g) => s + (g.qty * g.price), 0);
            const lineTotal = Math.max(0, lineGross - line.discount);
            let lotHtml = "";
            if (window.novaStock && window.novaStock.hasLots(window.novaStock.keyOf(line))) {
              const pick = window.novaStock.fefoPick(window.novaStock.keyOf(line), window.novaStock.boxQty(line));
              if (pick.ok) {
                line._lots = pick.picks; line.lot = pick.lot; line.expiry = pick.expiry;
                const lotSummary = pick.picks.map(p => `${escH(p.lot)} (${escH(p.expiry)}${pick.picks.length > 1 ? " ×" + p.qty : ""})`).join("، ");
                lotHtml = `<div class="item-lot" data-fefo-lot="${escH(pick.lot)}" data-fefo-expiry="${escH(pick.expiry)}" style="font-size:12px;color:#93c5fd;margin-top:2px">تشغيلة: ${lotSummary}</div>`;
                if (pick.hasNearExpiry) {
                  const w = pick.nearExpiry[0];
                  lotHtml += `<div class="item-expiry-warn" role="status" data-near-expiry="${escH(w.lot)}" style="font-size:12px;color:#fde68a;background:#422006;border:1px solid #b45309;padding:2px 6px;border-radius:var(--r-1);display:inline-block;margin-top:2px">تنبيه قرب انتهاء الصلاحية: ${escH(w.lot)} (${w.daysLeft} يوم)</div>`;
                }
              } else {
                line._lots = []; line.lot = null; line.expiry = null;
                if (pick.reason === "expired") {
                  lotHtml = `<div class="item-expiry-blocked" role="alert" data-expired-blocked="true" style="font-size:12px;color:#fecaca;background:#450a0a;border:1px solid #dc2626;padding:2px 6px;border-radius:var(--r-1);display:inline-block;margin-top:2px">منتهي الصلاحية — محظور البيع (المتاح الصالح: ${pick.available})</div>`;
                }
              }
            }
            const prod = DEMO_PRODUCTS.find(p => p.id === line.productId || p.barcode === line.barcode) || line;
            const units = window.novaUnits.availableUnits(prod);
            const curUnit = line.unit || "box";
            const offNote = offCalc.lines[idx];
            if (offNote) lotHtml += `<div class="item-offer" data-offer-discount="${offNote.discount.toFixed(2)}" style="font-size:12px;color:#86efac;margin-top:2px">${novaEn() ? 'Offer: ' : 'عرض: '}${escH(offNote.name)} (−${offNote.discount.toFixed(2)})</div>`;
            const over = lineOverStock(line);
            if (over) lotHtml += `<div class="item-oversell" role="alert" data-oversell="${over.available}" style="font-size:13px;color:#fecaca;background:#450a0a;border:1px solid #dc2626;padding:2px 8px;border-radius:4px;display:inline-flex;gap:8px;align-items:center;margin-top:2px">المتاح ${over.available} <button type="button" class="btn-oversell-fix" data-act="fixstock" data-id="${line.productId}" style="min-height:32px;background:#7f1d1d;color:#fff;border:1px solid #dc2626;border-radius:4px;padding:0 8px;cursor:pointer">اضبط على المتاح</button></div>`;
            return `
              <tr data-id="${line.productId}">
                <td class="col-idx">${idx + 1}</td>
                <td class="col-item">
                  <div class="item-title" dir="auto">${escH(dispName(line.name))}</div>
                  <div class="item-generic">${escH(line.generic)}${line.generic && line.form ? " • " : ""}${escH(line.form)}</div>
                  ${lotHtml}
                </td>
                <td class="col-barcode">${line.barcode}</td>
                <td class="col-price">${segs.length > 1 ? segs.map(g => g.price.toFixed(2)).join(' / ') : (segs[0] ? segs[0].price : line.price).toFixed(2)}</td>
                <td class="col-qty">
                  <div class="qty-control">
                    <button class="qty-btn" data-act="dec" data-id="${line.productId}">−</button>
                    <input type="text" class="qty-input" data-id="${line.productId}" value="${line.qty}">
                    <button class="qty-btn" data-act="inc" data-id="${line.productId}">+</button>
                    <select class="unit-select" data-id="${line.productId}" style="min-height:44px;background:#0f172a;color:#f8fafc;border:1px solid #334155;border-radius:var(--r-1);padding:0 6px;font-size:12px;">
                      ${units.map(u => `<option value="${u}" ${curUnit === u ? "selected" : ""}>${window.novaUnits.label(u)}</option>`).join("")}
                    </select>
                  </div>
                </td>
                <td class="col-disc${line.discount > 0 ? "" : " no-disc"}" style="color:var(--text-dim);">${line.discount.toFixed(2)}</td>
                <td class="col-total">${lineTotal.toFixed(2)}</td>
                <td class="col-act">
                  <button class="btn-icon-del" data-act="del" data-id="${line.productId}" title="Remove item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </td>
              </tr>
            `;
          }).join("");
        }

        recalculateFinancials();
      }

      // One FEFO pass per line per tick: render + totals call this several times for the same line.
      let segCache = null;
      function lineSegments(line) {
        if (!segCache) { segCache = new Map(); Promise.resolve().then(() => { segCache = null; }); }
        const sig = [line.qty, line.unitFactor, line.price, line.unit, line.barcode, line.productId].join('|');
        const hit = segCache.get(line);
        if (hit && hit.sig === sig) return hit.segs;
        const segs = lineSegmentsRaw(line);
        segCache.set(line, { sig, segs });
        return segs;
      }
      function lineSegmentsRaw(line) {
        const lineQty = Number(line.qty) || 0;
        const linePrice = Number(line.price) || 0;
        const stock = window.novaStock;
        if (!stock) return [{ qty: lineQty, price: linePrice }];
        const k = stock.keyOf(line);
        if (!stock.hasLots(k)) return [{ qty: lineQty, price: linePrice }];
        const pick = stock.fefoPick(k, stock.boxQty(line));
        if (!pick || !pick.ok || !pick.picks || !pick.picks.length) {
          return [{ qty: lineQty, price: linePrice }];
        }
        const f = (Number(line.unitFactor) || 1) > 1 ? Number(line.unitFactor) : 1;
        const segs = [];
        for (const p of pick.picks) {
          const rawQty = p.qty * f;
          const segQty = Math.round(rawQty);
          if (Math.abs(rawQty - segQty) > 1e-6 || segQty <= 0) {
            return [{
              qty: lineQty,
              price: linePrice,
              lots: pick.picks.map(x => ({ lot: x.lot, expiry: x.expiry, qty: x.qty, cost: Number(x.cost) || 0 }))
            }];
          }
          const hasLotPrice = p.price != null && p.price !== '' && Number.isFinite(Number(p.price)) && Number(p.price) > 0;
          const segPrice = hasLotPrice ? Math.round((Number(p.price) / f) * 100) / 100 : linePrice;
          const lotEntry = { lot: p.lot, expiry: p.expiry, qty: p.qty, cost: Number(p.cost) || 0 };
          const prev = segs[segs.length - 1];
          if (prev && prev.price === segPrice) {
            prev.qty += segQty;
            prev.lots.push(lotEntry);
          } else {
            segs.push({ qty: segQty, price: segPrice, lots: [lotEntry] });
          }
        }
        return segs.length ? segs : [{ qty: lineQty, price: linePrice }];
      }

      // #99: automatic offers + coupon (lazy app/578). Their discount is NOT a manual discount: it never asks for manager approval.
      const OFFERS_KEY = 'nova-rx-offers-v1';
      let offersLoading = false;
      function offersStored() { try { return !!localStorage.getItem(OFFERS_KEY); } catch (_) { return false; } }
      function offersCalc() {
        const none = { total: 0, offerTotal: 0, couponDiscount: 0, lines: [], coupon: null, couponError: null };
        if (!state.invoiceLines.length) return none;
        if (!window.novaOffers) {
          if (offersStored() && !offersLoading && window.novaLazy && window.novaLazy.load) { offersLoading = true; window.novaLazy.load().then(() => { if (window.novaOffers) renderInvoice(); }, () => { offersLoading = false; }); }
          return none;
        }
        try {
          return window.novaOffers.evaluate(state.invoiceLines.map(l => ({ barcode: l.barcode, productId: l.productId, category: l.category, qty: l.qty, gross: lineSegments(l).reduce((s, g) => s + g.qty * g.price, 0), discount: l.discount })), { coupon: state.coupon, saleId: state.invoiceKey });
        } catch (_) { return none; }
      }
      async function ensureOffersReady() {
        if (window.novaOffers || !offersStored()) return true;
        const prevTotal = recalculateFinancials().grandTotal;
        try { if (window.novaLazy && window.novaLazy.load) await window.novaLazy.load(); } catch (_) { /* checked below */ }
        if (window.novaOffers) {
          renderInvoice();
          offersChanged();
          const nextTotal = recalculateFinancials().grandTotal;
          if (Math.abs(nextTotal - prevTotal) > 1e-6) { // the total shown in the checkout was without offers: show the new one, cashier confirms again
            showToast(novaEn() ? 'Automatic offers were applied. Check the updated total and confirm again.' : 'اتطبّقت العروض التلقائية. راجع الإجمالي الجديد وأكد البيع تاني.', 'info');
            return false;
          }
          return true;
        }
        showToast(novaEn() ? 'Offers are not available. Reload the page and try again.' : 'تعذر تحميل العروض. أعد تحميل الصفحة وحاول تاني.', 'error');
        return false;
      }
      function offersChanged() {
        const { grandTotal, offers } = recalculateFinancials();
        if (elements.checkoutModal.classList.contains('active')) {
          if (state.checkoutPaymentMethod === 'cash') { const R0 = cashRound(grandTotal); elements.inputCashReceived.value = R0.due.toFixed(2); state.cashReceived = R0.due; updateChangeDue(R0.due, R0.due); }
          refreshChange();
        }
        return offers;
      }
      window.novaSaleCoupon = {
        get: () => state.coupon || '',
        set(code) {
          const c = String(code || '').trim().toUpperCase();
          if (!c) { state.coupon = ''; offersChanged(); return { ok: true, cleared: true }; }
          if (!window.novaOffers) return { ok: false, error: 'not-ready' };
          state.coupon = c;
          const r = offersChanged();
          if (r.coupon) return { ok: true, discount: r.coupon.discount };
          state.coupon = ''; offersChanged();
          return { ok: false, error: r.couponError || 'unknown' };
        }
      };

      function recalculateFinancials() {
        let subtotal = 0;
        let totalQty = 0;

        state.invoiceLines.forEach(line => {
          const lineGross = lineSegments(line).reduce((s, g) => s + (g.qty * g.price), 0);
          subtotal += lineGross - line.discount;
          totalQty += line.qty;
        });

        subtotal = Math.max(0, subtotal);

        // Overall discounts calculation (Requirement F: strictly no negative total)
        const percentVal = parseFloat(elements.inputPercentDiscount.value) || 0;
        const fixedVal = parseFloat(elements.inputFixedDiscount.value) || 0;

        const offers = offersCalc();
        const offerDiscount = Math.min(subtotal, offers.total || 0);
        const offerBase = subtotal - offerDiscount;
        const percentDiscAmount = (offerBase * Math.min(100, Math.max(0, percentVal))) / 100;
        const totalDiscountPotential = percentDiscAmount + Math.max(0, fixedVal);

        // Cap discount so total NEVER drops below 0.00
        const manualDiscount = Math.min(offerBase, totalDiscountPotential);
        const actualDiscount = offerDiscount + manualDiscount;

        // Tell the cashier when a discount value was ignored or capped (it used to change silently).
        {
          let msg = '', badP = false, badF = false;
          if (percentVal < 0) { msg = 'Discount cannot be negative. The value is ignored.'; badP = true; }
          else if (fixedVal < 0) { msg = 'Discount cannot be negative. The value is ignored.'; badF = true; }
          else if (percentVal > 100) { msg = 'Percent discount cannot exceed 100%. Using 100%.'; badP = true; }
          else if (offerBase > 0 && totalDiscountPotential > offerBase) { msg = 'Discount is larger than the invoice total. The total is set to zero.'; badP = percentVal > 0; badF = fixedVal > 0; }
          const hint = document.getElementById('discountHint');
          if (hint) { if (hint.textContent !== msg) hint.textContent = msg; hint.hidden = !msg; }
          elements.inputPercentDiscount.setAttribute('aria-invalid', String(badP));
          elements.inputFixedDiscount.setAttribute('aria-invalid', String(badF));
        }
        const grandTotal = Math.max(0, subtotal - actualDiscount);
        const vatIncluded = window.novaVat.calc(grandTotal); // configurable tax-included VAT (Settings), default 14%

        elements.totalItemsCount.textContent = totalQty;
        elements.displaySubtotal.textContent = formatMoney(subtotal);

        if (actualDiscount > 0) {
          elements.discountRow.style.display = "flex";
          elements.displayDiscount.textContent = "-" + formatMoney(actualDiscount);
        } else {
          elements.discountRow.style.display = "none";
        }

        elements.displayVat.textContent = formatMoney(vatIncluded);
        { const vl = document.getElementById('displayVatLabel'), vr = window.novaVat.get();
          if (vl && vr !== window.novaVat.DEFAULT) vl.textContent = document.documentElement.lang === 'en' ? 'VAT (' + window.novaVat.label(vr) + '% Included)' : 'ضريبة القيمة المضافة (' + window.novaVat.label(vr) + '% متضمنة)';
          else if (vl && vl.dataset.vatCustom) vl.textContent = document.documentElement.lang === 'en' ? 'VAT (' + window.novaVat.label(window.novaVat.DEFAULT) + '% Included)' : 'ضريبة القيمة المضافة (' + window.novaVat.label(window.novaVat.DEFAULT) + '% متضمنة)';
          if (vl) vl.dataset.vatCustom = vr !== window.novaVat.DEFAULT ? '1' : ''; }
        elements.displayGrandTotal.textContent = formatMoney(grandTotal);

        return { subtotal, actualDiscount, manualDiscount, offerDiscount, offers, vatIncluded, grandTotal, totalQty };
      }
      window.novaRecalc = () => { try { recalculateFinancials(); } catch (_) {} };

      // --- CHECKOUT & MODAL WORKFLOW ---
      function openCheckout() {
        // SEC-01 / S1-07: no sale without a signed-in staff session whose role may sell (cashier, pharmacist, manager, owner).
        if (window.novaStaff && !window.novaStaff.allow('sale.create')) { if (!window.novaStaff.current()) window.novaStaff.check(); else showToast(novaEn() ? 'Your role cannot finalize a sale.' : 'دورك ما يسمحش بإتمام البيع.', 'error'); return; }
        const { grandTotal, totalQty } = recalculateFinancials();
        if (totalQty === 0) {
          showToast("Cannot checkout an empty invoice.", "error");
          return;
        }

        if (!state.attachedCustomer && !state.customerGateSkipped) {
          document.getElementById("customerCheckoutGate").hidden = false;
          document.getElementById("gatePhone").value = "";
          document.getElementById("gateNewCustomerFields").hidden = true;
          document.getElementById("gateCustomerName").value = "";
          document.getElementById("gateFindCustomer").textContent = "متابعة بالرقم";
          document.getElementById("gateCustomerResult").textContent = "";
          setTimeout(() => document.getElementById("gatePhone").focus(), 0);
          return;
        }
        if (!state.checkoutReserved) { // INV-03: hold the units for 2 minutes before the payment window opens
          const key = state.invoiceKey || (state.invoiceKey = window.novaStock.newKey());
          window.novaStock.withLock(() => window.novaStock.reserve(key, state.invoiceLines)).then(r => {
            if (!r.ok) { showToast(r.error === "storage" ? "تعذر حجز المخزون" : r.recalled ? "ممنوع: تشغيلة مسحوبة (Recall): " + r.name : r.expired ? "ممنوع بيع صنف منتهي الصلاحية: " + r.name + " — المتاح الصالح " + r.available : r.error ? "تحويل الوحدة غير متاح: " + (r.name || "") : "المخزون لا يكفي: " + r.name + " — المتاح " + r.available, "error"); return; }
            state.checkoutReserved = true; openCheckout();
          });
          return;
        }
        document.getElementById("customerCheckoutGate").hidden = true;
        elements.modalAmountDue.textContent = formatMoney(grandTotal);
        document.getElementById("checkoutAddCustomer").hidden = !!state.attachedCustomer;
        elements.modalCustomerInfo.textContent = state.attachedCustomer 
          ? `Customer: ${state.attachedCustomer.name} (${state.attachedCustomer.phone})`
          : "Walk-in Customer (No loyalty attached)";

        state.checkoutPaymentMethod = "cash";
        document.querySelectorAll(".pay-method-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-method") === "cash"));
        document.getElementById("cashDetailsBox").style.display = "block"; document.getElementById("splitDetailsBox").style.display = "none";
        document.getElementById("walletDetailsBox").style.display = "none"; document.getElementById("inputWalletRef").value = ""; document.getElementById("inputWalletKind").value = "wallet";
        document.getElementById("inputCardAmount").value = ""; document.getElementById("inputCreditAmount").value = "";
        { const R0 = cashRound(grandTotal); elements.inputCashReceived.value = R0.due.toFixed(2); state.cashReceived = R0.due; updateChangeDue(R0.due, R0.due); }
        refreshChange();

        elements.checkoutModal.classList.add("active");
        elements.inputCashReceived.focus();
        elements.inputCashReceived.select?.();
      }

      function closeCheckout() {
        if (state.checkoutReserved) { state.checkoutReserved = false; if (state.invoiceKey) window.novaStock.release(state.invoiceKey); }
        if (state.invoiceKey) window.novaPay.voidCard(state.invoiceKey);
        elements.checkoutModal.classList.remove("active");
        elements.mainSearchInput.focus();
      }

      function refreshChange() {
        const { grandTotal } = recalculateFinancials(), tp = currentTenderPlan(grandTotal);
        elements.displayChangeDue.textContent = formatMoney(tp.ok ? tp.change : 0);
        { const R1 = dueForMethod(grandTotal, state.checkoutPaymentMethod), rn = document.getElementById('checkoutRoundingNote');
          elements.modalAmountDue.textContent = formatMoney(R1.due);
          if (rn) { rn.hidden = !R1.rounding; rn.textContent = R1.rounding ? (novaEn() ? 'Rounded from ' : 'بعد التقريب من ') + formatMoney(grandTotal) + ' (' + (R1.rounding > 0 ? '+' : '−') + formatMoney(Math.abs(R1.rounding)) + ')' : ''; } }
        const needCust = !tp.ok && tp.error === "credit-needs-customer";
        const hint = document.getElementById("checkoutCreditHint");
        const split = state.checkoutPaymentMethod === 'split';
        if (hint) hint.hidden = !(needCust || (split && !state.attachedCustomer));
        const creditInput = document.getElementById('inputCreditAmount');
        creditInput.disabled = !state.attachedCustomer;
        creditInput.setAttribute('aria-describedby', 'checkoutCreditHint');
        const attach = document.getElementById('checkoutAddCustomer');
        if (attach) attach.textContent = (localStorage.getItem("nova-rx-language") === "en") ? (needCust || split ? 'Link customer for credit' : 'Add customer (optional)') : (needCust || split ? 'ربط عميل للبيع الآجل' : 'إضافة رقم العميل (اختياري)');
        const allocation = document.getElementById('checkoutAllocation');
        if (allocation) {
          allocation.hidden = !split;
          const n = id => Math.max(0, Number(document.getElementById(id).value) || 0);
          const assigned = Math.round((n('inputCashReceived') + n('inputCardAmount') + n('inputCreditAmount')) * 100) / 100;
          const remaining = Math.round((grandTotal - assigned) * 100) / 100;
          allocation.textContent = ((localStorage.getItem("nova-rx-language") === "en") ? 'Allocated: ' : 'الموزّع: ') + formatMoney(assigned) + ' · ' +
            (remaining < 0 ? ((localStorage.getItem("nova-rx-language") === "en") ? 'Excess: ' : 'الزيادة: ') : ((localStorage.getItem("nova-rx-language") === "en") ? 'Remaining: ' : 'المتبقي: ')) + formatMoney(Math.abs(remaining));
        }
        const wh = document.getElementById('walletRefHint');
        if (wh) {
          const wmsg = state.checkoutPaymentMethod === 'wallet' && !tp.ok ? (tp.error === 'ref-duplicate' ? novaEn() ? 'This transaction number was already used on another sale.' : 'رقم العملية ده مستخدم في فاتورة تانية.' : tp.error === 'ref-needed' ? novaEn() ? 'Type the transaction number to continue.' : 'اكتب رقم العملية عشان تكمّل.' : '') : '';
          wh.textContent = wmsg; wh.hidden = !wmsg;
        }
        elements.btnConfirmPayment.disabled = !!state.paymentSubmitting || !tp.ok;
      }

      function updateChangeDue(received, total) {
        const change = Math.max(0, received - total);
        elements.displayChangeDue.textContent = formatMoney(change);
      }

      // Local sales ledger (this device only). Newest first, capped; failures are reported, never silent.
      window.novaSales = (function () {
        const KEY = 'nova-rx-sales-v1', MAX = 1000;
        const RKEY = 'nova-rx-returns-v1', round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
        const read = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && Array.isArray(x.lines)) : []; } catch (_) { return []; } };
        return {
          list: read,
          add(sale) {
            try {
              const all = read();
              if (all.some(x => x.id === sale.id)) return true; // idempotent on id
              all.unshift(sale);
              localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)));
              try { if (window.novaSync) window.novaSync.afterSale(sale); } catch (_) { /* S1-03: outbox + stock ledger wiring never blocks a sale */ }
              return true;
            } catch (_) { return false; }
          },
          // Returns (refunds). Stored apart from the sale; the sale is never edited. Refund goes back to the original payment method.
          returns() { try { const a = JSON.parse(localStorage.getItem(RKEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.saleId && Array.isArray(x.lines)) : []; } catch (_) { return []; } },
          returnedQty(saleId) { const m = {}; this.returns().filter(r => r.saleId === saleId).forEach(r => r.lines.forEach(l => { m[l.idx] = (m[l.idx] || 0) + l.qty; })); return m; },
          returnedAmount(saleId) { return round2(this.returns().filter(r => r.saleId === saleId).reduce((t, r) => t + (Number(r.amount) || 0), 0)); },
          quoteReturn(sale, qtyByIdx) {
            const done = this.returnedQty(sale.id);
            const net = sale.lines.map(l => (l.price * l.qty) - (l.discount || 0));
            const sumNet = net.reduce((x, y) => x + y, 0) || 1, ratio = sale.total / sumNet;
            const lines = []; let amount = 0, any = 0;
            for (const [k, v] of Object.entries(qtyByIdx || {})) {
              const i = Number(k), q = Number(v); if (!q) continue;
              const l = sale.lines[i];
              if (!l || !Number.isInteger(q) || q < 0) return { ok: false, error: 'invalid' };
              if (q + (done[i] || 0) > l.qty) return { ok: false, error: 'too-many' };
              lines.push({ idx: i, name: l.name, qty: q }); amount += net[i] / l.qty * q * ratio; any += q;
            }
            if (!any) return { ok: false, error: 'empty' };
            const remaining = round2(sale.total - this.returnedAmount(sale.id));
            const left = sale.lines.reduce((t, l, i) => t + l.qty - (done[i] || 0) - (Number(qtyByIdx[i]) || 0), 0);
            amount = left === 0 ? remaining : Math.min(round2(amount), remaining);
            return { ok: true, lines, amount };
          },
          // Backup: plain JSON of this device's sales and returns. Import validates everything first and only ADDS records whose id is not already here.
          exportBackup() { return JSON.stringify({ format: 'nova-rx-sales-backup', version: 1, exportedAt: new Date().toISOString(), sales: read(), returns: this.returns() }, null, 2); },
          parseBackup(text) {
            let d; try { d = JSON.parse(text); } catch (_) { return { ok: false, error: 'not-json' }; }
            if (!d || d.format !== 'nova-rx-sales-backup' || d.version !== 1 || !Array.isArray(d.sales) || !Array.isArray(d.returns)) return { ok: false, error: 'wrong-format' };
            const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0, str = v => typeof v === 'string' && v.length > 0;
            const goodSale = x => x && typeof x === 'object' && str(x.id) && str(x.number) && str(x.at) && !Number.isNaN(Date.parse(x.at)) && num(x.total) && Array.isArray(x.lines) && x.lines.length > 0
              && x.lines.every(l => l && str(l.name) && num(l.price) && Number.isInteger(l.qty) && l.qty > 0 && (l.discount === undefined || num(l.discount)));
            const goodRet = (r, sales) => r && typeof r === 'object' && str(r.id) && str(r.saleId) && num(r.amount) && str(r.at) && !Number.isNaN(Date.parse(r.at)) && Array.isArray(r.lines) && r.lines.length > 0
              && r.lines.every(l => l && Number.isInteger(l.idx) && l.idx >= 0 && Number.isInteger(l.qty) && l.qty > 0) && sales.has(r.saleId);
            const ids = new Set(d.sales.map(x => x && x.id));
            if (ids.size !== d.sales.length) return { ok: false, error: 'invalid' };
            if (!d.sales.every(goodSale)) return { ok: false, error: 'invalid' };
            const known = new Set([...ids, ...read().map(x => x.id)]);
            if (!d.returns.every(r => goodRet(r, known))) return { ok: false, error: 'invalid' };
            const have = new Set(read().map(x => x.id)), haveR = new Set(this.returns().map(x => x.id));
            const newSales = d.sales.filter(x => !have.has(x.id)), newReturns = d.returns.filter(r => !haveR.has(r.id));
            return { ok: true, newSales, newReturns, skippedSales: d.sales.length - newSales.length, skippedReturns: d.returns.length - newReturns.length };
          },
          applyBackup(p) {
            if (!p || !p.ok) return { ok: false, error: 'invalid' };
            const sales = read().concat(p.newSales), rets = this.returns().concat(p.newReturns);
            if (sales.length > MAX || rets.length > MAX) return { ok: false, error: 'too-many' };
            sales.sort((x, y) => Date.parse(y.at) - Date.parse(x.at)); rets.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
            const before = [localStorage.getItem(KEY), localStorage.getItem(RKEY)];
            try { localStorage.setItem(KEY, JSON.stringify(sales)); localStorage.setItem(RKEY, JSON.stringify(rets)); return { ok: true }; }
            catch (_) { try { before[0] === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, before[0]); before[1] === null ? localStorage.removeItem(RKEY) : localStorage.setItem(RKEY, before[1]); } catch (__) {} return { ok: false, error: 'storage' }; }
          },
          // Lot + cost reversal for a quote: the returned units are the tail of what the sale took, so they go back to the lots listed last (same rule the lot view uses). Cost = lot cost x box units.
          reversal(sale, lines) {
            const done = this.returnedQty(sale.id), c9 = x => Math.round(x * 1e9) / 1e9; let cost = 0; const lots = [];
            lines.forEach(rl => {
              const l = sale.lines[rl.idx]; if (!l || !Array.isArray(l.lots) || !l.lots.length) return;
              const uf = Number(l.unitFactor) > 0 ? Number(l.unitFactor) : 1, from = c9((l.qty - (done[rl.idx] || 0) - rl.qty) / uf), to = c9((l.qty - (done[rl.idx] || 0)) / uf);
              let pos = 0;
              l.lots.forEach(al => {
                const a = pos, b = c9(pos + (Number(al.qty) || 0)); pos = b;
                const q = c9(Math.min(b, to) - Math.max(a, from)); if (q <= 0) return;
                lots.push({ idx: rl.idx, lot: al.lot, expiry: al.expiry, qty: q }); cost += q * (Number(al.cost) || 0);
              });
            });
            return { lots, cost: round2(cost) };
          },
          isCancelled(saleId) { return this.returns().some(r => r.saleId === saleId && r.kind === 'cancel'); },
          // Cancellation = return of everything still returnable, never an edit. Needs a reason, a role allowed to cancel, and a second named person approving (local names only; there is no login yet).
          CANCEL_ROLES: ['manager', 'owner'],
          cancelSale(sale, o) {
            o = o || {};
            const reason = String(o.reason || '').trim(), by = String(o.by || '').trim(), approver = String(o.approvedBy || '').trim();
            if (!reason) return { ok: false, error: 'reason' };
            if (!this.CANCEL_ROLES.includes(o.role)) return { ok: false, error: 'permission' };
            if (!by || !approver) return { ok: false, error: 'approval' };
            if (by.toLowerCase() === approver.toLowerCase()) return { ok: false, error: 'self-approval' };
            if (this.isCancelled(sale.id)) return { ok: false, error: 'already-cancelled' };
            const done = this.returnedQty(sale.id), rest = {};
            sale.lines.forEach((l, i) => { const left = l.qty - (done[i] || 0); if (left > 0) rest[i] = left; });
            return this.addReturn(sale, rest, reason, { kind: 'cancel', by, role: o.role, approvedBy: approver, ...(o.approverId ? { approverId: String(o.approverId) } : {}) });
          },
          // UX226: undo of a just-saved plain return (UI offers it for 10s). Removes only that record; nothing else is touched.
          removeReturn(id) { try { const all = this.returns(), n = all.filter(x => x.id !== id); if (n.length === all.length) return false; localStorage.setItem(RKEY, JSON.stringify(n)); return true; } catch (_) { return false; } },
          addReturn(sale, qtyByIdx, reason, extra) {
            const text = String(reason || '').trim();
            if (!text) return { ok: false, error: 'reason' };
            if (this.isCancelled(sale.id)) return { ok: false, error: 'already-cancelled' };
            const q = this.quoteReturn(sale, qtyByIdx); if (!q.ok) return q;
            const rv = this.reversal(sale, q.lines), id = (crypto.randomUUID ? crypto.randomUUID() : 'R' + Date.now() + Math.random().toString(36).slice(2, 8));
            // Tender reversal: same method as the sale. Card refunds are MOCKED (no gateway): reference only. Cash leaves the drawer.
            const tender = { method: sale.payment, amount: q.amount, direction: 'refund', mock: sale.payment === 'card', ref: sale.payment === 'card' ? 'MOCK-' + id.slice(0, 8).toUpperCase() : null };
            const r = { id, saleId: sale.id, number: sale.number, at: new Date().toISOString(), kind: 'return', ...(extra || {}), reason: text.slice(0, 200), lines: q.lines, amount: q.amount, method: sale.payment, tender, lotsRestored: rv.lots, costReversed: rv.cost };
            try { const all = this.returns(); all.unshift(r); localStorage.setItem(RKEY, JSON.stringify(all.slice(0, 1000))); try { if (window.novaSync) window.novaSync.afterReturn(sale, r); } catch (_) { /* S1-03: local stock movement only; never blocks a return */ } return { ok: true, ret: r }; } catch (_) { return { ok: false, error: 'storage' }; }
          }
        };
      })();

      // INV-02 + INV-03 + CAT-02 (this device only): lot/expiry tracking, FEFO picking, block expired by default, configurable near-expiry warning (default 90 days),
      // reservation holds so the last unit cannot sell twice, and unit conversion (strip/tablet deduct a fraction of a box). Untracked rows stay unrestricted.
      window.novaStock = (function () {
        const HK = 'nova-rx-holds-v1', EPS = 1e-7, clean = x => Math.round(x * 1e9) / 1e9, LK = 'nova-rx-lots-v1', RCK = 'nova-rx-recalls-v1', WK = 'nova-rx-near-expiry-days-v1', BK = 'nova-rx-block-expired-v1';
        const TTL = 120000, DEFAULT_WARN_DAYS = 90;
        const keyOf = l => typeof l === 'string' ? l : String((l && (l.key || l.barcode || l.name)) || '');
        const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
        const todayStr = now => {
          if (typeof now === 'string' && validDate(now)) return now;
          const d = now !== undefined ? new Date(now) : (window.novaStock && window.novaStock._now ? new Date(window.novaStock._now) : new Date());
          return d.toISOString().slice(0, 10);
        };
        const daysUntil = (expiry, now) => Math.round((Date.parse(expiry + 'T00:00:00Z') - Date.parse(todayStr(now) + 'T00:00:00Z')) / 86400000);
        const nearExpiryDays = () => {
          try {
            const v = localStorage.getItem(WK);
            if (v === null || v === '') return DEFAULT_WARN_DAYS;
            const n = Number(v);
            return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : DEFAULT_WARN_DAYS;
          } catch (_) { return DEFAULT_WARN_DAYS; }
        };
        const setNearExpiryDays = days => {
          const n = Number(days);
          if (!Number.isInteger(n) || n < 0 || n > 3650) return { ok: false, error: 'invalid' };
          try { localStorage.setItem(WK, String(n)); if (typeof renderInvoice === 'function' && state && state.invoiceLines) renderInvoice(); return { ok: true, days: n }; }
          catch (_) { return { ok: false, error: 'storage' }; }
        };
        const isBlockExpired = () => { try { return localStorage.getItem(BK) !== '0'; } catch (_) { return true; } };
        const setBlockExpired = flag => {
          try { localStorage.setItem(BK, flag ? '1' : '0'); if (typeof renderInvoice === 'function' && state && state.invoiceLines) renderInvoice(); return { ok: true, blockExpired: !!flag }; }
          catch (_) { return { ok: false, error: 'storage' }; }
        };
        const lotRecords = () => {
          const records = JSON.parse(window.NovaReceiptOperations.readRaw(localStorage, LK) || '[]');
          if (!Array.isArray(records)) throw new Error('invalid-lot-store');
          return records;
        };
        const rawLots = () => {
          try {
            return lotRecords().filter(x => x && typeof x.key === 'string' && x.key && typeof x.lot === 'string' && x.lot && validDate(x.expiry) && Number.isInteger(x.qty) && x.qty > 0);
          } catch (_) { return []; }
        };
        // The application marker and quantity are committed in the same localStorage write.
        const receiptMarkers = () => lotRecords().find(record => Array.isArray(record?.receiptRefs))?.receiptRefs || [];
        const hasReceiptLine = ref => receiptMarkers().includes(ref);
        const recalls = () => { try { const a = JSON.parse(localStorage.getItem(RCK) || '[]'); return Array.isArray(a) ? a.filter(r => r && r.key && r.lot) : []; } catch (_) { return []; } };
        const isRecalled = (key, lot) => recalls().some(r => r.key === keyOf(key) && r.lot === lot);
        const saveLots = (lots, receiptRef) => {
          try {
            if (localStorage.getItem('nova.receipt-transaction-v1')) return false;
            const refs = receiptMarkers();
            if (receiptRef) refs.push(receiptRef);
            localStorage.setItem(LK, JSON.stringify(refs.length ? [...lots, { receiptRefs: refs }] : lots));
            return true;
          } catch (_) { return false; }
        };
        const hasLots = key => { const k = keyOf(key); return !!k && rawLots().some(x => x.key === k); };
        const lots = (key, now) => {
          const k = keyOf(key), warnDays = nearExpiryDays();
          const map = new Map();
          rawLots().filter(x => x.key === k).forEach(x => {
            const id = x.lot + '\u0000' + x.expiry;
            if (!map.has(id)) map.set(id, { key: k, lot: x.lot, expiry: x.expiry, receivedQty: 0, onHand: 0, cost: Number(x.cost) || 0, location: String(x.location || '') });
            const e = map.get(id); e.receivedQty += x.qty; e.onHand += x.qty; { const p = Number(x.price); if (Number.isFinite(p) && p > 0) e.price = p; }
          });
          const list = [...map.values()].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.lot.localeCompare(b.lot));
          if (!list.length) return [];
          [...window.novaSales.list()].reverse().forEach(s => {
            const rq = window.novaSales.returnedQty(s.id);
            s.lines.forEach((l, i) => {
              if (keyOf(l) !== k) return;
              const nq = Math.max(0, (Number(l.qty) || 0) - (rq[i] || 0)), uf = Number(l.unitFactor) > 0 ? Number(l.unitFactor) : 1;
              let net = clean(uf > 1 ? nq / uf : nq); // box units
              if (net <= 0) return;
              if (Array.isArray(l.lots) && l.lots.length) {
                for (const al of l.lots) {
                  if (net <= 0) break;
                  const m = list.find(x => x.lot === al.lot && (!al.expiry || x.expiry === al.expiry) && x.onHand > 0) || list.find(x => x.lot === al.lot && x.onHand > 0);
                  if (m) { const d = Math.min(m.onHand, net, Number(al.qty) || net); m.onHand -= d; net -= d; }
                }
              }
              if (net > 0) {
                for (const x of list) { if (net <= 0) break; if (daysUntil(x.expiry, now) >= 0 && x.onHand > 0) { const d = Math.min(x.onHand, net); x.onHand -= d; net -= d; } }
                for (const x of list) { if (net <= 0) break; if (x.onHand > 0) { const d = Math.min(x.onHand, net); x.onHand -= d; net -= d; } }
              }
            });
          });
          return list.map(x => {
            const daysLeft = daysUntil(x.expiry, now), expired = daysLeft < 0;
            return { ...x, daysLeft, expired, recalled: isRecalled(k, x.lot), nearExpiry: !expired && daysLeft <= warnDays };
          });
        };
        const fefoPick = (key, qty = 1, opts) => {
          const k = keyOf(key), q = Number(qty);
          const all = lots(k, opts && opts.now);
          const allowExp = (opts && opts.allowExpired !== undefined) ? !!opts.allowExpired : !isBlockExpired();
          const sellable = all.filter(l => l.onHand > 0 && !l.recalled && (allowExp || !l.expired));
          const recalledQty = all.filter(l => l.recalled && l.onHand > 0).reduce((s, l) => s + l.onHand, 0);
          const expiredQty = all.filter(l => l.expired && l.onHand > 0).reduce((s, l) => s + l.onHand, 0);
          const available = sellable.reduce((s, l) => s + l.onHand, 0);
          if (!Number.isFinite(q) || q <= 0) return { ok: false, reason: 'invalid', expired: false, available, expiredQty, picks: [], nearExpiry: [], hasNearExpiry: false };
          if (q > available) {
            const reason = recalledQty > 0 ? 'recalled' : !allowExp && expiredQty > 0 ? 'expired' : 'insufficient';
            return { ok: false, reason, expired: reason === 'expired', recalled: reason === 'recalled', available, expiredQty, picks: [], nearExpiry: [], hasNearExpiry: false };
          }
          let rem = q; const picks = [];
          for (const l of sellable) {
            if (rem <= 0) break;
            const take = clean(Math.min(l.onHand, rem)); rem = clean(rem - take);
            picks.push({ lot: l.lot, expiry: l.expiry, qty: take, daysLeft: l.daysLeft, nearExpiry: l.nearExpiry, expired: l.expired, cost: l.cost, location: l.location, price: l.price });
          }
          const nearExpiry = picks.filter(p => p.nearExpiry);
          return { ok: true, picks, lot: picks[0].lot, expiry: picks[0].expiry, available, expiredQty, nearExpiry, hasNearExpiry: nearExpiry.length > 0 };
        };
        const addLot = (entry, receiptRef) => {
          if (receiptRef) {
            try { if (hasReceiptLine(receiptRef)) return { ok: true, replay: true }; }
            catch (_) { return { ok: false, error: 'storage' }; }
          }
          const key = keyOf(entry).trim(), lot = String(entry && (entry.lot || entry.lotNo || entry.batch) || '').trim();
          const expiry = String(entry && (entry.expiry || entry.expiryDate || entry.exp) || '').trim(), qty = Number(entry && entry.qty);
          if (!key || !lot || !validDate(expiry) || !Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'invalid' };
          const all = rawLots(), rec = { key, lot, expiry, qty, cost: Number(entry.cost) || 0, location: String(entry.location || '') };
          const lotPrice = Math.round(Number(entry && entry.price) * 100) / 100; if (Number.isFinite(lotPrice) && lotPrice > 0) rec.price = lotPrice;
          const ex = all.find(x => x.key === key && x.lot === lot && x.expiry === expiry);
          if (ex) { ex.qty += qty; if (entry.cost !== undefined) ex.cost = rec.cost; if (entry.location !== undefined) ex.location = rec.location; if (entry.price !== undefined) { if (rec.price) ex.price = rec.price; else delete ex.price; } }
          else all.push(rec);
          if (!saveLots(all, receiptRef)) return { ok: false, error: 'storage' };
          if (typeof renderInvoice === 'function' && state && state.invoiceLines) renderInvoice();
          return { ok: true, lot: ex || rec };
        };
        const setLots = (keyOrList, maybeList) => {
          const isAll = Array.isArray(keyOrList);
          const targetKey = isAll ? null : keyOf(keyOrList).trim();
          const items = isAll ? keyOrList : (Array.isArray(maybeList) ? maybeList : []);
          if (!isAll && !targetKey) return { ok: false, error: 'invalid' };
          const normalized = [];
          for (const it of items) {
            const k = (targetKey || keyOf(it)).trim(), lot = String(it && (it.lot || it.lotNo || it.batch) || '').trim();
            const expiry = String(it && (it.expiry || it.expiryDate || it.exp) || '').trim(), qty = Number(it && it.qty);
            if (!k || !lot || !validDate(expiry) || !Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'invalid' };
            const np = Math.round(Number(it && it.price) * 100) / 100; normalized.push(Object.assign({ key: k, lot, expiry, qty, cost: Number(it.cost) || 0, location: String(it.location || '') }, Number.isFinite(np) && np > 0 ? { price: np } : {}));
          }
          const next = isAll ? normalized : rawLots().filter(x => x.key !== targetKey).concat(normalized);
          if (!saveLots(next)) return { ok: false, error: 'storage' };
          if (typeof renderInvoice === 'function' && state && state.invoiceLines) renderInvoice();
          return { ok: true };
        };
        const clearLots = key => {
          const ok = key ? saveLots(rawLots().filter(x => x.key !== keyOf(key))) : saveLots([]);
          if (typeof renderInvoice === 'function' && state && state.invoiceLines) renderInvoice();
          return ok;
        };
        const holds = () => { try { const a = JSON.parse(localStorage.getItem(HK) || '[]'); const t = Date.now(); return Array.isArray(a) ? a.filter(h => h && h.exp > t) : []; } catch (_) { return []; } };
        const findProd = key => DEMO_PRODUCTS.find(x => (x.barcode || x.name) === key || x.id === key);
        const limit = key => { const p = findProd(key); return p && Number.isFinite(p.stock) ? p.stock : null; };
        const lineBoxQty = (l, qOverride) => {
          const q = qOverride !== undefined ? qOverride : (Number(l && l.qty) || 0);
          if (q <= 0) return { ok: false, error: 'quantity-invalid' };
          const u = (l && l.unit) || 'box';
          if (u === 'box' && (!l.unitFactor || l.unitFactor === 1) && Number.isSafeInteger(q)) return { ok: true, value: clean(q) };
          const p = findProd(keyOf(l)) || l;
          const c = window.novaUnits.convert(p, q, u);
          if (!c.ok) return c;
          return { ok: true, value: c.stockFraction };
        };
        const sold = key => {
          let n = 0;
          window.novaSales.list().forEach(s => {
            const rq = window.novaSales.returnedQty(s.id);
            s.lines.forEach((l, i) => {
              if (keyOf(l) !== key) return;
              const net = (Number(l.qty) || 0) - (rq[i] || 0);
              if (net <= 0) return;
              const f = Number(l.unitFactor) > 0 ? Number(l.unitFactor) : 1;
              n += f > 1 ? net / f : (lineBoxQty(l, net).value || net);
            });
          });
          return clean(n);
        };
        const need = lines => {
          const m = new Map();
          for (const l of lines || []) {
            const r = lineBoxQty(l);
            if (!r.ok) return { ok: false, error: r.error, name: l && l.name };
            const k = keyOf(l);
            m.set(k, clean((m.get(k) || 0) + r.value));
          }
          return { ok: true, map: m };
        };
        const avail = (key, owner, hs) => {
          const held = hs.filter(h => h.key === key && h.owner !== owner).reduce((t, h) => t + h.qty, 0);
          if (hasLots(key)) {
            const allowExp = !isBlockExpired();
            return clean(lots(key).filter(l => !l.recalled && (allowExp || !l.expired)).reduce((s, l) => s + l.onHand, 0) - held);
          }
          const lim = limit(key); return lim === null ? Infinity : clean(lim - sold(key) - held);
        };
        const check = (owner, lines) => {
          const nd = need(lines); if (!nd.ok) return nd;
          const hs = holds();
          for (const [key, q] of nd.map) {
            const a = avail(key, owner, hs);
            if (q - a > EPS) {
              const expQty = hasLots(key) ? lots(key).filter(l => l.expired && l.onHand > 0).reduce((s, l) => s + l.onHand, 0) : 0;
              const isExp = isBlockExpired() && expQty > 0;
              const recQty = hasLots(key) ? lots(key).filter(l => l.recalled && l.onHand > 0).reduce((s, l) => s + l.onHand, 0) : 0;
              return { ok: false, reason: recQty > 0 ? 'recalled' : isExp ? 'expired' : 'insufficient', recalled: recQty > 0, expired: isExp, expiredQty: expQty, name: (lines.find(l => keyOf(l) === key) || {}).name, available: clean(Math.max(0, a)) };
            }
          }
          return { ok: true };
        };
        const save = a => { try { localStorage.setItem(HK, JSON.stringify(a)); return true; } catch (_) { return false; } };
        return {
          keyOf, available: (key, owner) => avail(keyOf(key), owner, holds()), holds,
          boxQty: l => { const r = lineBoxQty(l); return r.ok ? r.value : 0; },
          hasLots, lots, fefoPick, addLot, hasReceiptLine, setLots, clearLots,
          recalls, isRecalled,
          // Remove picked quantities from the stored lot receipts (transfer out). Writes nothing if any pick cannot be covered.
          _takeLots(key, picks) {
            const k = keyOf(key), all = rawLots();
            for (const p of picks) {
              let need = p.qty;
              for (const x of all) if (need > 0 && x.key === k && x.lot === p.lot && x.expiry === p.expiry) { const d = Math.min(x.qty, need); x.qty -= d; need -= d; }
              if (need > 0) return false;
            }
            return saveLots(all.filter(x => x.qty > 0));
          },
          // INV-05: recall a lot (blocks any further sale of it; reversible only by unrecall). Returns the customers reachable from local records.
          recallLot(key, lot, reason) {
            const k = keyOf(key).trim(), l = String(lot || '').trim();
            if (!k || !l || !rawLots().some(x => x.key === k && x.lot === l)) return { ok: false, error: 'unknown-lot' };
            const all = recalls();
            if (!all.some(r => r.key === k && r.lot === l)) all.push({ key: k, lot: l, reason: String(reason || ''), at: new Date().toISOString() });
            try { localStorage.setItem(RCK, JSON.stringify(all)); } catch (_) { return { ok: false, error: 'storage' }; }
            if (typeof renderInvoice === 'function' && state && state.invoiceLines) renderInvoice();
            return { ok: true, ...this.recallCustomers(k, l) };
          },
          unrecallLot(key, lot) {
            try { localStorage.setItem(RCK, JSON.stringify(recalls().filter(r => !(r.key === keyOf(key) && r.lot === lot)))); } catch (_) { return { ok: false, error: 'storage' }; }
            return { ok: true };
          },
          // Customers who bought this lot (net of returns), from saved sales. Only those whose name resolves to exactly one local customer with a phone can be notified.
          recallCustomers(key, lot) {
            const k = keyOf(key), byName = new Map(), unreachable = { walkIn: 0, noPhone: 0 };
            window.novaSales.list().forEach(s => {
              const rq = window.novaSales.returnedQty(s.id);
              s.lines.forEach((l, i) => {
                if (keyOf(l) !== k || (Number(l.qty) || 0) - (rq[i] || 0) <= 0) return;
                const picks = Array.isArray(l.lots) && l.lots.length ? l.lots : (l.lot ? [{ lot: l.lot }] : []);
                if (!picks.some(p => p.lot === lot)) return;
                const n = String(s.customer || '').trim();
                if (!n) { unreachable.walkIn++; return; }
                if (!byName.has(n)) byName.set(n, []);
                byName.get(n).push(s.number);
              });
            });
            const notify = [];
            byName.forEach((invoices, name) => {
              const m = DEMO_CUSTOMERS.filter(c => c.name === name && String(c.phone || '').replace(/[^0-9]/g, ''));
              if (m.length === 1) notify.push({ name, phone: m[0].phone, invoices }); else unreachable.noPhone++;
            });
            return { customers: notify, unreachable };
          },
          nearExpiryDays, setNearExpiryDays, isBlockExpired, setBlockExpired,
          check,
          reserve(owner, lines, ttl) { // replaces this owner's holds; fails (writes nothing) if any line is short or has an invalid unit
            const c = check(owner, lines); if (!c.ok) return c;
            const nd = need(lines);
            const rest = holds().filter(h => h.owner !== owner), exp = Date.now() + (ttl || TTL);
            for (const [key, qty] of nd.map) if (limit(key) !== null) rest.push({ owner, key, qty, exp });
            return save(rest) ? { ok: true } : { ok: false, error: 'storage' };
          },
          release(owner) { const all = holds(); if (all.some(h => h.owner === owner)) save(all.filter(h => h.owner !== owner)); },
          withLock(fn) { const run = () => { window.NovaReceiptOperations?.recover(localStorage); return fn(); }; return navigator.locks && navigator.locks.request ? navigator.locks.request('nova-rx-stock', run) : Promise.resolve().then(run); },
          newKey: () => (crypto.randomUUID ? crypto.randomUUID() : 'S' + Date.now() + Math.random().toString(36).slice(2, 8))
        };
      })();

      // INV-05 (this device only): branch transfer request -> send -> receive, with in-transit stock and quantity differences.
      // direction 'out': this branch ships; send() removes the quantity from local lots (FEFO, expired/recalled never ship). 'in': this branch asks; receive() adds the counted quantity as a lot.
      window.novaTransfers = (function () {
        const TK = 'nova-rx-transfers-v1', K = l => window.novaStock.keyOf(l);
        const read = () => { try { const a = JSON.parse(localStorage.getItem(TK) || '[]'); return Array.isArray(a) ? a.filter(t => t && t.id && t.key) : []; } catch (_) { return []; } };
        const write = a => { try { localStorage.setItem(TK, JSON.stringify(a)); return true; } catch (_) { return false; } };
        const find = (a, id) => a.find(t => t.id === id);
        return {
          list: () => read(),
          request(o) {
            const key = K(o || {}).trim(), qty = Number(o && o.qty), branch = String((o && o.branch) || '').trim();
            if (!key || !branch || !Number.isInteger(qty) || qty <= 0 || !o || (o.direction !== 'in' && o.direction !== 'out')) return { ok: false, error: 'invalid' };
            const a = read(), t = { id: window.novaStock.newKey(), direction: o.direction, branch, key, name: String(o.name || ''), qty, status: 'requested', at: new Date().toISOString() };
            a.unshift(t); return write(a) ? { ok: true, transfer: t } : { ok: false, error: 'storage' };
          },
          send(id, o) {
            const a = read(), t = find(a, id);
            if (!t) return { ok: false, error: 'unknown' };
            if (t.status !== 'requested') return { ok: false, error: 'bad-status' };
            const q = o && o.qty !== undefined ? Number(o.qty) : t.qty;
            if (!Number.isInteger(q) || q <= 0) return { ok: false, error: 'invalid' };
            if (t.direction === 'out') {
              const pick = window.novaStock.fefoPick(t.key, q, { allowExpired: false });
              if (!pick.ok) return { ok: false, error: pick.reason, available: pick.available };
              const rest = window.novaStock._takeLots(t.key, pick.picks);
              if (!rest) return { ok: false, error: 'storage' };
              t.lots = pick.picks.map(p => ({ lot: p.lot, expiry: p.expiry, qty: p.qty, cost: p.cost }));
            }
            t.sentQty = q; t.status = 'in-transit'; t.sentAt = new Date().toISOString();
            return write(a) ? { ok: true, transfer: t } : { ok: false, error: 'storage' };
          },
          // receivedQty may differ from sentQty; the difference is recorded (diff = sent - received, >0 short, <0 over), never silently dropped.
          receive(id, receivedQty, o) {
            const a = read(), t = find(a, id), q = Number(receivedQty);
            if (!t) return { ok: false, error: 'unknown' };
            if (t.status !== 'in-transit') return { ok: false, error: 'bad-status' };
            if (!Number.isInteger(q) || q < 0) return { ok: false, error: 'invalid' };
            if (t.direction === 'in' && q > 0) {
              const r = window.novaStock.addLot({ key: t.key, lot: o && o.lot, expiry: o && o.expiry, qty: q, cost: o && o.cost });
              if (!r.ok) return { ok: false, error: r.error };
              t.receivedLot = { lot: String(o.lot).trim(), expiry: String(o.expiry).trim() };
            }
            t.receivedQty = q; t.diff = t.sentQty - q; t.status = t.diff === 0 ? 'received' : 'received-diff'; t.receivedAt = new Date().toISOString();
            return write(a) ? { ok: true, transfer: t } : { ok: false, error: 'storage' };
          },
          inTransit(key) { const k = K(key); return read().filter(t => t.key === k && t.status === 'in-transit').reduce((s, t) => s + t.sentQty, 0); },
          differences: () => read().filter(t => t.status === 'received-diff')
        };
      })();

      // POS-02 (this device only, no real gateway): tender maths, mock card authorisation keyed by the invoice key (a retry reuses the same authorisation, so no double charge),
      // unique invoice numbers across the ledger/held/cancelled lists, and a cancelled-invoice log. A final sale is never edited.
      window.novaPay = (function () {
        const WALLET_METHODS = ['wallet', 'instapay', 'fawry'];
        try { Object.assign(window.NovaFmt.PAY, { wallet: 'محفظة موبايل', instapay: 'إنستاباي', fawry: 'فوري' }); } catch (_) { /* labels only */ } // separate payment methods in receipts/reports
        const AK = 'nova-rx-card-auth-v1', CK = 'nova-rx-cancelled-v1', cents = n => Math.round((Number(n) + Number.EPSILON) * 100), fromC = c => c / 100;
        const readJ = k => { try { const a = JSON.parse(localStorage.getItem(k) || 'null'); return a; } catch (_) { return null; } };
        const auths = () => { const a = readJ(AK); return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; };
        const saveAuths = a => { try { localStorage.setItem(AK, JSON.stringify(a)); return true; } catch (_) { return false; } };
        const cancelled = () => { const a = readJ(CK); return Array.isArray(a) ? a.filter(x => x && x.number) : []; };
        const amt = v => { const n = v === '' || v === null || v === undefined ? 0 : Number(v); return Number.isFinite(n) && n >= 0 ? n : NaN; };
        return {
          // t = { cash: cash handed over, card, credit }; card and credit are exact portions, cash covers the rest and any excess is change.
          plan(total, t, hasCustomer) {
            const T = cents(total), c = cents(amt(t && t.cash)), k = cents(amt(t && t.card)), r = cents(amt(t && t.credit));
            // e-payment (wallet / InstaPay / Fawry): one exact portion with a transaction reference; no real wallet integration, the reference is only recorded.
            const alt = t && t.alt && WALLET_METHODS.indexOf(t.alt.method) >= 0 ? t.alt : null, w = alt ? cents(amt(alt.amount)) : 0;
            if (![T, c, k, r, w].every(Number.isFinite) || T < 0) return { ok: false, error: 'invalid' };
            if (r > 0 && !hasCustomer) return { ok: false, error: 'credit-needs-customer' };
            if (k + r + w > T) return { ok: false, error: 'over-allocated' };
            const ref = alt ? String(alt.ref == null ? '' : alt.ref).trim().slice(0, 40) : '';
            if (w > 0 && !ref) return { ok: false, error: 'ref-needed' };
            const due = T - k - r - w;
            if (c < due) return { ok: false, error: 'short', short: fromC(due - c) };
            const tenders = [];
            if (due > 0) tenders.push({ method: 'cash', amount: fromC(due) });
            if (k > 0) tenders.push({ method: 'card', amount: fromC(k) });
            if (w > 0) tenders.push({ method: alt.method, amount: fromC(w), ref });
            if (r > 0) tenders.push({ method: 'credit', amount: fromC(r) });
            return { ok: true, tenders, payment: tenders.length > 1 ? 'mixed' : (tenders[0] ? tenders[0].method : 'cash'), received: fromC(c), change: fromC(c - due), credit: fromC(r), collected: fromC(T - r), cardAmount: fromC(k) };
          },
          cardAuth(key) { return auths()[key] || null; },
          // Idempotent on key+amount. A changed amount voids the old authorisation first. Declines write nothing.
          chargeCard(key, amount) {
            const a = auths(), ex = a[key], c = cents(amount);
            if (ex && ex.state !== 'voided' && ex.cents === c) return { ok: true, auth: ex, replay: true };
            if (window.novaPay._declineNext) { window.novaPay._declineNext = false; return { ok: false, error: 'declined' }; }
            if (ex && ex.state === 'captured') return { ok: false, error: 'already-captured' };
            const auth = { id: 'MOCK-' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)), key, cents: c, amount: fromC(c), at: new Date().toISOString(), state: 'authorized' };
            a[key] = auth; return saveAuths(a) ? { ok: true, auth, replay: false } : { ok: false, error: 'storage' };
          },
          captureCard(key) { const a = auths(); if (a[key] && a[key].state === 'authorized') { a[key].state = 'captured'; saveAuths(a); } },
          voidCard(key) { const a = auths(); if (a[key] && a[key].state === 'authorized') { a[key].state = 'voided'; saveAuths(a); } },
          cancelled,
          numberTaken(number) {
            const n = String(number);
            return window.novaSales.list().some(x => String(x.number) === n) || cancelled().some(x => String(x.number) === n);
          },
          cancel(rec, reason) {
            try { const all = cancelled(); all.unshift({ id: String(rec.id || rec.saleNumber || rec.number) + ':' + Date.now(), number: String(rec.saleNumber || rec.number), status: 'cancelled', at: new Date().toISOString(), reason: String(reason || '').slice(0, 200), total: Number(rec.total) || 0, lines: Array.isArray(rec.lines) ? rec.lines.length : 0 }); localStorage.setItem(CK, JSON.stringify(all.slice(0, 1000))); return true; } catch (_) { return false; }
          }
        };
      })();

      // #94: optional rounding of a pure CASH payment to a step (setting nova-rx-round-step in EGP: 0.25 / 0.5 / 1; default off). The invoice total stays exact;
      // the cash due is rounded half up and the difference is recorded as sale.rounding so the books and the drawer both reconcile. Never applied to card/credit/wallet/split.
      function cashRound(total) {
        let step = 0; try { step = parseFloat(localStorage.getItem('nova-rx-round-step')); } catch (_) {}
        const c = Math.round(total * 100), s = Math.round(step * 100);
        if (!(s > 0) || s > 500 || c <= 0) return { due: total, rounding: 0 };
        const d = Math.floor((c + s / 2) / s) * s;
        return d <= 0 ? { due: total, rounding: 0 } : { due: d / 100, rounding: (d - c) / 100 };
      }
      function dueForMethod(total, m) { return (m === "card" || m === "credit" || m === "split" || m === "wallet") ? { due: total, rounding: 0 } : cashRound(total); }
      window.novaRounding = { step() { try { return parseFloat(localStorage.getItem('nova-rx-round-step')) || 0; } catch (_) { return 0; } }, set(v) { try { const n = Number(v); if (!(n > 0)) localStorage.removeItem('nova-rx-round-step'); else if (n <= 5) localStorage.setItem('nova-rx-round-step', String(n)); else return false; return true; } catch (_) { return false; } }, cashRound };

      function currentTenderPlan(total) {
        const m = state.checkoutPaymentMethod, v = el => elements[el] ? elements[el].value : '';
        const inputs = m === "card" ? { card: total } : m === "credit" ? { credit: total }
          : m === "wallet" ? { alt: { method: (document.getElementById("inputWalletKind") || {}).value, amount: total, ref: (document.getElementById("inputWalletRef") || {}).value } }
          : m === "split" ? { cash: v("inputCashReceived"), card: document.getElementById("inputCardAmount").value, credit: document.getElementById("inputCreditAmount").value }
          : { cash: v("inputCashReceived") === "" ? NaN : v("inputCashReceived") };
        const R = dueForMethod(total, m);
        const tp = window.novaPay.plan(R.due, inputs, !!state.attachedCustomer);
        if (tp.ok) tp.rounding = R.rounding;
        if (tp.ok && m === "wallet") { // the same transaction number on another saved sale is almost always a double entry or reuse
          const w = tp.tenders.find(x => x.ref), k = state.invoiceKey;
          if (w && window.novaSales.list().some(s => s.id !== k && Array.isArray(s.tenders) && s.tenders.some(x => x.method === w.method && x.ref && x.ref.toLowerCase() === w.ref.toLowerCase()))) return { ok: false, error: 'ref-duplicate' };
        }
        return tp;
      }

      // CTRL-01 wiring: controlled drugs need patient/ID/doctor data BEFORE the sale is saved. The dialog is async, so it runs here,
      // outside the stock lock; the answer is kept per invoice key + lines so a retry after a failed save does not ask again.
      async function ensureControlledCapture() {
        const lines = state.invoiceLines || [];
        if (!lines.length) return true;
        try { if (window.novaLazy && window.novaLazy.load) await window.novaLazy.load(); } catch (_) { /* checked below */ }
        const NC = window.novaControlled;
        if (!NC || typeof NC.isControlled !== 'function') { // cannot tell which items are controlled: fail closed
          showToast(novaEn() ? 'Controlled-drug check is not available. Reload the page and try again.' : 'تعذر فحص الأدوية المراقبة. أعد تحميل الصفحة وحاول تاني.', 'error');
          return false;
        }
        const ctrl = lines.filter(l => NC.isControlled(l));
        if (!ctrl.length) { state.ctrlCapture = null; return true; }
        const saleId = state.invoiceKey || (state.invoiceKey = window.novaStock.newKey());
        const sig = saleId + '|' + ctrl.map(l => [window.novaStock.keyOf(l), l.qty, l.unit || ''].join(':')).join(',');
        if (state.ctrlCapture && state.ctrlCapture.sig === sig) return true;
        const entries = await NC.capture({ saleId, lines: ctrl });
        if (!entries || !entries.length) {
          showToast(novaEn() ? 'Sale not completed: controlled-drug details are required.' : 'البيع ما اتمّش: لازم بيانات الدواء المراقب.', 'error');
          return false;
        }
        state.ctrlCapture = { sig, entries };
        return true;
      }

      // #116 wiring: a credit (آجل) portion that would push the customer past the limit needs a manager. Runs outside the stock lock (async dialog);
      // the approval is kept per invoice key + customer + amount so a retry after a failed save does not ask again.
      async function ensureCreditApproval() {
        const cust = state.attachedCustomer;
        if (!cust || !cust.id || !(state.invoiceLines || []).length) return true;
        const saleId = state.invoiceKey || (state.invoiceKey = window.novaStock.newKey());
        if (window.novaSales.list().some(x => x.id === saleId)) return true; // already saved: nothing new is charged
        const { grandTotal } = recalculateFinancials();
        const tp = currentTenderPlan(grandTotal);
        if (!tp.ok || !(tp.credit > 0)) { state.creditApproval = null; return true; }
        try { if (window.novaLazy && window.novaLazy.load) await window.novaLazy.load(); } catch (_) { /* checked below */ }
        const CL = window.novaCreditLimit;
        if (!CL || typeof CL.check !== 'function') { if (!window.NovaCredit) return true; showToast(novaEn() ? 'Could not check the credit limit. Reload the page and try again.' : 'تعذر فحص حد الائتمان. أعد تحميل الصفحة وحاول تاني.', 'error'); return false; }
        const r = CL.check(cust.id, tp.credit);
        if (r.ok) { state.creditApproval = null; return true; }
        const sig = saleId + '|' + cust.id + '|' + tp.credit;
        if (state.creditApproval && state.creditApproval.sig === sig) return true;
        const en = novaEn(), fm = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2) + (en ? ' EGP' : ' ج.م');
        const msg = en
          ? 'This customer will exceed the credit limit.\nLimit: ' + fm(r.limit) + ' — current balance: ' + fm(r.balance) + ' — this sale on credit: ' + fm(tp.credit) + ' — balance after: ' + fm(r.after) + '.\nA manager must approve to continue.'
          : 'العميل هيعدّي حد الائتمان.\nالحد: ' + fm(r.limit) + ' — الرصيد الحالي: ' + fm(r.balance) + ' — الآجل في الفاتورة دي: ' + fm(tp.credit) + ' — الرصيد بعدها: ' + fm(r.after) + '.\nلازم موافقة مدير عشان تكمّل.';
        if (!(await saleApprovalReady())) { showToast(en ? 'Approval is not available. Reload the page and try again.' : 'الموافقة مش متاحة. أعد تحميل الصفحة وحاول تاني.', 'error'); return false; }
        const ap = await window.novaSaleApproval.request({ title: en ? 'Credit limit exceeded' : 'تعدّي حد الائتمان', message: msg, reason: 'credit-limit' });
        if (!ap) { showToast(en ? 'Sale not completed: credit limit exceeded.' : 'البيع ما اتمّش: العميل عدّى حد الائتمان.', 'error'); return false; }
        state.creditApproval = { sig, approvedBy: ap.approvedBy, approverId: ap.approverId, unverified: !!ap.unverified, at: ap.at };
        return true;
      }

      // The approval dialog (app/570) is a lazy screen: load it on demand before asking.
      async function saleApprovalReady() { if (!window.novaSaleApproval) { try { if (window.novaLazy && window.novaLazy.load) await window.novaLazy.load(); } catch (_) { /* checked below */ } } return !!window.novaSaleApproval; }

      // #100: a total discount above the limit (default 10% of the gross, setting nova-rx-discount-limit-pct) needs a manager unless a manager/owner is signed in.
      async function ensureDiscountApproval() {
        if (!salePolicy.needsManager() || !(state.invoiceLines || []).length) return true;
        const saleId = state.invoiceKey || (state.invoiceKey = window.novaStock.newKey());
        if (window.novaSales.list().some(x => x.id === saleId)) return true;
        const { manualDiscount: actualDiscount } = recalculateFinancials(); // offers/coupons are not manual: only manual discounts need approval
        const gross =Math.round(state.invoiceLines.reduce((s, l) => s + lineSegments(l).reduce((a, g) => a + (g.qty * g.price), 0), 0) * 100);
        const disc = Math.round((state.invoiceLines.reduce((s, l) => s + (Number(l.discount) || 0), 0) + (Number(actualDiscount) || 0)) * 100);
        const limit = salePolicy.discountLimitPct();
        if (gross <= 0 || disc <= 0 || disc * 100 <= gross * limit) { state.discountApproval = null; return true; }
        const sig = saleId + '|' + disc;
        if (state.discountApproval && state.discountApproval.sig === sig) return true;
        const en = novaEn(), pct = Math.round(disc * 1000 / gross) / 10;
        if (!(await saleApprovalReady())) { showToast(en ? 'Approval is not available. Reload the page and try again.' : 'الموافقة مش متاحة. أعد تحميل الصفحة وحاول تاني.', 'error'); return false; }
        const ap = await window.novaSaleApproval.request({ title: en ? 'Large discount' : 'خصم كبير', message: en ? 'The discount is ' + pct + '% (limit ' + limit + '%). A manager must approve to continue.' : 'الخصم ' + pct + '% (الحد ' + limit + '%). لازم موافقة مدير عشان تكمّل.' });
        if (!ap) { showToast(en ? 'Sale not completed: the discount needs approval.' : 'البيع ما اتمّش: الخصم محتاج موافقة.', 'error'); return false; }
        state.discountApproval = { sig, approvedBy: ap.approvedBy, approverId: ap.approverId, unverified: !!ap.unverified, at: ap.at, pct };
        return true;
      }

      function confirmPayment() {
        // SEC-01 / S1-07: no sale without a signed-in staff session whose role may sell (cashier, pharmacist, manager, owner).
        if (window.novaStaff && !window.novaStaff.allow('sale.create')) { if (!window.novaStaff.current()) window.novaStaff.check(); else showToast(novaEn() ? 'Your role cannot finalize a sale.' : 'دورك ما يسمحش بإتمام البيع.', 'error'); return; }
        // UX12: reject rapid clicks/Enter before the async stock lock is acquired.
        if (state.paymentSubmitting || !elements.checkoutModal.classList.contains('active') || elements.btnConfirmPayment.disabled) return;
        state.paymentSubmitting = true;
        const button = elements.btnConfirmPayment;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'جاري حفظ الفاتورة…';
        return Promise.resolve().then(ensureOffersReady).then(ok => ok ? ensureControlledCapture() : false).then(ok => ok ? ensureCreditApproval() : false).then(ok => ok ? ensureDiscountApproval() : false).then(ok => ok ? window.novaStock.withLock(confirmPaymentCore) : undefined).catch(() => {
          showToast(novaEn() ? 'Unable to confirm sale. Check saved invoices before retrying.' : 'تعذر تأكيد البيع. راجع الفواتير المحفوظة قبل المحاولة مرة أخرى.', 'error');
        }).finally(() => {
          state.paymentSubmitting = false;
          button.removeAttribute('aria-busy');
          button.textContent = 'تأكيد البيع (Enter)';
          if (elements.checkoutModal.classList.contains('active')) refreshChange();
        });
      }

      function confirmPaymentCore() {
        if (!elements.checkoutModal.classList.contains('active')) return;
        if (!state.attachedCustomer && !state.customerGateSkipped) { closeCheckout(); openCheckout(); return; }
        const { subtotal, actualDiscount, offerDiscount, offers, vatIncluded, grandTotal, totalQty } = recalculateFinancials();
        const usedCoupon = offers.coupon ? offers.coupon.code : '';
        if (state.coupon && !usedCoupon) { // coupon went invalid after Apply: never complete the sale at a silently higher total
          state.coupon = ''; offersChanged();
          showToast(novaEn() ? 'The coupon is no longer valid. Check the updated total and confirm again.' : 'الكوبون لم يعد صالحًا. راجع الإجمالي الجديد وأكد البيع مرة تانية.', 'error');
          return;
        }
        const tp = currentTenderPlan(grandTotal);
        if (!tp.ok) {
          showToast(tp.error === "ref-needed" ? (novaEn() ? "Type the transaction number." : "اكتب رقم العملية.") : tp.error === "ref-duplicate" ? (novaEn() ? "This transaction number was already used on another sale." : "رقم العملية ده مستخدم في فاتورة تانية.") : tp.error === "credit-needs-customer" ? "البيع الآجل يحتاج عميلاً مسجلاً." : tp.error === "over-allocated" ? "مبلغ البطاقة والآجل أكبر من الإجمالي." : "Enter a valid cash amount covering the total due.", "error");
          { const wr = document.getElementById('inputWalletRef'); if ((tp.error === 'ref-needed' || tp.error === 'ref-duplicate') && wr) wr.focus(); else elements.inputCashReceived.focus(); }
          return;
        }
        const cashRec = tp.received;

        const saleKey = state.invoiceKey || (state.invoiceKey = window.novaStock.newKey());
        if (!window.novaSales.list().some(x => x.id === saleKey)) { // a key already in the ledger is a duplicate commit: no second stock check, add() is a no-op
          const c = window.novaStock.check(saleKey, state.invoiceLines);
          if (!c.ok) { window.novaStock.release(saleKey); closeCheckout(); renderInvoice(); showToast(c.recalled ? "ممنوع: تشغيلة مسحوبة (Recall): " + c.name : c.expired ? "ممنوع بيع صنف منتهي الصلاحية: " + c.name + " — المتاح الصالح " + c.available : c.error ? "تحويل الوحدة غير متاح: " + (c.name || "") : "المخزون لا يكفي: " + c.name + " — المتاح " + c.available, "error"); return; }
        }
        // POS-02: mock card is charged once per invoice key; a retry after a failed save reuses the authorisation. A decline saves nothing.
        if (tp.cardAmount > 0) {
          const cc = window.novaPay.chargeCard(saleKey, tp.cardAmount);
          if (!cc.ok) { showToast(cc.error === "declined" ? "تم رفض البطاقة — لم يتم حفظ الفاتورة." : "تعذر تنفيذ الدفع بالبطاقة.", "error"); return; }
        }
        if (window.novaPay.numberTaken(activeSaleNumber)) { activeSaleNumber = nextSaleNumber(); renderSaleNumber(); }
        const invNumber = activeSaleNumber;
        const now = new Date();
        const dateStr = window.NovaFmt.formatDateTime(now);

        const saleRecord = {
          id: saleKey,
          number: String(invNumber), at: now.toISOString(),
          ...(() => { try { const me = window.novaAuth && window.novaAuth.current && window.novaAuth.current(); return me && me.id ? { cashierId: me.id, cashier: me.name } : {}; } catch (_) { return {}; } })(), // #90: who sold it (staff KPIs, payroll commission)
          customer: state.attachedCustomer ? state.attachedCustomer.name : '',
          phone: state.attachedCustomer ? state.attachedCustomer.phone : '',
          payment: tp.payment, status: 'final', tenders: tp.tenders, credit: tp.credit, collected: tp.collected, customerId: state.attachedCustomer ? state.attachedCustomer.id : undefined,
          ...(tp.credit > 0 && state.creditApproval ? { creditApproval: { approvedBy: state.creditApproval.approvedBy, approverId: state.creditApproval.approverId, unverified: state.creditApproval.unverified, at: state.creditApproval.at } } : {}),
          ...(tp.rounding ? { rounding: tp.rounding } : {}),
          ...(offerDiscount > 0 ? { offers: { discount: offerDiscount, items: offers.lines.map((o, i) => o ? { name: state.invoiceLines[i].name, offer: o.name, discount: o.discount } : null).filter(Boolean), ...(usedCoupon ? { coupon: { code: usedCoupon, discount: offers.coupon.discount } } : {}) } } : {}),
          ...(state.discountApproval ? { discountApproval: { approvedBy: state.discountApproval.approvedBy, approverId: state.discountApproval.approverId, unverified: state.discountApproval.unverified, at: state.discountApproval.at, pct: state.discountApproval.pct } } : {}),
          ...(tp.cardAmount > 0 ? { cardAuth: window.novaPay.cardAuth(saleKey).id } : {}),
          lines: state.invoiceLines.flatMap(l => {
            const segs = lineSegments(l);
            const totalDiscCents = Math.round((Number(l.discount) || 0) * 100);
            const totalVal = segs.reduce((s, g) => s + (g.qty * g.price), 0);
            let remCents = totalDiscCents;
            return segs.map((seg, i) => {
              let segDiscCents;
              if (segs.length === 1) {
                segDiscCents = totalDiscCents;
              } else if (i === segs.length - 1) {
                segDiscCents = remCents;
              } else {
                segDiscCents = Math.max(0, Math.min(remCents, totalVal > 0 ? Math.round(totalDiscCents * ((seg.qty * seg.price) / totalVal)) : 0));
                remCents -= segDiscCents;
              }
              const lots = seg.lots;
              return {
                name: l.name, barcode: l.barcode || '', unit: l.unit || 'box', unitFactor: Number(l.unitFactor) || 1, price: seg.price, qty: seg.qty, discount: segs.length === 1 ? (Number(l.discount) || 0) : segDiscCents / 100,
                ...(lots && lots.length ? { lot: lots[0].lot, expiry: lots[0].expiry, lots } : {})
              };
            });
          }),
          subtotal, discount: actualDiscount, vat: vatIncluded, vatRate: window.novaVat.get(), total: grandTotal, received: cashRec, change: tp.change,
          source: window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' ? 'STOCK LIVE' : 'DEMO'
        };
        // U1: keep a local record of every completed sale (this device only; not a server ledger).
        const savedOk = window.novaSales.add(saleRecord);
        if (savedOk) { try { localStorage.setItem("nova-rx-hint-done", "1"); } catch (e) {} }
        if (!savedOk) { // atomic: nothing is cleared; a retry reuses the same card authorisation and invoice key, so the customer is never charged twice
          showToast("تعذر حفظ الفاتورة على هذا الجهاز — أعد المحاولة، لن يتم خصم البطاقة مرة أخرى.", "error");
          return;
        }
        try { if (state.ctrlCapture && window.novaControlled) window.novaControlled.record(state.ctrlCapture.entries); } catch (e) { console.warn('controlled record', e); }
        try { if (usedCoupon && window.novaOffers) window.novaOffers.commit(saleKey, usedCoupon); } catch (e) { console.warn('coupon commit', e); }
        state.coupon = '';
        if (state.discountApproval) salePolicy.log('discount', state.discountApproval, { sale: saleKey, pct: state.discountApproval.pct });
        if (saleRecord.creditApproval) salePolicy.log('credit-limit', saleRecord.creditApproval, { sale: saleKey, credit: tp.credit });
        state.ctrlCapture = null; state.creditApproval = null; state.discountApproval = null;
        try { if (tp.credit > 0 && saleRecord.customerId && window.NovaCredit) window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').charge({ id: saleKey, customerId: String(saleRecord.customerId), amount: Math.round(tp.credit * 100) / 100, override: true }); } catch (e) { console.warn('credit ledger', e && e.code); }
        window.novaPay.captureCard(saleKey); window.novaStock.release(saleKey); state.invoiceKey = null;
        try{window.dispatchEvent(new CustomEvent('nova:invoice-completed',{detail:{id:String(invNumber),customer:state.attachedCustomer?.name||'عميل نقدي',items:state.invoiceLines.map(x=>({name:x.name,qty:x.qty}))}}))}catch(e){}
        closeCheckout();
        window.novaReceipt.open(saleRecord, { copy: false, fromCheckout: true });

        // Clear invoice and reset for next transaction
        state.invoiceLines = [];
        state.percentDiscount = 0;
        state.fixedDiscount = 0;
        elements.inputPercentDiscount.value = "";
        elements.inputFixedDiscount.value = "";
        activeSaleNumber = nextSaleNumber();
        renderSaleNumber();
        detachCustomer();
        state.customerGateSkipped = true;
        state.customerGatePending = false;
        renderInvoice();
        elements.btnReceiptNewSale.focus();
        showToast("Payment confirmed & Invoice completed!");
      }

      function startNewSale(alreadySaved = false) {
        if (alreadySaved === true || state.invoiceLines.length === 0) {
          if (state.invoiceLines.length > 0) clearInvoice(true);
          finalizeNewSale();
          return;
        }
        const en = novaEn();
        openInvoiceActionDialog({
          title: en ? "This invoice has items" : "الفاتورة دي فيها أصناف",
          message: en ? "Hold it or clear it before starting a new sale?" : "تعلّقها ولا تمسحها قبل ما تبدأ فاتورة جديدة؟",
          actions: [
            { id: "hold", label: en ? "Hold & start new" : "علّق وابدأ جديدة", variant: "primary", onSelect: () => holdCurrentInvoice() },
            { id: "clear", label: en ? "Clear & start new" : "امسحها وابدأ جديدة", variant: "danger", onSelect: () => { executeClearInvoice(); finalizeNewSale(); } },
            { id: "cancel", label: en ? "Back" : "رجوع", variant: "secondary" }
          ]
        });
      }
      function finalizeNewSale() {
        document.getElementById("novaLabelsPanel")?.classList.remove("open");
        elements.receiptModal.classList.remove("active");
        // AUDIT-01: take a new number only when the current one is used (saved, cancelled or held). Checkout already moved to the
        // next number, so advancing again here skipped one number per sale (S-000001, S-000003, S-000005 …).
        if (!activeSaleNumber || window.novaPay.numberTaken(activeSaleNumber) || heldTaken(activeSaleNumber)) activeSaleNumber = nextSaleNumber();
        renderSaleNumber();
        detachCustomer();
        state.customerGateSkipped = true;
        state.customerGatePending = false;
        setSearchMode("CUSTOMER");
        showToast(novaEn() ? "New sale ready." : "الفاتورة الجديدة جاهزة.");
      }

      // POS-05 (this device only): Arabic PDF receipt, 58mm/80mm thermal layouts with SVG barcode, printer disconnect/reconnect handling, reprint with copy mark, and mock Bluetooth/HID barcode scanner.
      window.novaReceipt = (function () {
        const WK = 'nova-rx-receipt-width-v1', PK = 'nova-rx-printer-connected-v1', RK = 'nova-rx-reprints-v1';
        let currentSale = null, currentCopy = false, currentCopyNo = 0, fromCheckout = false, pendingJob = null;
        const CODE39 = { '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn','A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn','K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn','P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn','U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','*':'nwnnwnwnn' };
        function barcodeSvg(val) {
          const clean = String(val || '000000').toUpperCase().replace(/[^0-9A-Z\-. ]/g, '') || '000000';
          const full = '*' + clean + '*';
          let x = 4; const bars = [];
          for (let i = 0; i < full.length; i++) {
            const p = CODE39[full[i]] || CODE39['0'];
            for (let j = 0; j < 9; j++) {
              const w = p[j] === 'w' ? 3 : 1;
              if (j % 2 === 0) bars.push(`<rect x="${x}" y="2" width="${w}" height="34" fill="#000"/>`);
              x += w;
            }
            x += 1;
          }
          return `<svg class="receipt-barcode-svg" data-barcode-value="${escH(clean)}" viewBox="0 0 ${x + 4} 38" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Barcode ${escH(clean)}">${bars.join('')}</svg><div dir="ltr" style="font-family:monospace;font-size:12px;letter-spacing:2px;color:#000">${escH(clean)}</div>`;
        }
        function getWidth() { try { return localStorage.getItem(WK) === '58mm' ? '58mm' : '80mm'; } catch (_) { return '80mm'; } }
        function setWidth(w) {
          const v = w === '58mm' ? '58mm' : '80mm';
          try { localStorage.setItem(WK, v); } catch (_) {}
          if (elements.receiptSlipContent) elements.receiptSlipContent.setAttribute('data-width', v);
          document.querySelectorAll('[data-receipt-width]').forEach(b => b.classList.toggle('active', b.getAttribute('data-receipt-width') === v));
          if (currentSale) render();
          return v;
        }
        // Single source of truth: 'connected' | 'disconnected' | 'unknown' (no printer state yet: browser print)
        function printerState() { try { const v = localStorage.getItem(PK); return v === '1' ? 'connected' : v === '0' ? 'disconnected' : 'unknown'; } catch (_) { return 'unknown'; } }
        function applyPrinterState() {
          const st = printerState();
          const en = localStorage.getItem('nova-rx-language') === 'en';
          const btn = document.getElementById('btnPrinterStatus'), al = document.getElementById('receiptPrinterAlert'), msg = document.getElementById('receiptPrinterAlertMsg');
          if (btn) {
            btn.setAttribute('data-connected', st === 'disconnected' ? 'false' : 'true');
            btn.setAttribute('data-printer-state', st);
            btn.textContent = st === 'connected' ? (en ? 'Printer Ready' : 'الطابعة متصلة') : st === 'disconnected' ? (en ? 'Printer Offline' : 'الطابعة غير متصلة') : (en ? 'Printer: browser print' : 'الطابعة غير معروفة');
          }
          if (msg) msg.textContent = en ? 'Check power/cable and retry' : 'تحقق من التوصيل أو البلوتوث ثم أعد المحاولة';
          if (al) al.hidden = st !== 'disconnected';
          return st;
        }
        function isPrinterConnected() { return printerState() !== 'disconnected'; }
        function setPrinterConnected(flag) {
          const ok = !!flag;
          try { localStorage.setItem(PK, ok ? '1' : '0'); } catch (_) {}
          applyPrinterState();
          return ok;
        }
        function reprintsMap() { try { const o = JSON.parse(localStorage.getItem(RK) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
        function bumpReprint(num) {
          const m = reprintsMap(), n = (Number(m[num]) || 0) + 1;
          m[num] = n;
          try { localStorage.setItem(RK, JSON.stringify(m)); } catch (_) {}
          return n;
        }
        function reprintCount(num) { return Number(reprintsMap()[num]) || 0; }
        function payLabel(m) { return window.NovaFmt.payLabel(m); }
        function render() {
          if (!currentSale || !elements.receiptSlipContent) return '';
          const s = currentSale, w = getWidth(), dt = new Date(s.at || Date.now());
          const dateStr = window.NovaFmt.formatDateTime(dt);
          const copyBanner = currentCopy ? `<div class="nova-receipt-copy" data-receipt-copy="true">نسخة مكررة — COPY${currentCopyNo > 1 ? ' #' + currentCopyNo : ''}</div>` : '';
          const rowsHtml = (s.lines || []).map(l => {
            const tot = ((Number(l.price) || 0) * (Number(l.qty) || 0)) - (Number(l.discount) || 0);
            return `<tr><td>${escH(dispName(l.name))}</td><td dir="ltr">${Number(l.qty) || 0}</td><td dir="ltr">${(Number(l.price) || 0).toFixed(2)}</td><td dir="ltr">${tot.toFixed(2)}</td></tr>`;
          }).join('');
          const tendersTxt = Array.isArray(s.tenders) && s.tenders.length ? s.tenders.map(t => `${window.NovaFmt.payLabel(t.method)} ${(Number(t.amount) || 0).toFixed(2)}${t.ref ? ' #' + t.ref : ''}`).join(' + ') : '';
          const html = `<div dir="rtl" lang="ar" class="nova-receipt-doc" data-receipt-number="${escH(s.number)}" data-is-copy="${currentCopy ? 'true' : 'false'}" style="color:#000">
            ${copyBanner}
            <div style="text-align:center;border-bottom:1px dashed #94a3b8;padding-bottom:6px;margin-bottom:6px">
              <div style="font-weight:800;font-size:14px">صيدلية السوسي — NOVA Rx</div>
              <div style="font-size:12px">إيصال بيع ضريبي مبسط (${w})</div>
            </div>
            <div style="font-size:12px;margin-bottom:6px">
              <div><strong>رقم الفاتورة:</strong> <span dir="ltr">${escH(s.number)}</span></div>
              <div><strong>التاريخ:</strong> <span dir="ltr">${escH(dateStr)}</span></div>
              <div><strong>العميل:</strong> ${escH(s.customer || 'عميل نقدي')}</div>
              ${s.phone ? `<div><strong>الهاتف:</strong> <span dir="ltr">${escH(s.phone)}</span></div>` : ''}
            </div>
            <table class="nova-receipt-table">
              <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <div style="font-size:12px;border-top:1px dashed #94a3b8;padding-top:6px">
              <div style="display:flex;justify-content:space-between"><span>المجموع الفرعي (${window.NovaFmt.pluralItems((s.lines || []).length)}):</span><span dir="ltr">${(Number(s.subtotal) || 0).toFixed(2)} ج.م</span></div>
              ${(Number(s.rounding) || 0) !== 0 ? `<div style="display:flex;justify-content:space-between"><span>تقريب:</span><span dir="ltr">${(Number(s.rounding) || 0) > 0 ? '+' : ''}${(Number(s.rounding) || 0).toFixed(2)} ج.م</span></div>` : ''}
              ${(Number(s.discount) || 0) > 0 ? `<div style="display:flex;justify-content:space-between"><span>الخصم:</span><span dir="ltr">-${(Number(s.discount) || 0).toFixed(2)} ج.م</span></div>` : ''}
              <div style="display:flex;justify-content:space-between"><span>ضريبة القيمة المضافة (${window.novaVat.label(Number(s.vatRate) >= 0 && s.vatRate != null ? Number(s.vatRate) : undefined)}%):</span><span dir="ltr">${(Number(s.vat) || 0).toFixed(2)} ج.م</span></div>
              <div style="display:flex;justify-content:space-between;font-weight:800;font-size:13px;margin-top:2px"><span>الإجمالي المستحق:</span><span dir="ltr">${(Number(s.total) || 0).toFixed(2)} ج.م</span></div>
              <div style="display:flex;justify-content:space-between"><span>طريقة الدفع:</span><span>${escH(payLabel(s.payment))}${tendersTxt && (s.tenders.length > 1 || s.tenders.some(t => t.ref)) ?' (' + escH(tendersTxt) + ')' : ''}</span></div>
              <div style="display:flex;justify-content:space-between"><span>المدفوع نقدًا:</span><span dir="ltr">${(Number(s.received) || 0).toFixed(2)} ج.م</span></div>
              <div style="display:flex;justify-content:space-between"><span>الباقي:</span><span dir="ltr">${(Number(s.change) || 0).toFixed(2)} ج.م</span></div>
            </div>
            <div class="nova-receipt-barcode">${barcodeSvg(s.number)}</div>
          </div>`;
          elements.receiptSlipContent.setAttribute('data-width', w);
          elements.receiptSlipContent.innerHTML = html;
          return html;
        }
        function buildPdfBytes(sale, opts) {
          const s = sale || currentSale || { number: 'S-000000', total: 0, lines: [] };
          const isCopy = !!(opts && opts.copy !== undefined ? opts.copy : currentCopy);
          const copyNo = (opts && opts.copyNo) || currentCopyNo || 1;
          const enc = new TextEncoder();
          const u16Hex = str => '<FEFF' + Array.from(String(str || '')).map(ch => ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('') + '>';
          const ascii = str => '(' + String(str || '').replace(/[()\\]/g, '\\$&').replace(/[^\x20-\x7E]/g, '?') + ')';
          const lines = [
            isCopy ? `نسخة مكررة — COPY #${copyNo}` : 'نسخة أصلية — ORIGINAL',
            'صيدلية السوسي — NOVA Rx Pharmacy',
            `رقم الفاتورة / Invoice: ${s.number}`,
            `التاريخ / Date: ${s.at || new Date().toISOString()}`,
            `العميل / Customer: ${s.customer || 'عميل نقدي'}`,
            `طريقة الدفع / Payment: ${s.payment || 'cash'}`,
            ...(s.lines || []).map((l, i) => `${i + 1}. ${l.name} x${l.qty} @ ${(Number(l.price) || 0).toFixed(2)} = ${(((Number(l.price) || 0) * (Number(l.qty) || 0)) - (Number(l.discount) || 0)).toFixed(2)} ج.م`),
            `المجموع الفرعي / Subtotal: ${(Number(s.subtotal) || 0).toFixed(2)} ج.م`,
            ...((Number(s.discount) || 0) > 0 ? [`الخصم / Discount: -${(Number(s.discount) || 0).toFixed(2)} ج.م`] : []),
            `الضريبة / VAT (${window.novaVat.label(Number(s.vatRate) >= 0 && s.vatRate != null ? Number(s.vatRate) : undefined)}%): ${(Number(s.vat) || 0).toFixed(2)} ج.م`,
            `الإجمالي النهائي / NET TOTAL: ${(Number(s.total) || 0).toFixed(2)} ج.م`,
            `الباركود / Barcode: *${s.number}*`
          ];
          let y = 780;
          const ops = ['BT', '/F1 11 Tf'];
          lines.forEach(ln => {
            ops.push(`1 0 0 1 40 ${y} Tm ${ascii(ln)} Tj`);
            ops.push(`1 0 0 1 320 ${y} Tm ${u16Hex(ln)} Tj`);
            y -= 20;
          });
          ops.push('ET');
          const stream = ops.join('\n') + '\n';
          const streamLen = enc.encode(stream).length;
          const objs = [
            `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Lang (ar-EG) >>\nendobj\n`,
            `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
            `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
            `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
            `5 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}endstream\nendobj\n`
          ];
          let pdf = '%PDF-1.4\n';
          const offsets = [0];
          objs.forEach(o => { offsets.push(enc.encode(pdf).length); pdf += o; });
          const xrefPos = enc.encode(pdf).length;
          pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
          for (let i = 1; i <= objs.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
          pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Title ${u16Hex('إيصال فاتورة ' + s.number + (isCopy ? ' نسخة' : ''))} >> >>\nstartxref\n${xrefPos}\n%%EOF\n`;
          return { bytes: enc.encode(pdf), text: pdf, lines, filename: `receipt-${s.number}${isCopy ? '-copy' : ''}.pdf` };
        }
        function exportPdf(sale, opts) {
          const out = buildPdfBytes(sale, opts);
          const blob = new Blob([out.bytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = out.filename;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          return out;
        }
        function open(sale, opts = {}) {
          currentSale = sale;
          fromCheckout = !!opts.fromCheckout;
          currentCopy = !!opts.copy;
          currentCopyNo = currentCopy ? (opts.copyNo || bumpReprint(sale.number)) : 0;
          setWidth(getWidth());
          applyPrinterState();
          render();
          elements.receiptModal.classList.add('active');
          return { sale: currentSale, copy: currentCopy, copyNo: currentCopyNo, width: getWidth() };
        }
        function printNow(opts = {}) {
          if (opts.copy && currentSale && !currentCopy) {
            currentCopy = true;
            currentCopyNo = bumpReprint(currentSale.number);
            render();
          } else if (opts.copy && currentSale && currentCopy && opts.bump !== false) {
            currentCopyNo = bumpReprint(currentSale.number);
            render();
          }
          if (!isPrinterConnected()) {
            pendingJob = { sale: currentSale, copy: currentCopy, copyNo: currentCopyNo, width: getWidth() };
            const en = localStorage.getItem('nova-rx-language') === 'en';
            applyPrinterState();
            showToast(en ? 'Printer disconnected. Receipt saved for retry.' : 'انقطع اتصال الطابعة — الإيصال محفوظ لإعادة الطباعة.', 'error');
            return { ok: false, error: 'printer-disconnected', queued: pendingJob };
          }
          applyPrinterState();
          pendingJob = null;
          if (window.novaDevicePrint && window.novaDevicePrint.hasGateway() && currentSale) { window.novaDevicePrint.printInvoice(currentSale, currentCopy ? currentCopyNo : 0).then(function (r) { if (!r.ok) showToast(r.message_ar, 'error'); }); } else { try { window.print(); } catch (_) {} } // S3-01: device gateway when configured, else the browser print
          return { ok: true, saleNumber: currentSale && currentSale.number, copy: currentCopy, copyNo: currentCopyNo, width: getWidth() };
        }
        function reconnectAndRetry() {
          setPrinterConnected(true);
          return printNow({ copy: currentCopy, bump: false });
        }
        function reopenSale(saleOrId, opts = {}) {
          const s = typeof saleOrId === 'object' && saleOrId ? saleOrId : window.novaSales.list().find(x => x.id === saleOrId || x.number === saleOrId);
          if (!s) return { ok: false, error: 'not-found' };
          return { ok: true, ...open(s, { copy: opts.copy !== false, fromCheckout: false }) };
        }
        return {
          open, reopenSale, render, getWidth, setWidth,
          isPrinterConnected, setPrinterConnected,
          print: () => printNow({ copy: false }),
          reprint: () => printNow({ copy: true }),
          reconnectAndRetry, reprintCount,
          buildPdf: buildPdfBytes, exportPdf, barcodeSvg,
          current: () => currentSale ? { sale: currentSale, copy: currentCopy, copyNo: currentCopyNo, width: getWidth(), fromCheckout } : null
        };
      })();

      // POS-05 mock Bluetooth / HID barcode scanner: simulates wireless burst scans or direct scan events from any focus state on tablet/desktop.
      window.novaScanner = (function () {
        let connected = true, deviceName = 'NOVA-BT-Scanner';
        function scan(code) {
          const raw = String(code || '').trim();
          if (!connected) {
            showToast(localStorage.getItem('nova-rx-language') === 'en' ? 'Bluetooth scanner disconnected.' : 'قارئ الباركود البلوتوث غير متصل.', 'error');
            return { ok: false, error: 'scanner-disconnected' };
          }
          if (!raw) return { ok: false, error: 'empty' };
          const prod = findExactBarcodeProduct(raw);
          if (!prod) {
            showToast((localStorage.getItem('nova-rx-language') === 'en' ? 'No product for barcode: ' : 'لا يوجد صنف بهذا الباركود: ') + escH(raw), 'error');
            return { ok: false, error: 'not-found', barcode: raw };
          }
          if (state.mode !== 'PRODUCT') setSearchMode('PRODUCT');
          addProductToInvoice(prod);
          elements.mainSearchInput.value = '';
          closeSuggestions();
          return { ok: true, product: { id: prod.id, name: prod.name, barcode: prod.barcode, price: prod.price }, lines: state.invoiceLines.length };
        }
        return {
          scan,
          isConnected: () => connected,
          setConnected: flag => { connected = !!flag; return connected; },
          device: () => ({ name: deviceName, connected })
        };
      })();
      const HELD_KEY = 'nova-rx-held-invoices-v1';
      const SALE_SEQ_KEY = 'nova-rx-sale-sequence-v1';
      let saleSequence = Number(localStorage.getItem(SALE_SEQ_KEY)) || 0;
      function heldTaken(n) { try { return heldInvoices.some(h => h.saleNumber === n); } catch (_) { return false; } } // heldInvoices is declared below; the first call happens before that
      function nextSaleNumber() {
        // POS-02: never reuse a number already in the ledger, held or cancelled lists (another tab may have advanced the sequence).
        let n;
        do {
          saleSequence = Math.max(saleSequence, Number(localStorage.getItem(SALE_SEQ_KEY)) || 0) + 1;
          try { localStorage.setItem(SALE_SEQ_KEY, String(saleSequence)); } catch (_) {}
          n = 'S-' + String(saleSequence).padStart(6, '0');
        } while (window.novaPay.numberTaken(n) || heldTaken(n));
        return n;
      }
      let activeSaleNumber = nextSaleNumber();
      function renderSaleNumber() {
        const el = document.getElementById('activeSaleNumber');
        if (el) el.textContent = activeSaleNumber;
      }
      renderSaleNumber();
      (function () {
        const el = document.getElementById('activeSaleNumber');
        if (!el) return;
        const copy = () => { const t = activeSaleNumber; try { navigator.clipboard.writeText(t).catch(() => {}); } catch (_) {} el.setAttribute('data-copied', '1'); setTimeout(() => el.removeAttribute('data-copied'), 1200); };
        el.addEventListener('click', copy);
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(); } });
      })();
      let heldInvoices = [];
      try { const saved = JSON.parse(localStorage.getItem(HELD_KEY) || '[]'); if (Array.isArray(saved)) heldInvoices = saved.filter(x => x && Array.isArray(x.lines)).slice(0, 50); } catch (_) {}
      const heldPanel = document.getElementById('heldInvoicePanel');
      const heldList = document.getElementById('heldInvoiceList');
      const heldCount = document.getElementById('heldInvoiceCount');
      const heldEscape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      function saveHeldInvoices(next) {
        try { localStorage.setItem(HELD_KEY, JSON.stringify(next)); heldInvoices = next; renderHeldInvoices(); return true; }
        catch (_) { showToast('Unable to save held invoices on this device.', 'error'); return false; }
      }
      function renderHeldInvoices() {
        heldCount.textContent = heldInvoices.length;
        heldList.innerHTML = heldInvoices.length ? heldInvoices.map(x => `<div class="nova-held-row"><div class="nova-held-meta"><strong>${heldEscape(x.saleNumber || x.id)} · ${heldEscape(x.customerName || 'عميل نقدي')}</strong><small>${heldEscape(new Date(x.created).toLocaleString())} · ${x.lines.length} items</small></div><div class="nova-held-row-actions"><button type="button" data-held-resume="${heldEscape(x.id)}">Resume</button><button type="button" class="nova-held-delete" data-held-delete="${heldEscape(x.id)}">Delete</button></div></div>`).join('') : '<div style="text-align:center;color:#a9b9c6;padding:18px 6px;font-size:12px">' + (novaEn() ? 'No held invoices' : 'لا توجد فواتير معلقة') + '</div>';
      }
      function holdCurrentInvoice() {
        if (!state.invoiceLines.length) { showToast('Add products before holding an invoice.'); return; }
        if (heldInvoices.length >= 50) { showToast('Held invoice limit reached (50).', 'error'); return; }
        const record = {id: String(Date.now()) + '-' + Math.random().toString(36).slice(2,8), saleNumber:activeSaleNumber, created: new Date().toISOString(), customerName: state.attachedCustomer?.name || '', customerId: state.attachedCustomer?.id ?? null, lines: JSON.parse(JSON.stringify(state.invoiceLines)), percentDiscount:state.percentDiscount, fixedDiscount:state.fixedDiscount, customerGateSkipped:state.customerGateSkipped};
        if (!saveHeldInvoices([record, ...heldInvoices])) return;
        startNewSale(true); heldPanel.hidden = true; showToast('Invoice held on this device.');
      }
      document.getElementById('btnHeldInvoices').addEventListener('click', () => { heldPanel.hidden = !heldPanel.hidden; renderHeldInvoices(); });
      document.getElementById('closeHeldInvoices').addEventListener('click', () => { heldPanel.hidden = true; elements.mainSearchInput.focus(); });
      document.getElementById('holdCurrentInvoice').addEventListener('click', holdCurrentInvoice);
      heldList.addEventListener('click', e => {
        const resume = e.target.closest('[data-held-resume]'); const del = e.target.closest('[data-held-delete]');
        if (!resume && !del) return;
        const id = (resume || del).getAttribute(resume ? 'data-held-resume' : 'data-held-delete');
        const record = heldInvoices.find(x => x.id === id); if (!record) return;
        if (del) {
          const before = heldInvoices.slice();
          if (!saveHeldInvoices(heldInvoices.filter(x => x.id !== id))) return;
          showUndoToast('تم حذف الفاتورة المعلقة',
            () => { const have = heldInvoices.filter(x => x.id !== id); const idx = Math.min(before.findIndex(x => x.id === id), have.length); have.splice(idx, 0, record); saveHeldInvoices(have); },
            () => { window.novaPay.cancel(record, 'parked-deleted'); });
          return;
        }
        if (state.invoiceLines.length && !confirm('Replace the current invoice? Unsaved items will be lost.')) return;
        // Keep held record until the active invoice is restored successfully.
        activeSaleNumber = record.saleNumber || record.id;
        renderSaleNumber();
        state.invoiceLines = JSON.parse(JSON.stringify(record.lines));
        state.percentDiscount = Number(record.percentDiscount) || 0;
        state.fixedDiscount = Number(record.fixedDiscount) || 0;
        state.customerGateSkipped = true;
        state.customerGatePending = false;
        elements.inputPercentDiscount.value = state.percentDiscount || '';
        elements.inputFixedDiscount.value = state.fixedDiscount || '';
        const customer = record.customerId != null ? DEMO_CUSTOMERS.find(c => String(c.id) === String(record.customerId)) : null;
        if (customer) attachCustomer(customer); else detachCustomer();
        setSearchMode('PRODUCT'); renderInvoice();
        saveHeldInvoices(heldInvoices.filter(x => x.id !== id)); heldPanel.hidden = true;
        showToast('Held invoice restored.');
      });
      document.addEventListener('click', e => { if (!heldPanel.hidden && !e.target.closest('#heldInvoicePanel,#btnHeldInvoices')) heldPanel.hidden = true; });
      document.addEventListener('keydown', e => {if(e.key === 'Escape') heldPanel.hidden = true});
      renderHeldInvoices();

      // --- ATTACH EVENT LISTENERS ---
      function initEventListeners() {
        // Search Input
        elements.mainSearchInput.addEventListener("input", handleSearchInput);
        elements.mainSearchInput.addEventListener("keydown", handleSearchKeyDown);

        // Click on Autocomplete Suggestion
        elements.suggestionsBox.addEventListener("mousedown", e => {
          if (e.target.closest(".suggestion-item, #novaShortageBtn, #novaCustRegBtn")) e.preventDefault();
        });
        elements.suggestionsBox.addEventListener("click", e => {
          if (e.target.closest("#novaCustRegBtn")) { openQuickRegister(state.searchQuery); return; }
          if (e.target.closest("#novaShortageBtn")) {
            const n = window.novaShortages.add(state.searchQuery, 1);
            if (n) showToast("تم تسجيل النقص: " + state.searchQuery + (n > 1 ? " (" + n + " مرات)" : ""));
            else showToast("تعذر حفظ النقص على هذا الجهاز", "error");
            return;
          }
          const item = e.target.closest(".suggestion-item");
          if (!item) return;
          const idx = parseInt(item.getAttribute("data-idx"), 10);
          const selected = state.suggestions[idx];
          if (!selected) return;

          if (elements.suggestionsBox.dataset.mode === "CUSTOMER") {
            attachCustomer(selected);
            setSearchMode("PRODUCT");
          } else {
            if (state.mode === "CUSTOMER") setSearchMode("PRODUCT");
            addProductToInvoice(selected);
            elements.mainSearchInput.value = "";
            closeSuggestions();
            elements.mainSearchInput.focus();
          }
        });

        // Top Actions
        elements.btnNewSale.addEventListener("click", startNewSale);
        
        elements.btnAddLoyalty.addEventListener("click", () => {
          setSearchMode("CUSTOMER");
          showToast("Customer search active. Existing line items remain intact.");
        });

        elements.btnAttachLoyalty.addEventListener("click", () => {
          setSearchMode("CUSTOMER");
        });

        elements.btnClearInvoice.addEventListener("click", clearInvoice);

        (function () {
          const chip = document.getElementById("novaHelpChip"), hint = document.getElementById("novaFirstRunHint"), hide = document.getElementById("novaHintHide");
          let done = false; try { done = localStorage.getItem("nova-rx-hint-done") === "1"; } catch (e) {}
          if (hint && !done) hint.hidden = false;
          if (hide) hide.addEventListener("click", () => { hint.hidden = true; try { localStorage.setItem("nova-rx-hint-done", "1"); } catch (e) {} });
          if (chip) chip.addEventListener("click", () => { elements.helpModal.classList.add("active"); elements.btnCloseHelp.focus(); });
        })();

        elements.btnHelpShortcuts.addEventListener("click", () => {
          elements.helpModal.classList.add("active");
          elements.btnCloseHelp.focus();
        });

        elements.btnCloseHelp.addEventListener("click", () => { elements.helpModal.classList.remove("active"); elements.mainSearchInput.focus(); });
        elements.btnDismissHelp.addEventListener("click", () => { elements.helpModal.classList.remove("active"); elements.mainSearchInput.focus(); });

        // Table Delegations (Qty and Delete)
        elements.invoiceTableBody.addEventListener("mousedown", e => {
          if (e.target.closest("button")) e.preventDefault();
        });
        elements.invoiceTableBody.addEventListener("click", e => {
          const btn = e.target.closest("button");
          if (!btn) return;
          const act = btn.getAttribute("data-act");
          const prodId = btn.getAttribute("data-id");
          const line = state.invoiceLines.find(l => l.productId === prodId);
          if (!line) return;

          if (act === "inc") {
            updateLineQty(prodId, line.qty + 1);
          } else if (act === "dec") {
            updateLineQty(prodId, line.qty - 1);
          } else if (act === "fixstock") {
            clampLineToStock(prodId);
          } else if (act === "del") {
            removeLine(prodId);
          }
          elements.mainSearchInput.focus();
        });

        elements.invoiceTableBody.addEventListener("focusin", e => {
          if (e.target.classList.contains("qty-input")) e.target.select?.();
        });

        elements.invoiceTableBody.addEventListener("keydown", e => {
          if (e.target.classList.contains("qty-input")) {
            if (e.key === "Enter") {
              e.preventDefault();
              updateLineQty(e.target.getAttribute("data-id"), e.target.value);
              elements.mainSearchInput.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              renderInvoice();
              elements.mainSearchInput.focus();
            }
          } else if (e.target.classList.contains("unit-select") && e.key === "Escape") {
            e.preventDefault();
            elements.mainSearchInput.focus();
          }
        });

        elements.invoiceTableBody.addEventListener("change", e => {
          if (e.target.classList.contains("qty-input")) {
            const prodId = e.target.getAttribute("data-id");
            updateLineQty(prodId, e.target.value);
            if (!document.activeElement || document.activeElement === document.body) elements.mainSearchInput.focus();
          } else if (e.target.classList.contains("unit-select")) {
            const prodId = e.target.getAttribute("data-id");
            updateLineUnit(prodId, e.target.value);
            if (!document.activeElement || document.activeElement === document.body) elements.mainSearchInput.focus();
          }
        });

        // Overall Discounts Inputs — keep state and the saved draft in sync with the exact inputs.
        elements.inputPercentDiscount.addEventListener("input", () => {
          state.percentDiscount = parseFloat(elements.inputPercentDiscount.value) || 0;
          persistActiveInvoice();
          recalculateFinancials();
        });
        elements.inputFixedDiscount.addEventListener("input", () => {
          state.fixedDiscount = parseFloat(elements.inputFixedDiscount.value) || 0;
          persistActiveInvoice();
          recalculateFinancials();
        });
        [elements.inputPercentDiscount, elements.inputFixedDiscount].forEach(inp => {
          inp.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              elements.mainSearchInput.focus();
            }
          });
        });

        // Customer Sidebar Actions
        elements.btnRemoveCust.addEventListener("click", detachCustomer);
        elements.btnChangeCust?.addEventListener("click", () => {
          setSearchMode("CUSTOMER");
          showToast("Search to select a replacement customer.");
        });

        // Reveal the optional past-product search only when requested.
        const historySearchButton = document.getElementById("btnHistorySearch");
        historySearchButton.addEventListener("click", () => {
          const input = elements.historySearchInput;
          const opening = input.hidden;
          if (opening) document.getElementById("custExtraDetails").open = true;
          input.hidden = !opening;
          historySearchButton.setAttribute("aria-expanded", String(opening));
          if (opening) input.focus();
          else {
            input.value = "";
            if (state.attachedCustomer) renderPastInvoices(state.attachedCustomer.pastInvoices);
          }
        });

        // Filter Customer Past History
        elements.historySearchInput.addEventListener("input", e => {
          if (state.attachedCustomer) {
            renderPastInvoices(state.attachedCustomer.pastInvoices, e.target.value.trim());
          }
        });

        document.getElementById("btnRefillLast").addEventListener("click", refillLastInvoice);
        // Add Product from Customer Past Invoices (Requirement E: adds at CURRENT demo price)
        elements.pastInvoicesContainer.addEventListener("click", e => {
          const btn = e.target.closest(".btn-add-history");
          if (!btn) return;
          const prodId = btn.getAttribute("data-prod-id");
          const product = DEMO_PRODUCTS.find(p => p.id === prodId);
          if (product) {
            addProductToInvoice(product);
            showToast(`Re-added from history at current price: ${product.price.toFixed(2)} EGP`);
            elements.mainSearchInput.focus();
          }
        });

        // Checkout & Modal Events
        elements.btnCheckout.addEventListener("click", openCheckout);
        document.getElementById("gateSkipCustomer").addEventListener("click", () => {
          state.customerGateSkipped = true;
          state.customerGatePending = false;
          document.getElementById("customerCheckoutGate").hidden = true;
          openCheckout();
        });
        document.getElementById("gatePhone").addEventListener("keydown", e => {
          // Walk-in customer in one key: Enter on an empty number skips the customer step.
          if (e.key === "Enter" && !e.target.value.trim()) { e.preventDefault(); document.getElementById("gateSkipCustomer").click(); }
        });
        document.getElementById("gatePhone").addEventListener("input", () => {
          const phone = document.getElementById("gatePhone").value.replace(/[^0-9]/g, "");
          const customer = DEMO_CUSTOMERS.find(c => String(c.phone || "").replace(/[^0-9]/g, "") === phone);
          const result = document.getElementById("gateCustomerResult");
          document.getElementById("gateNewCustomerFields").hidden = true;
          document.getElementById("gateCustomerName").value = "";
          if (customer && phone.length >= 9) {
            result.textContent = "✓ عميل مسجل: " + customer.name;
            result.classList.add("nova-customer-found");
            document.getElementById("gateFindCustomer").textContent = "تأكيد العميل ومتابعة الدفع";
          } else {
            result.textContent = "";
            result.classList.remove("nova-customer-found");
            document.getElementById("gateFindCustomer").textContent = "متابعة بالرقم";
          }
        });
        document.getElementById("gateCustomerForm").addEventListener("submit", e => {
          e.preventDefault();
          const raw = document.getElementById("gatePhone").value;
          const phone = raw.replace(/[^0-9]/g, "");
          const result = document.getElementById("gateCustomerResult");
          if (phone.length < 9 || phone.length > 15) {
            result.textContent = "راجع رقم الموبايل (من 9 إلى 15 رقم).";
            return;
          }
          let customer = DEMO_CUSTOMERS.find(c => String(c.phone || "").replace(/[^0-9]/g, "") === phone);
          if (!customer) {
            const nameField = document.getElementById("gateCustomerName");
            const fields = document.getElementById("gateNewCustomerFields");
            if (fields.hidden) {
              fields.hidden = false;
              result.classList.remove("nova-customer-found");
            result.textContent = "عميل جديد — ممكن تضيف اسمه أو تكمل بالرقم فقط.";
              document.getElementById("gateFindCustomer").textContent = "تسجيل ومتابعة الدفع";
              nameField.focus();
              return;
            }
            const name = nameField.value.trim() || "عميل " + phone;
            customer = { id:"DEMO-" + Date.now() + "-" + Math.random().toString(36).slice(2,6), name, phone, tier:"جديد", points:0, visits:0, pastInvoices:[] };
            DEMO_CUSTOMERS.push(customer);
            if (!saveDemoCustomers()) { DEMO_CUSTOMERS.pop(); return; }
            showToast("تم تسجيل العميل على هذا المتصفح.");
          }
          attachCustomer(customer);
          state.customerGatePending = false;
          result.textContent = "";
          document.getElementById("customerCheckoutGate").hidden = true;
          setSearchMode("PRODUCT");
          openCheckout();
        });
        document.getElementById("gateCancelCustomer").addEventListener("click", () => {
          state.customerGatePending = false;
          state.customerGateSkipped = true;
          document.getElementById("customerCheckoutGate").hidden = true;
          elements.mainSearchInput.focus();
        });
        document.getElementById("checkoutAddCustomer").addEventListener("click", () => { closeCheckout(); state.customerGateSkipped = false; openCheckout(); });
        elements.btnCloseCheckout.addEventListener("click", closeCheckout);
        elements.btnCancelCheckout.addEventListener("click", closeCheckout);
        elements.btnConfirmPayment.addEventListener("click", confirmPayment);

        // Cash Input Events
        elements.inputCashReceived.addEventListener("input", e => {
          const { grandTotal } = recalculateFinancials();
          refreshChange();
        });
        ["inputWalletRef", "inputWalletKind"].forEach(id => { const el = document.getElementById(id); el.addEventListener("input", refreshChange); el.addEventListener("change", refreshChange); });
        document.getElementById("inputWalletRef").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (!elements.btnConfirmPayment.disabled) confirmPayment(); } });
        // UX60: in split mode the cash field auto-fills with the remainder (total - card - credit); still editable.
        ["inputCardAmount", "inputCreditAmount"].forEach(id => document.getElementById(id).addEventListener("input", () => {
          if (state.checkoutPaymentMethod === "split") {
            const { grandTotal } = recalculateFinancials();
            const n = id2 => { const x = Number(document.getElementById(id2).value); return Number.isFinite(x) && x > 0 ? x : 0; };
            const rest = Math.max(0, Math.round((grandTotal - n("inputCardAmount") - n("inputCreditAmount")) * 100) / 100);
            elements.inputCashReceived.value = rest.toFixed(2);
            state.cashReceived = rest;
          }
          refreshChange();
        }));
        // UX60: Enter in the card/credit field moves to cash only when a cash remainder is left, else to confirm.
        ["inputCardAmount", "inputCreditAmount"].forEach(id => document.getElementById(id).addEventListener("keydown", e => {
          if (e.key !== "Enter" || state.checkoutPaymentMethod !== "split") return;
          e.preventDefault(); e.stopPropagation();
          if ((Number(elements.inputCashReceived.value) || 0) > 0) { elements.inputCashReceived.focus(); elements.inputCashReceived.select?.(); }
          else elements.btnConfirmPayment.focus();
        }));

        document.querySelectorAll(".pay-method-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            document.querySelectorAll(".pay-method-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.checkoutPaymentMethod = btn.getAttribute("data-method");
            document.getElementById("cashDetailsBox").style.display = state.checkoutPaymentMethod === "cash" || state.checkoutPaymentMethod === "split" ? "block" : "none";
            document.getElementById("splitDetailsBox").style.display = state.checkoutPaymentMethod === "split" ? "block" : "none";
            document.getElementById("walletDetailsBox").style.display = state.checkoutPaymentMethod === "wallet" ? "block" : "none";
            refreshChange();
            if (state.checkoutPaymentMethod === "wallet") document.getElementById("inputWalletRef").focus();
            else if (state.checkoutPaymentMethod === "cash") elements.inputCashReceived.focus();
            else if (state.checkoutPaymentMethod === "split") document.getElementById("inputCardAmount").focus();
            else if (elements.btnConfirmPayment.disabled) { const ac = document.getElementById("checkoutAddCustomer"); (ac.hidden ? elements.btnCancelCheckout : ac).focus(); }
            else elements.btnConfirmPayment.focus();
          });
        });

        document.querySelectorAll(".quick-cash-btn").forEach(btn => {
          btn.addEventListener("mousedown", e => e.preventDefault());
          btn.addEventListener("click", () => {
            const val = btn.getAttribute("data-val");
            const { grandTotal } = recalculateFinancials(), dueNow = dueForMethod(grandTotal, state.checkoutPaymentMethod).due;
            let amount = dueNow;
            if (val !== "exact") {
              amount = parseFloat(val);
            }
            elements.inputCashReceived.value = amount.toFixed(2);
            updateChangeDue(amount, dueNow);
            elements.inputCashReceived.focus();
          });
        });

        // Receipt Modal Events
        elements.btnCloseReceipt.addEventListener("click", () => {
          const cur = window.novaReceipt && window.novaReceipt.current();
          elements.receiptModal.classList.remove("active");
          if (!cur || cur.fromCheckout) startNewSale();
        });
        elements.btnReceiptNewSale.addEventListener("click", () => {
          const cur = window.novaReceipt && window.novaReceipt.current();
          elements.receiptModal.classList.remove("active");
          if (!cur || cur.fromCheckout) startNewSale();
        });
        elements.btnPrintReceiptBtn.addEventListener("click", () => {
          window.novaReceipt.print();
        });
        document.getElementById("btnReprintReceipt").addEventListener("click", () => {
          window.novaReceipt.reprint();
        });
        document.getElementById("btnExportReceiptPdf").addEventListener("click", () => {
          window.novaReceipt.exportPdf();
        });
        document.querySelectorAll("[data-receipt-width]").forEach(btn => {
          btn.addEventListener("click", () => window.novaReceipt.setWidth(btn.getAttribute("data-receipt-width")));
        });
        document.getElementById("btnPrinterStatus").addEventListener("click", () => {
          window.novaReceipt.setPrinterConnected(!window.novaReceipt.isPrinterConnected());
        });
        document.getElementById("btnReconnectPrinter").addEventListener("click", () => {
          window.novaReceipt.reconnectAndRetry();
        });

        // Global Keyboard Shortcuts
        window.addEventListener("keydown", e => {
          const checkoutOpen = elements.checkoutModal.classList.contains("active");
          const payHotkey = { F10: "card", F11: "credit", F12: "cash" }[e.key] || ((e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target && e.target.tagName) ? "cash" : null);
          if (checkoutOpen && payHotkey) {
            e.preventDefault();
            const b = document.querySelector('.pay-method-btn[data-method="' + payHotkey + '"]');
            if (b) {
              b.click();
              if (payHotkey === "cash") elements.inputCashReceived.focus();
              else if (!elements.btnConfirmPayment.disabled) elements.btnConfirmPayment.focus();
            }
            return;
          }
          if (e.key === "F1") {
            e.preventDefault();
            elements.helpModal.classList.add("active");
            elements.btnCloseHelp.focus();
          } else if (e.key === "F6" && !checkoutOpen) {
            e.preventDefault();
            elements.inputPercentDiscount.focus();
            elements.inputPercentDiscount.select();
          } else if (e.key === "F8" && !checkoutOpen) {
            e.preventDefault();
            const last = state.invoiceLines[state.invoiceLines.length - 1];
            if (last) {
              const prod = DEMO_PRODUCTS.find(p => p.id === last.productId || p.barcode === last.barcode) || last;
              const units = window.novaUnits.availableUnits(prod);
              if (units.length > 1) {
                const next = units[(units.indexOf(last.unit || "box") + 1) % units.length];
                updateLineUnit(last.productId, next);
              }
            }
            elements.mainSearchInput.focus();
          } else if (e.key === "F7" && !checkoutOpen) {
            e.preventDefault();
            elements.inputFixedDiscount.focus();
            elements.inputFixedDiscount.select();
          } else if (e.key === "Enter" && elements.receiptModal.classList.contains("active")) {
            e.preventDefault();
            elements.receiptModal.classList.remove("active");
            startNewSale();
          } else if (e.key === "F2") {
            e.preventDefault();
            startNewSale();
          } else if (e.key === "F3") {
            e.preventDefault();
            setSearchMode("CUSTOMER");
          } else if (e.key === "F4") {
            e.preventDefault();
            clearInvoice();
          } else if (e.key === "F9") {
            e.preventDefault();
            if (elements.checkoutModal.classList.contains("active")) {
              confirmPayment();
            } else {
              openCheckout();
            }
          } else if (e.key === "Enter" && elements.checkoutModal.classList.contains("active")) {
            if (e.target && (e.target.id === "btnCancelCheckout" || e.target.id === "btnCloseCheckout" || e.target.id === "checkoutAddCustomer")) return;
            e.preventDefault();
            confirmPayment();
          } else if (e.key === "Tab") {
            const open = document.querySelector(".modal-backdrop.active");
            if (open) {
              const f = [...open.querySelectorAll("button,input,select,textarea,a[href],[tabindex]")].filter(x => !x.disabled && x.tabIndex >= 0 && x.offsetParent !== null);
              if (f.length) {
                const first = f[0], last = f[f.length - 1];
                if (!open.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
                else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
              }
            }
          } else if (e.key === "Escape") {
            if (elements.checkoutModal.classList.contains("active")) {
              closeCheckout();
            } else if (elements.receiptModal.classList.contains("active")) {
              elements.receiptModal.classList.remove("active");
              startNewSale();
            } else if (elements.helpModal.classList.contains("active")) {
              elements.helpModal.classList.remove("active");
              elements.mainSearchInput.focus();
            } else {
              closeSuggestions();
              elements.mainSearchInput.focus();
            }
          }
        });

        // Close dropdown when clicking outside & keep search focused when clicking non-interactive workspace areas
        document.addEventListener("click", e => {
          if (!elements.suggestionsBox.contains(e.target) && e.target !== elements.mainSearchInput) {
            closeSuggestions();
          }
          if ((!document.body.dataset.activePage || document.body.dataset.activePage === "sale")
              && !elements.checkoutModal.classList.contains("active")
              && !elements.receiptModal.classList.contains("active")
              && !elements.helpModal.classList.contains("active")
              && document.getElementById("customerCheckoutGate")?.hidden !== false
              && heldPanel.hidden
              && !document.getElementById("novaLabelsPanel")?.classList.contains("open")
              && e.target.closest(".pos-root")
              && !e.target.closest("input,select,textarea,button,a,summary,details,[tabindex]")
              && !window.getSelection()?.toString()) {
            elements.mainSearchInput.focus();
          }
        });
      }

      // --- INITIALIZATION ---
      initEventListeners();
      elements.searchModeTag.addEventListener("click", () => setSearchMode(state.mode === "PRODUCT" ? "CUSTOMER" : "PRODUCT"));
      // Restore the saved draft exactly: discount inputs first (totals are derived
      // from them), then the attached customer, all before the first render.
      elements.inputPercentDiscount.value = state.percentDiscount ? String(state.percentDiscount) : "";
      elements.inputFixedDiscount.value = state.fixedDiscount ? String(state.fixedDiscount) : "";
      if (restoredCustomerId) {
        const restoredCustomer = DEMO_CUSTOMERS.find(c => String(c.id) === restoredCustomerId);
        if (restoredCustomer) attachCustomer(restoredCustomer);
      }
      renderInvoice();
      setSearchMode(state.attachedCustomer || state.invoiceLines.length ? "PRODUCT" : "CUSTOMER");

    })();
  
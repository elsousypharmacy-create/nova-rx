// UX405: incoming WhatsApp media for the conversations screen. Bytes arrive base64-encoded from the pharmacy bot
// (contract v1: media_base64 / mime_type / media_size / media_skipped) and are cached in KV only (no R2, no D1 blobs).
// The Worker never fetches Graph and never needs WA_TOKEN. Download URLs are never stored or logged.
export const MEDIA_TYPES = Object.freeze(['image', 'sticker', 'audio', 'video', 'document']);
export const SKIP_REASONS = Object.freeze(['too_large', 'fetch_failed', 'no_url', 'no_token', 'bad_id']);
export const MAX_MEDIA_BYTES = 6 * 1024 * 1024; // GAS caps at 5 MB; small headroom, KV allows 25 MB per value
export const MEDIA_TTL_S = 30 * 24 * 3600;
export const PLACEHOLDER = Object.freeze({ image: '[صورة]', sticker: '[ملصق]', audio: '[رسالة صوتية]', video: '[فيديو]', document: '[مستند]' });

// Served content types: anything else is sent as application/octet-stream + attachment (never rendered as HTML/SVG).
const SAFE_MIME = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|amr|wav|webm)|video\/(mp4|3gpp|webm|quicktime)|application\/pdf)$/;
const INLINE = /^(image|audio|video)\//;

const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);
export const isMediaType = (t) => MEDIA_TYPES.includes(t);
export const cleanMime = (v) => { const m = /^([a-z0-9.+-]+\/[a-z0-9.+-]+)/i.exec(String(v || '')); return m ? m[1].toLowerCase() : null; };
export const mediaKey = (tenant, mid) => 'wamedia:' + tenant + ':' + mid;

// Contract item (or Meta message object part) -> normalized media meta; null for non-media.
export function mediaMeta(it) {
  const type = it && it.type;
  if (!isMediaType(type)) return null;
  const size = Number(it.media_size);
  return {
    type,
    id: str(it.media_id, 200),
    mime: cleanMime(it.mime_type),
    filename: str(it.filename, 200),
    size: Number.isFinite(size) && size >= 0 ? Math.round(size) : null,
    skipped: SKIP_REASONS.includes(it.media_skipped) ? it.media_skipped : null,
    caption: str(it.text, 3000),
  };
}

export function decodeBase64(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  const s = b64.replace(/\s+/g, '');
  if (s.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || (s.length * 3) / 4 > MAX_MEDIA_BYTES + 3) return null;
  let bin;
  try { bin = atob(s); } catch { return null; }
  if (bin.length > MAX_MEDIA_BYTES) return null;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Cache the bytes in KV. Returns true when cached. Failures never throw (the message is still stored).
export async function cacheMedia(kv, tenant, mid, b64) {
  if (!kv || typeof kv.put !== 'function') return false;
  const bytes = decodeBase64(b64);
  if (!bytes || !bytes.length) return false;
  try { await kv.put(mediaKey(tenant, mid), bytes, { expirationTtl: MEDIA_TTL_S }); return true; } catch { return false; }
}

export function mediaOfRow(r) {
  if (!r || !isMediaType(r.media_type)) return null;
  return { type: r.media_type, mime: r.media_mime || null, filename: r.media_filename || null, size: r.media_size == null ? null : Number(r.media_size),
    skipped: r.media_skipped || null, caption: r.media_caption || null, cached: Number(r.media_cached) === 1 };
}

const MISSING = { too_large: 'الملف أكبر من 5 ميجا، ما اتحفظش هنا. افتحه من واتساب على الموبايل.', fetch_failed: 'تعذّر تحميل الملف من واتساب. افتحه من واتساب على الموبايل.' };
export const missingText = (reason) => MISSING[reason] || 'الملف مش متاح هنا. افتحه من واتساب على الموبايل.';

// GET /api/v1/inbox/history/media?id=<message id>. Same gate as the history routes (checkPin). SELECT + KV read only.
export async function mediaResponse(env, tenant, id, errorResponse, requestId) {
  const mid = typeof id === 'string' && id.length > 0 && id.length <= 120 ? id : null;
  if (!mid) return errorResponse('MEDIA_BAD_ID', 'معرّف الملف غير صالح.', 400, requestId);
  const r = await env.DB.prepare('SELECT media_type, media_mime, media_filename, media_skipped, media_cached FROM inbox_messages WHERE tenant_id = ? AND id = ?').bind(tenant, mid).first();
  if (!r || !isMediaType(r.media_type)) return errorResponse('MEDIA_NOT_FOUND', 'الملف غير موجود.', 404, requestId);
  let bytes = null;
  if (env.KV && Number(r.media_cached) === 1) {
    try { bytes = await env.KV.get(mediaKey(tenant, mid), 'arrayBuffer'); } catch { bytes = null; }
  }
  if (!bytes) return errorResponse('MEDIA_UNAVAILABLE', missingText(r.media_skipped), 404, requestId);
  const mime = SAFE_MIME.test(r.media_mime || '') ? r.media_mime : 'application/octet-stream';
  const fname = String(r.media_filename || (mid.replace(/[^\w.-]/g, '_') + '')).replace(/["\\\r\n]/g, '_');
  const disp = (INLINE.test(mime) || mime === 'application/pdf' ? 'inline' : 'attachment') + '; filename="' + fname.replace(/[^\x20-\x7e]/g, '_') + '"; filename*=UTF-8\'\'' + encodeURIComponent(fname);
  return new Response(bytes, { status: 200, headers: {
    'Content-Type': mime, 'Content-Disposition': disp, 'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Request-Id': requestId,
  } });
}

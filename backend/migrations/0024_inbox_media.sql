-- 0024: UX405 incoming WhatsApp media (image/sticker/audio/video/document). Additive only: old rows keep NULLs
-- and the text placeholder ([صورة] ...), so older clients keep working. Bytes are cached in KV (never R2, never D1).
ALTER TABLE inbox_messages ADD COLUMN media_type TEXT;
ALTER TABLE inbox_messages ADD COLUMN media_id TEXT;
ALTER TABLE inbox_messages ADD COLUMN media_mime TEXT;
ALTER TABLE inbox_messages ADD COLUMN media_filename TEXT;
ALTER TABLE inbox_messages ADD COLUMN media_size INTEGER;
ALTER TABLE inbox_messages ADD COLUMN media_skipped TEXT;
ALTER TABLE inbox_messages ADD COLUMN media_caption TEXT;
ALTER TABLE inbox_messages ADD COLUMN media_cached INTEGER;

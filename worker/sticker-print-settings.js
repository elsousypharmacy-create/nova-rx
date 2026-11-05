/**
 * NOVA Rx — sticker print settings and geometry helpers.
 * Dependency-free; safe for browser and Cloudflare Worker tests.
 * Stores only printer preferences, never patient data or secrets.
 */

export const LABEL_SIZE_PRESETS = Object.freeze([
  { id: '50x30', widthMm: 50, heightMm: 30 },
  { id: '40x30', widthMm: 40, heightMm: 30 },
  { id: '40x25', widthMm: 40, heightMm: 25 },
  { id: '50x25', widthMm: 50, heightMm: 25 },
  { id: '58x40', widthMm: 58, heightMm: 40 },
  { id: '60x40', widthMm: 60, heightMm: 40 },
  { id: '70x50', widthMm: 70, heightMm: 50 },
  { id: '100x50', widthMm: 100, heightMm: 50 }
]);

export const DEFAULT_STICKER_PRINT_SETTINGS = Object.freeze({
  presetId: '50x30',
  customWidthMm: null,
  customHeightMm: null,
  paperLayout: 'single',
  style: 'full',
  marginMm: 2,
  orientation: 'auto',
  copies: 1
});

const STORAGE_KEY = 'nova.sticker.printSettings.v2';
const PRESET_IDS = new Set(LABEL_SIZE_PRESETS.map(preset => preset.id));
const PAPER_LAYOUTS = new Set(['single', 'split']);
const STYLES = new Set(['full', 'compact']);
const ORIENTATIONS = new Set(['auto', 'portrait', 'landscape']);

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max, fallback) {
  const number = numberOrNull(value);
  if (number === null) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeDimension(value, fallback) {
  const number = numberOrNull(value);
  if (number === null) return fallback;
  return Math.min(200, Math.max(10, Math.round(number * 10) / 10));
}

export function normalizeStickerPrintSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  let presetId = String(source.presetId || source.preset || DEFAULT_STICKER_PRINT_SETTINGS.presetId);
  if (presetId !== 'custom' && !PRESET_IDS.has(presetId)) presetId = DEFAULT_STICKER_PRINT_SETTINGS.presetId;

  const preset = LABEL_SIZE_PRESETS.find(item => item.id === presetId) || LABEL_SIZE_PRESETS[0];
  const customWidthMm = normalizeDimension(source.customWidthMm ?? source.widthMm, preset.widthMm);
  const customHeightMm = normalizeDimension(source.customHeightMm ?? source.heightMm, preset.heightMm);
  const paperLayout = PAPER_LAYOUTS.has(String(source.paperLayout)) ? String(source.paperLayout) : DEFAULT_STICKER_PRINT_SETTINGS.paperLayout;
  const style = STYLES.has(String(source.style)) ? String(source.style) : DEFAULT_STICKER_PRINT_SETTINGS.style;
  const orientation = ORIENTATIONS.has(String(source.orientation)) ? String(source.orientation) : DEFAULT_STICKER_PRINT_SETTINGS.orientation;

  return {
    presetId,
    customWidthMm,
    customHeightMm,
    paperLayout,
    style,
    marginMm: clampNumber(source.marginMm, 0, 10, DEFAULT_STICKER_PRINT_SETTINGS.marginMm),
    orientation,
    copies: Math.round(clampNumber(source.copies, 1, 50, DEFAULT_STICKER_PRINT_SETTINGS.copies))
  };
}

export function resolveStickerDimensions(settingsInput = {}) {
  const settings = normalizeStickerPrintSettings(settingsInput);
  const preset = LABEL_SIZE_PRESETS.find(item => item.id === settings.presetId);
  let widthMm = preset ? preset.widthMm : settings.customWidthMm;
  let heightMm = preset ? preset.heightMm : settings.customHeightMm;

  if (settings.orientation === 'landscape' && heightMm > widthMm) [widthMm, heightMm] = [heightMm, widthMm];
  if (settings.orientation === 'portrait' && widthMm > heightMm) [widthMm, heightMm] = [heightMm, widthMm];
  return { widthMm, heightMm, settings };
}

export function buildStickerPageCss(settingsInput = {}) {
  const { widthMm, heightMm, settings } = resolveStickerDimensions(settingsInput);
  return `@page{size:${widthMm}mm ${heightMm}mm;margin:${settings.marginMm}mm}`;
}

export function buildStickerPreviewStyle(settingsInput = {}, pixelsPerMm = 3.7795275591) {
  const { widthMm, heightMm } = resolveStickerDimensions(settingsInput);
  return {
    width: `${widthMm}mm`,
    height: `${heightMm}mm`,
    minWidth: `${Math.round(widthMm * pixelsPerMm)}px`,
    minHeight: `${Math.round(heightMm * pixelsPerMm)}px`
  };
}

export function createStickerPrintSettingsStore(storage, key = STORAGE_KEY) {
  const canUseStorage = storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
  return {
    load() {
      if (!canUseStorage) return { ...DEFAULT_STICKER_PRINT_SETTINGS };
      try {
        const parsed = JSON.parse(storage.getItem(key) || 'null');
        return normalizeStickerPrintSettings(parsed || DEFAULT_STICKER_PRINT_SETTINGS);
      } catch (_) {
        return { ...DEFAULT_STICKER_PRINT_SETTINGS };
      }
    },
    save(settings) {
      const normalized = normalizeStickerPrintSettings(settings);
      if (!canUseStorage) return { settings: normalized, persisted: false };
      try {
        storage.setItem(key, JSON.stringify(normalized));
        return { settings: normalized, persisted: true };
      } catch (_) {
        return { settings: normalized, persisted: false };
      }
    },
    clear() {
      if (!canUseStorage || typeof storage.removeItem !== 'function') return false;
      try { storage.removeItem(key); return true; }
      catch (_) { return false; }
    }
  };
}

export function stickerSettingsFromForm(form) {
  const value = name => {
    const field = form && typeof form.querySelector === 'function'
      ? form.querySelector(`[name="${name}"],#${name}`)
      : null;
    return field ? field.value : undefined;
  };
  return normalizeStickerPrintSettings({
    presetId: value('presetId') || value('nlSize'),
    customWidthMm: value('customWidthMm') || value('nlCustomWidth'),
    customHeightMm: value('customHeightMm') || value('nlCustomHeight'),
    paperLayout: value('paperLayout') || value('nlPaper'),
    style: value('style') || value('nlStyle'),
    marginMm: value('marginMm') || value('nlMargin'),
    orientation: value('orientation') || value('nlOrientation'),
    copies: value('copies') || value('nlCopies')
  });
}

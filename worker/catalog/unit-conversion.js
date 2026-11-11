/**
 * CAT-02 Unit and Pack Conversion Engine
 * Handles conversion between carton, box, strip, and tablet/unit, and relative price calculation.
 */

export function normalizePackHierarchy(packDef = {}) {
  const packsPerCarton = Number(packDef.packsPerCarton || packDef.carton || packDef.cartonPacks || 1);
  const stripsPerBox = Number(packDef.stripsPerBox || packDef.box || packDef.boxStrips || packDef.strips || 1);
  const tabletsPerStrip = Number(packDef.tabletsPerStrip || packDef.strip || packDef.stripTablets || packDef.tablets || 1);

  const stripFactor = tabletsPerStrip > 0 ? tabletsPerStrip : 1;
  const boxFactor = (stripsPerBox > 0 ? stripsPerBox : 1) * stripFactor;
  const cartonFactor = (packsPerCarton > 0 ? packsPerCarton : 1) * boxFactor;

  return {
    packsPerCarton,
    stripsPerBox,
    tabletsPerStrip,
    factors: {
      carton: cartonFactor,
      box: boxFactor,
      pack: boxFactor,
      strip: stripFactor,
      tablet: 1,
      piece: 1,
      unit: 1
    }
  };
}

export function toBaseUnits(quantity, unitType = 'unit', packDef = {}) {
  const qty = Number(quantity) || 0;
  const hierarchy = normalizePackHierarchy(packDef);
  const u = String(unitType || 'unit').toLowerCase().trim();

  let factor = 1;
  if (u === 'carton' || u === 'كرتونة') {
    factor = hierarchy.factors.carton;
  } else if (u === 'box' || u === 'pack' || u === 'علبة') {
    factor = hierarchy.factors.box;
  } else if (u === 'strip' || u === 'شريط') {
    factor = hierarchy.factors.strip;
  } else if (u === 'tablet' || u === 'piece' || u === 'unit' || u === 'قرص' || u === 'وحدة') {
    factor = 1;
  } else if (hierarchy.factors[u] !== undefined) {
    factor = hierarchy.factors[u];
  }

  return qty * factor;
}

export function fromBaseUnits(baseQuantity, unitType = 'unit', packDef = {}) {
  const baseQty = Number(baseQuantity) || 0;
  const hierarchy = normalizePackHierarchy(packDef);
  const u = String(unitType || 'unit').toLowerCase().trim();

  let factor = 1;
  if (u === 'carton' || u === 'كرتونة') {
    factor = hierarchy.factors.carton;
  } else if (u === 'box' || u === 'pack' || u === 'علبة') {
    factor = hierarchy.factors.box;
  } else if (u === 'strip' || u === 'شريط') {
    factor = hierarchy.factors.strip;
  } else if (u === 'tablet' || u === 'piece' || u === 'unit' || u === 'قرص' || u === 'وحدة') {
    factor = 1;
  } else if (hierarchy.factors[u] !== undefined) {
    factor = hierarchy.factors[u];
  }

  if (factor <= 0) return 0;
  return baseQty / factor;
}

export function computeConvertedLinePrice(price, priceUnitType = 'box', targetUnitType = 'unit', packDef = {}, quantity = 1) {
  const p = Number(price) || 0;
  const qty = Number(quantity) || 1;

  const priceUnitBaseQty = toBaseUnits(1, priceUnitType, packDef);
  const targetUnitBaseQty = toBaseUnits(1, targetUnitType, packDef);

  if (priceUnitBaseQty <= 0) return 0;

  const basePrice = p / priceUnitBaseQty;
  const convertedUnitPrice = basePrice * targetUnitBaseQty;

  return Math.round((convertedUnitPrice * qty) * 10000) / 10000;
}

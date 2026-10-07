/**
 * Unit handling.
 *
 * Internally every quantity is stored in the ingredient's BASE unit:
 *   weight -> g, liquid -> ml, countable items -> units / slices / cans / bottles.
 *
 * Other units (kg, lb, L, gal, ...) are only accepted at the API edge
 * (e.g. a delivery of "20 kg") and converted here, or produced for display.
 * Converting gallons into grams throws instead of guessing.
 */

const AppError = require('./AppError');

const MASS = { g: 1, kg: 1000, lb: 453.592, oz: 28.3495 };
const VOLUME = { ml: 1, l: 1000, gal: 3785.41, qt: 946.353, fl_oz: 29.5735 };

function dimensionOf(unit) {
  const u = String(unit).toLowerCase();
  if (u in MASS) return 'mass';
  if (u in VOLUME) return 'volume';
  return 'count';
}

/**
 * Convert `quantity` expressed in `unit` into `baseUnit`.
 * toBaseUnit(2.5, 'kg', 'g') -> 2500
 * toBaseUnit(3, 'cans', 'cans') -> 3 ; toBaseUnit(3, 'units', 'cans') -> 3 (count is count)
 */
function toBaseUnit(quantity, unit, baseUnit) {
  if (unit === undefined || unit === null || unit === '' || unit === baseUnit) return quantity;
  const from = String(unit).toLowerCase();
  const to = String(baseUnit).toLowerCase();
  const fromDim = dimensionOf(from);
  const toDim = dimensionOf(to);
  if (fromDim !== toDim) {
    throw new AppError(400, 'INVALID_UNIT', `Cannot convert ${unit} into ${baseUnit}.`);
  }
  if (fromDim === 'mass') return (quantity * MASS[from]) / MASS[to];
  if (fromDim === 'volume') return (quantity * VOLUME[from]) / VOLUME[to];
  return quantity; // units / each / cans / slices are all plain counts
}

const round = (n, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Human-readable quantity for the UI: 6500 g -> "6.5 kg", 450 g -> "450 g", 38 units -> "38 units". */
function formatQuantity(quantity, baseUnit) {
  const dim = dimensionOf(baseUnit);
  const abs = Math.abs(quantity);
  if (dim === 'mass' && abs >= 1000) return `${round(quantity / 1000, 2)} kg`;
  if (dim === 'volume' && abs >= 1000) return `${round(quantity / 1000, 2)} L`;
  return `${round(quantity, 1)} ${baseUnit}`;
}

/** Large display unit for an ingredient: g -> kg, ml -> L, counts unchanged. */
function displayUnit(baseUnit) {
  const dim = dimensionOf(baseUnit);
  if (dim === 'mass') return 'kg';
  if (dim === 'volume') return 'L';
  return baseUnit;
}

/** Convert a base quantity into displayUnit(baseUnit): 6500 g -> 6.5 (kg). */
function toDisplayValue(quantity, baseUnit, digits = 2) {
  const dim = dimensionOf(baseUnit);
  if (dim === 'mass' || dim === 'volume') return round(quantity / 1000, digits);
  return round(quantity, digits);
}

module.exports = { dimensionOf, toBaseUnit, formatQuantity, displayUnit, toDisplayValue, round };

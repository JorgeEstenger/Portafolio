/**
 * Builds realistic random order REQUESTS (the same JSON a client would POST
 * to /api/orders). Used by the 60-day generator and by POST /api/simulate/rush.
 *
 * Everything is driven by a seeded random stream, so results are repeatable.
 */

/** How likely each main dish is to be ordered (relative weights). */
const MAIN_POPULARITY = {
  pizza_margherita: 22, // clear best seller
  pizza_pepperoni: 16,
  chicken_alfredo: 11,
  lasagna: 8,
  caesar_salad: 8,
  carbonara: 7,
  chicken_parm: 7,
  spaghetti_marinara: 6,
  spaghetti_meatballs: 5,
  penne_vodka: 5,
  pizza_funghi: 3,
  pizza_quattro_formaggi: 2.5,
  meatball_parm: 2.5,
};

/** Lunch crowd orders more salads and heroes. */
const LUNCH_BOOST = { caesar_salad: 1.6, meatball_parm: 2.2, chicken_parm: 0.8, lasagna: 0.8 };

const CHANNEL_MIX = {
  lunch: { dine_in: 34, takeout: 20, website: 10, uber_eats: 16, doordash: 13, barmade: 7 },
  dinner: { dine_in: 37, takeout: 11, website: 9, uber_eats: 20, doordash: 15, barmade: 8 },
};

/** Number of main dishes per order, by channel (delivery baskets are bigger). */
const BASKET_SIZE = {
  dine_in: [[1, 30], [2, 42], [3, 15], [4, 10], [5, 3]],
  takeout: [[1, 42], [2, 38], [3, 14], [4, 6]],
  website: [[1, 40], [2, 38], [3, 15], [4, 7]],
  barmade: [[1, 40], [2, 38], [3, 15], [4, 7]],
  uber_eats: [[1, 22], [2, 40], [3, 24], [4, 14]],
  doordash: [[1, 28], [2, 40], [3, 21], [4, 11]],
};

const PIZZAS = new Set(['pizza_margherita', 'pizza_pepperoni', 'pizza_funghi']);
const CHICKEN_ADDABLE = { caesar_salad: 0.35, spaghetti_marinara: 0.08, carbonara: 0.06, penne_vodka: 0.1 };

function pickModifiers(rng, key) {
  if (PIZZAS.has(key)) {
    if (rng.chance(0.1)) return ['extra_cheese'];
    if (rng.chance(0.02)) return ['no_cheese'];
  }
  if (key in CHICKEN_ADDABLE && rng.chance(CHICKEN_ADDABLE[key])) return ['add_chicken'];
  return [];
}

/**
 * One random order request.
 * daypart: 'lunch' | 'dinner' (affects channel mix and dish mix)
 * channel: optional - force a channel
 */
function createOrderRequest(rng, { daypart = 'dinner', channel } = {}) {
  const orderChannel = channel || rng.weighted(Object.entries(CHANNEL_MIX[daypart] || CHANNEL_MIX.dinner));
  const mains = rng.weighted(BASKET_SIZE[orderChannel]);
  const isDineIn = orderChannel === 'dine_in';

  const weights = Object.entries(MAIN_POPULARITY).map(([key, w]) => [
    key, daypart === 'lunch' ? w * (LUNCH_BOOST[key] || 1) : w,
  ]);

  // Identical dishes with identical modifiers are merged into one line (qty 2, 3, ...).
  const lines = new Map();
  const add = (key, modifiers = []) => {
    const lineKey = `${key}|${modifiers.join(',')}`;
    const line = lines.get(lineKey) || { item_id: key, qty: 0, modifiers };
    line.qty += 1;
    lines.set(lineKey, line);
  };

  for (let i = 0; i < mains; i++) {
    const key = rng.weighted(weights);
    add(key, pickModifiers(rng, key));
  }
  if (rng.chance(isDineIn ? 0.25 : 0.15)) add('garlic_bread');
  if (rng.chance(isDineIn ? 0.2 : 0.08)) {
    add('tiramisu');
    if (mains >= 3 && rng.chance(0.5)) add('tiramisu');
  }
  for (let i = 0; i < mains; i++) {
    if (rng.chance(isDineIn ? 0.55 : 0.3)) add(rng.chance(0.65) ? 'coca_cola' : 'san_pellegrino');
  }

  return { channel: orderChannel, items: [...lines.values()] };
}

module.exports = { createOrderRequest, MAIN_POPULARITY, CHANNEL_MIX };

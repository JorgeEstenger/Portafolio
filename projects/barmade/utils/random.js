/**
 * Small deterministic random number generator (mulberry32).
 *
 * The same seed always produces the same sequence, which is what makes
 * POST /api/demo/reset return exactly the same 60-day dataset every time.
 * Math.random() is never used for mock data.
 */

/** Turn a string label into a 32-bit number, so each stream gets its own seed. */
function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * createRandom(20261007, 'orders') -> an independent stream. Separate streams
 * mean that tweaking, say, waste generation never changes the orders.
 */
function createRandom(seed, stream = '') {
  let state = (Number(seed) ^ hashString(String(stream))) >>> 0;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rng = {
    next,
    /** Float in [min, max). */
    float: (min, max) => min + next() * (max - min),
    /** Integer in [min, max] (inclusive). */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    /** Approximately normal (mean, sd) using Box-Muller. */
    normal(mean = 0, sd = 1) {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** Pick one entry of [{ value, weight }] (or [value, weight] pairs) by weight. */
    weighted(entries) {
      const list = entries.map((e) => (Array.isArray(e) ? { value: e[0], weight: e[1] } : e));
      const total = list.reduce((sum, e) => sum + e.weight, 0);
      let roll = next() * total;
      for (const entry of list) {
        roll -= entry.weight;
        if (roll < 0) return entry.value;
      }
      return list[list.length - 1].value;
    },
    pick: (array) => array[Math.floor(next() * array.length)],
  };
  return rng;
}

module.exports = { createRandom, hashString };

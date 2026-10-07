/**
 * Demo configuration. Every value has a sensible default and can be
 * overridden with an environment variable - no .env file is required.
 *
 * All numbers here are mock/demo values, not real commission rates.
 */

const num = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

/** Commission/processing fee per channel, as a fraction of the gross order total. */
const DEFAULT_CHANNEL_FEES = {
  dine_in: 0,
  takeout: 0,
  website: 0.029, // card processing only
  barmade: 0.05, // BarMade ordering platform
  uber_eats: 0.3,
  doordash: 0.25,
};

function loadChannelFees() {
  if (!process.env.CHANNEL_FEES) return DEFAULT_CHANNEL_FEES;
  try {
    // e.g. CHANNEL_FEES='{"uber_eats":0.28,"doordash":0.22}'
    return { ...DEFAULT_CHANNEL_FEES, ...JSON.parse(process.env.CHANNEL_FEES) };
  } catch {
    throw new Error('CHANNEL_FEES must be valid JSON, e.g. {"uber_eats":0.28}');
  }
}

const config = {
  restaurant: {
    name: 'Trattoria BarMade (demo)',
    timezone: process.env.RESTAURANT_TIMEZONE || 'America/New_York',
    opensAt: '11:00',
    closesAt: '22:00',
  },

  channels: loadChannelFees(),

  demo: {
    // 'demo' = 60-day generated dataset, 'classic' = the original small fixture.
    dataset: process.env.DEMO_DATASET || 'demo',
    seed: num(process.env.DEMO_SEED, 20261007),
    days: num(process.env.DEMO_DAYS, 60),
    // "Now" at the end of Day 60, in restaurant local time. Use DEMO_NOW=now
    // to anchor the dataset to the real current time instead.
    now: process.env.DEMO_NOW || process.env.MOCK_NOW || '2026-10-07T18:30:00',
  },

  forecast: {
    usageWindowDays: num(process.env.USAGE_WINDOW_DAYS, 14), // history used for average daily usage
    overstockFactor: num(process.env.OVERSTOCK_FACTOR, 1.75), // overstock when cover > target x factor
    restockHorizonDays: num(process.env.RESTOCK_HORIZON_DAYS, 7), // "weekly" restock
    safetyStockDays: num(process.env.SAFETY_STOCK_DAYS, 2),
  },
};

module.exports = config;

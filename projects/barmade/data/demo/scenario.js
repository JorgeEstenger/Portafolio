/**
 * Knobs for the 60-day demo dataset. Change these to reshape the story;
 * the generator stays the same.
 */

module.exports = {
  /** Typical number of orders per weekday (0 = Sunday ... 6 = Saturday). */
  baseOrdersByWeekday: [134, 86, 90, 98, 112, 150, 162],
  /** Slow growth over the period (+0.15% per day, ~9% over 60 days). */
  trendPerDay: 0.0015,
  /** Day-to-day randomness (weather, events...). */
  dailyNoise: 0.07,

  /** Share of orders in each part of the day (restaurant local time). */
  dayparts: {
    weekday: { lunch: 0.38, dinner: 0.52, offPeak: 0.1 },
    weekend: { lunch: 0.3, dinner: 0.6, offPeak: 0.1 },
  },

  /** Ordinary kitchen waste events per day (dropped pizza, prep trim, ...). */
  wasteEventsPerDay: [1, 4],
  /** Chance per day of a spoiled perishable (wilted romaine, sour cream, ...). */
  spoilageChancePerDay: 0.3,
  /** Ingredients counted on Sunday night (weekly partial count). */
  weeklyCountSize: 6,

  /** Planted demo stories - see GET /api/demo for the resulting dates. */
  stories: {
    // Story 5: one unusually busy Saturday (3rd-to-last Saturday in the window).
    salesSpike: { weekday: 6, occurrenceFromEnd: 3, multiplier: 1.3, note: 'Little Italy street festival' },
    // Story 2: yesterday's tomato sauce delivery included a bulk-deal extra (about a week of sauce).
    overstock: { ingredientId: 'ING-001', occurrenceFromEnd: 1, extraPacks: 24, note: 'Bulk promo from Sysco - bought extra cases' },
    // Story 1: the last mozzarella delivery before "now" arrives short, leaving stock
    // just above the minimum, so a handful of pizzas (or a rush) crosses it.
    lowStock: { ingredientId: 'ING-002', targetAboveMinimum: 3000, note: 'Short shipment - supplier out of stock' },
  },
};

/**
 * Dashboard and sales reports. Everything is calculated on request from the
 * order log and the inventory analysis, so the numbers can never drift out of
 * sync with the orders (there is no separate "statistics" table to update).
 *
 * Money: gross = what the customer paid, fees = channel commission, net = gross - fees.
 */

const orderRepository = require('../repositories/orderRepository');
const alertRepository = require('../repositories/alertRepository');
const menuRepository = require('../repositories/menuRepository');
const alertService = require('./alertService');
const forecastService = require('./forecastService');
const { CHANNELS, feeRate, roundMoney } = require('./orderRules');
const config = require('../config');
const clock = require('../utils/clock');
const { businessDate, addDays, weekdayOf, WEEKDAY_NAMES, zonedParts, isBusinessDate } = require('../utils/timezone');
const AppError = require('../utils/AppError');

function totals(orders) {
  const t = { orders: orders.length, items_sold: 0, gross_revenue: 0, channel_fees: 0, net_revenue: 0 };
  for (const o of orders) {
    t.gross_revenue += o.gross_total;
    t.channel_fees += o.channel_fee;
    t.net_revenue += o.net_total;
    for (const i of o.items) t.items_sold += i.quantity;
  }
  t.gross_revenue = roundMoney(t.gross_revenue);
  t.channel_fees = roundMoney(t.channel_fees);
  t.net_revenue = roundMoney(t.net_revenue);
  t.average_order_value = t.orders ? roundMoney(t.gross_revenue / t.orders) : 0;
  return t;
}

/** One row per channel (all six, even with zero orders). */
function byChannel(orders) {
  const all = totals(orders);
  return CHANNELS.map((channel) => {
    const t = totals(orders.filter((o) => o.channel === channel));
    return {
      channel,
      fee_rate: feeRate(channel),
      orders: t.orders,
      gross: t.gross_revenue,
      fees: t.channel_fees,
      net: t.net_revenue,
      average_order_value: t.average_order_value,
      share_of_orders: all.orders ? Math.round((t.orders / all.orders) * 1000) / 10 : 0,
      share_of_gross: all.gross_revenue ? Math.round((t.gross_revenue / all.gross_revenue) * 1000) / 10 : 0,
      net_margin_pct: t.gross_revenue ? Math.round((t.net_revenue / t.gross_revenue) * 1000) / 10 : 0,
    };
  });
}

/** Quantity and revenue per menu item. */
function byItem(orders, menu) {
  const rows = new Map();
  for (const o of orders) {
    for (const i of o.items) {
      const row = rows.get(i.menuItemId) || { item_id: i.item_id, menuItemId: i.menuItemId, name: i.name, quantity: 0, revenue: 0 };
      row.quantity += i.quantity;
      row.revenue += i.lineTotal;
      rows.set(i.menuItemId, row);
    }
  }
  const categories = new Map(menu.map((m) => [m.id, m.category || null]));
  return [...rows.values()].map((r) => ({ ...r, category: categories.get(r.menuItemId) || null, revenue: roundMoney(r.revenue) }));
}

const localMinutes = (iso) => {
  const p = zonedParts(iso);
  return p.hour * 60 + p.minute;
};

function parseDays(value, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 366) {
    throw new AppError(400, 'VALIDATION_ERROR', 'days must be a whole number between 1 and 366.');
  }
  return n;
}

/** GET /api/dashboard/today (optional ?date=YYYY-MM-DD for another business date) */
async function getToday({ date } = {}) {
  const now = clock.now();
  const today = businessDate(now);
  if (date !== undefined && !isBusinessDate(date)) {
    throw new AppError(400, 'INVALID_DATE', 'date must be a date like 2026-10-07.');
  }
  const day = date || today;
  const isToday = day === today;

  const orders = await orderRepository.findSummaries({ date: day });
  const menu = await menuRepository.findAll();
  const sales = totals(orders);

  // Same weekday last week, up to the same time of day (fair comparison for a day in progress).
  const cutoff = isToday ? localMinutes(now) : Infinity;
  const lastWeek = totals((await orderRepository.findSummaries({ date: addDays(day, -7) }))
    .filter((o) => localMinutes(o.placed_at) <= cutoff));
  const change = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);

  const hourOf = new Map(orders.map((o) => [o.id, zonedParts(o.placed_at).hour]));
  const hourly = [];
  for (let hour = 11; hour <= 22; hour++) {
    const inHour = orders.filter((o) => hourOf.get(o.id) === hour);
    hourly.push({ hour, label: `${String(hour).padStart(2, '0')}:00`, orders: inHour.length, gross: totals(inHour).gross_revenue });
  }

  const { analyses } = await forecastService.analyzeAll({ now });
  const count = (fn) => analyses.filter(fn).length;
  const activeAlerts = await alertService.getActiveAlerts();
  const expiringSoon = (await alertRepository.find({ type: 'EXPIRING_SOON', status: 'ACTIVE' })).length;

  return {
    date: day,
    weekday: WEEKDAY_NAMES[weekdayOf(day)],
    timezone: config.restaurant.timezone,
    as_of: now.toISOString(),
    is_today: isToday,
    sales,
    vs_same_time_last_week: {
      date: addDays(day, -7),
      orders: lastWeek.orders,
      gross_revenue: lastWeek.gross_revenue,
      orders_change_pct: change(sales.orders, lastWeek.orders),
      gross_change_pct: change(sales.gross_revenue, lastWeek.gross_revenue),
    },
    top_items: byItem(orders, menu).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    channels: byChannel(orders),
    hourly,
    inventory: {
      ingredients: analyses.length,
      low_stock_count: count((a) => a.stock_status === 'LOW_STOCK'),
      out_of_stock_count: count((a) => a.stock_status === 'OUT_OF_STOCK'),
      overstock_count: count((a) => a.status === 'OVERSTOCK'),
      runout_risk_count: count((a) => a.status === 'RUNOUT_RISK'),
      expiring_soon_count: expiringSoon,
    },
    active_alerts: activeAlerts,
  };
}

/**
 * GET /api/dashboard/sales?days=60
 * Daily series (orders, items, gross, fees, net) for the last `days` business
 * days including today, plus item and channel totals for the period.
 * A day is flagged as a SPIKE / DIP when its orders are 25% above / below the
 * average for the same weekday in the period.
 */
async function getSales({ days } = {}) {
  const span = parseDays(days, 60);
  const now = clock.now();
  const to = businessDate(now);
  const from = addDays(to, -(span - 1));
  const orders = await orderRepository.findSummaries({ from, to });
  const menu = await menuRepository.findAll();

  const grouped = new Map();
  for (const o of orders) {
    if (!grouped.has(o.business_date)) grouped.set(o.business_date, []);
    grouped.get(o.business_date).push(o);
  }

  const series = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    series.push({ date: d, weekday: WEEKDAY_NAMES[weekdayOf(d)], partial: d === to, ...totals(grouped.get(d) || []) });
  }

  for (const day of series) {
    const peers = series.filter((s) => s.weekday === day.weekday && s.date !== day.date && !s.partial && s.orders > 0);
    const average = peers.length ? peers.reduce((sum, s) => sum + s.orders, 0) / peers.length : null;
    day.weekday_average_orders = average === null ? null : Math.round(average * 10) / 10;
    day.vs_weekday_average_pct = average && !day.partial ? Math.round(((day.orders - average) / average) * 1000) / 10 : null;
    day.anomaly = day.vs_weekday_average_pct === null ? null
      : day.vs_weekday_average_pct >= 25 ? 'SPIKE'
        : day.vs_weekday_average_pct <= -25 ? 'DIP' : null;
  }

  return {
    from,
    to,
    days: span,
    timezone: config.restaurant.timezone,
    totals: totals(orders),
    daily: series,
    items: byItem(orders, menu).sort((a, b) => b.quantity - a.quantity),
    channels: byChannel(orders),
    anomalies: series.filter((s) => s.anomaly).map((s) => ({ date: s.date, weekday: s.weekday, orders: s.orders, anomaly: s.anomaly, vs_weekday_average_pct: s.vs_weekday_average_pct })),
  };
}

/** GET /api/dashboard/channels?days=30 */
async function getChannels({ days } = {}) {
  const span = parseDays(days, 30);
  const to = businessDate(clock.now());
  const from = addDays(to, -(span - 1));
  const orders = await orderRepository.findSummaries({ from, to });
  return { from, to, days: span, totals: totals(orders), channels: byChannel(orders) };
}

/** GET /api/dashboard/items?days=30 */
async function getItems({ days } = {}) {
  const span = parseDays(days, 30);
  const to = businessDate(clock.now());
  const from = addDays(to, -(span - 1));
  const orders = await orderRepository.findSummaries({ from, to });
  const items = byItem(orders, await menuRepository.findAll()).sort((a, b) => b.quantity - a.quantity);
  return { from, to, days: span, count: items.length, data: items };
}

const { persistent } = require('../data/persistence');
module.exports = {
  getToday: persistent(getToday),
  getSales: persistent(getSales),
  getChannels: persistent(getChannels),
  getItems: persistent(getItems),
};

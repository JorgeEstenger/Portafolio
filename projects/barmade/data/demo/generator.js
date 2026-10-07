/**
 * Deterministic 60-day history generator.
 *
 * Produces a complete, self-consistent restaurant state:
 *   ingredients (with batches), menu, orders, inventory movements and alerts.
 *
 * How it works (see README "How the 60-day dataset is generated"):
 *   1. Demand: for each day, decide how many orders (weekday pattern, trend,
 *      noise, planted spike) and when (lunch / dinner rush curves), then build
 *      each order request with the same factory the rush simulator uses.
 *   2. Replay the 60 days minute by minute as a list of events:
 *        06:00  discard expired batches          (spoilage)
 *        07-09  supplier deliveries              (delivery)
 *        10:00  prep: dough, alfredo, meatballs  (prep_production / prep_usage)
 *        11-22  customer orders                  (sale)  <- same order rules as the live API
 *        all day kitchen waste / spoiled produce (waste / spoilage)
 *        Sun    weekly partial count             (manual_count)
 *   3. Plant the demo stories (spike, overstock, short-shipped mozzarella).
 *
 * The same seed always gives the same output. Separate random streams are used
 * for orders, waste, deliveries and counts so changing one doesn't shift the others.
 */

const config = require('../../config');
const scenario = require('./scenario');
const { createIngredientCatalog, createMenuCatalog } = require('./catalog');
const { createOrderRequest } = require('./orderFactory');
const { createRandom } = require('../../utils/random');
const { zonedToUtc, businessDate, addDays, weekdayOf, localTime } = require('../../utils/timezone');
const { nextId } = require('../../utils/ids');
const rules = require('../../services/stockRules');
const orderRules = require('../../services/orderRules');
const { buildLowStockAlert, resolution } = require('../../services/alertRules');

const MINUTE_MS = 60 * 1000;
const pad = (n, width) => String(n).padStart(width, '0');

const SUPPLIER_TIMES = {
  'Rossi Bakery': '06:45',
  'Bella Dairy': '07:15',
  'Green Valley Produce': '07:40',
  'Coastal Meats': '08:10',
  Sysco: '09:00',
  'Coca-Cola Bottling': '09:30',
};

/** Kitchen waste templates: [ingredientId, min, max] amounts in base units. */
const WASTE_TEMPLATES = [
  { weight: 5, note: 'Dropped pizza - remade', items: [['ING-003', 1, 1], ['ING-001', 200, 200], ['ING-002', 150, 150]] },
  { weight: 3, note: 'Overcooked pasta - remade', items: [['ING-005', 150, 300]] },
  { weight: 3, note: 'Romaine prep trim', items: [['ING-022', 150, 400]] },
  { weight: 2, note: 'Basil leaves trimmed (bruised)', items: [['ING-011', 15, 50]] },
  { weight: 2, note: 'Chicken trim', items: [['ING-009', 100, 300]] },
  { weight: 2, note: 'Wrong order remade - Chicken Alfredo', items: [['ING-005', 150, 150], ['ING-006', 200, 200], ['ING-009', 180, 180], ['ING-007', 20, 20]] },
  { weight: 1, note: 'Meatballs overcooked', items: [['ING-019', 3, 6]] },
  { weight: 2, note: 'Spilled tomato sauce', items: [['ING-001', 300, 900]] },
  { weight: 2, note: 'End-of-night stale bread', items: [['ING-027', 1, 2]] },
];

/** Perishables that occasionally spoil before use: fraction of one pack. */
const SPOILAGE_TEMPLATES = [
  { ingredientId: 'ING-022', note: 'Romaine wilted in walk-in' },
  { ingredientId: 'ING-011', note: 'Basil blackened' },
  { ingredientId: 'ING-026', note: 'Mushrooms slimy - discarded' },
  { ingredientId: 'ING-014', note: 'Heavy cream soured' },
  { ingredientId: 'ING-021', note: 'Ricotta past quality date' },
  { ingredientId: 'ING-009', note: 'Chicken temperature abuse - discarded' },
];

/** Resolve config.demo.now into the Date when Day 60 "ends" (= demo now). */
function resolveAnchor(value = config.demo.now) {
  if (!value || value === 'now') return new Date();
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value);
  const [date, time = '18:30:00'] = value.split('T');
  return zonedToUtc(date, time);
}

/** Minute of the local day for an order, following lunch and dinner rush curves. */
function sampleMinute(rng, mix) {
  const window = (mean, sd, from, to) => {
    for (let i = 0; i < 6; i++) {
      const m = rng.normal(mean, sd);
      if (m >= from && m <= to) return Math.round(m);
    }
    return rng.int(from, to);
  };
  const roll = rng.next();
  if (roll < mix.lunch) return window(12 * 60 + 45, 32, 11 * 60 + 30, 14 * 60);
  if (roll < mix.lunch + mix.dinner) return window(19 * 60 + 15, 52, 17 * 60 + 30, 21 * 60 + 30);
  return rng.int(11 * 60, 21 * 60 + 50);
}

function generateDemoData(options = {}) {
  const seed = options.seed ?? config.demo.seed;
  const days = options.days ?? config.demo.days;
  const anchor = options.anchor ?? resolveAnchor();
  const anchorMs = anchor.getTime();

  const endDate = businessDate(anchor);
  const startDate = addDays(endDate, -(days - 1));
  const dates = Array.from({ length: days }, (_, i) => addDays(startDate, i));
  const dayIndex = new Map(dates.map((d, i) => [d, i]));
  const at = (date, time) => zonedToUtc(date, time).getTime();

  const ingredients = createIngredientCatalog().map((i) => ({ ...i, batches: [] }));
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const menu = createMenuCatalog();
  const { stories } = scenario;

  // ---------------------------------------------------------------- 1. demand
  const orderRng = createRandom(seed, 'orders');
  const saturdays = dates.filter((d) => weekdayOf(d) === stories.salesSpike.weekday);
  const spikeDate = saturdays[saturdays.length - stories.salesSpike.occurrenceFromEnd];

  const planned = [];
  dates.forEach((date, i) => {
    const weekday = weekdayOf(date);
    const weekend = weekday === 0 || weekday === 5 || weekday === 6;
    const noise = Math.max(0.75, orderRng.normal(1, scenario.dailyNoise));
    const spike = date === spikeDate ? stories.salesSpike.multiplier : 1;
    const count = Math.round(scenario.baseOrdersByWeekday[weekday] * (1 + scenario.trendPerDay * i) * noise * spike);
    const mix = weekend ? scenario.dayparts.weekend : scenario.dayparts.weekday;
    const sixAm = at(date, '06:00');
    for (let k = 0; k < count; k++) {
      const minute = sampleMinute(orderRng, mix);
      const request = createOrderRequest(orderRng, { daypart: minute < 15 * 60 ? 'lunch' : 'dinner' });
      const time = sixAm + (minute - 360) * MINUTE_MS + orderRng.int(0, 59) * 1000;
      if (time <= anchorMs) planned.push({ time, date, request });
    }
  });
  planned.sort((a, b) => a.time - b.time);

  // Expected ingredient usage per day (sales + prep inputs), used by the
  // "manager" when sizing deliveries and prep. Customers don't wait for stock.
  const usage = new Map(ingredients.map((i) => [i.id, new Array(days).fill(0)]));
  for (const order of planned) {
    const { channel, lines } = orderRules.normalizeOrder(order.request, menu);
    order.channel = channel;
    order.lines = lines;
    order.required = orderRules.computeRequirements(lines);
    const d = dayIndex.get(order.date);
    for (const [id, amount] of order.required) usage.get(id)[d] += amount;
  }
  for (const prep of ingredients.filter((i) => i.prepRecipe)) {
    usage.get(prep.id).forEach((amount, d) => {
      for (const input of prep.prepRecipe.inputs) {
        usage.get(input.ingredientId)[d] += (amount * input.quantity) / prep.prepRecipe.yield;
      }
    });
  }
  // Day 60 is only partly in the data: forecast it (and later days) from the same weekday a week earlier.
  const expectedUsage = (id, d) => {
    let k = d;
    while (k >= days - 1) k -= 7;
    return usage.get(id)[Math.max(k, 0)];
  };

  // ---------------------------------------------------------------- state + helpers
  const orders = [];
  const movements = [];
  const alerts = [];
  const activeLow = new Map();
  const counters = { order: 0, movement: 0, emergency: 0 };
  const deliveryRng = createRandom(seed, 'deliveries');

  const usable = (ing, now) => rules.getUsableQuantity(ing.batches, now);

  function recordMovement(ing, change, reason, now, date, extra = {}) {
    const movement = orderRules.buildMovement({ ingredient: ing, change, reason, now, date, ...extra });
    movements.push({ id: `MOV-${pad(++counters.movement, 6)}`, ...movement });
  }

  /** LOW_STOCK alert history, using the same rule as the live alert service. */
  function checkLowStock(ing, now) {
    const quantity = usable(ing, now);
    const active = activeLow.get(ing.id);
    if (quantity <= ing.reorderPoint && !active) {
      const alert = { id: nextId('ALERT', alerts.map((a) => a.id)), ...buildLowStockAlert(ing, quantity, now) };
      alerts.push(alert);
      activeLow.set(ing.id, alert);
    } else if (quantity <= ing.reorderPoint && active) {
      active.currentQuantity = quantity;
      active.updatedAt = new Date(now).toISOString();
    } else if (quantity > ing.reorderPoint && active) {
      Object.assign(active, resolution('Stock is back above the reorder point.', now));
      activeLow.delete(ing.id);
    }
  }

  /** Drop empty batches, but always keep the newest one so batch IDs keep increasing. */
  function prune(ing) {
    const last = ing.batches[ing.batches.length - 1];
    ing.batches = ing.batches.filter((b) => b.quantity > 0 || b === last);
  }

  function addBatch(ing, quantity, now, date) {
    const batch = {
      batchId: nextId(ing.batchPrefix, ing.batches.map((b) => b.batchId)),
      quantity,
      arrivedAt: new Date(now).toISOString(),
      expiresAt: zonedToUtc(addDays(date, ing.shelfLifeDays), '23:59:59').toISOString(),
    };
    ing.batches.push(batch);
    return batch;
  }

  /** FEFO-consume `amount` (capped at what's usable). Returns the amount taken. */
  function take(ing, amount, now) {
    const plan = rules.planFefoConsumption(ing.batches, amount, now);
    for (const a of plan.allocations) ing.batches.find((b) => b.batchId === a.batchId).quantity = a.remaining;
    prune(ing);
    return Math.min(amount, plan.available);
  }

  function deliver(ing, packs, now, date, note) {
    const quantity = packs * ing.packSize;
    const batch = addBatch(ing, quantity, now, date);
    recordMovement(ing, quantity, 'delivery', now, date, { batchId: batch.batchId, note });
    checkLowStock(ing, now);
  }

  /** Make `count` prep batches, consuming the raw inputs (buying them in an emergency if short). */
  function prepare(ing, count, now, date) {
    const { prepRecipe } = ing;
    for (const input of prepRecipe.inputs) ensure(byId.get(input.ingredientId), input.quantity * count, now, date);
    const batch = addBatch(ing, prepRecipe.yield * count, now, date);
    for (const input of prepRecipe.inputs) {
      const raw = byId.get(input.ingredientId);
      const amount = input.quantity * count;
      take(raw, amount, now);
      recordMovement(raw, -amount, 'prep_usage', now, date, { note: `Used for ${ing.name} batch ${batch.batchId}` });
      checkLowStock(raw, now);
    }
    recordMovement(ing, batch.quantity, 'prep_production', now, date, { batchId: batch.batchId, note: `${count} x ${prepRecipe.yield} ${ing.unit}` });
    checkLowStock(ing, now);
  }

  /** Make sure `amount` is usable right now (emergency purchase / extra prep if not). */
  function ensure(ing, amount, now, date) {
    const missing = amount - usable(ing, now);
    if (missing <= 0) return;
    counters.emergency++;
    if (ing.prepRecipe) {
      prepare(ing, Math.ceil(missing / ing.prepRecipe.yield), now, date);
    } else {
      const extra = expectedUsage(ing.id, dayIndex.get(date)) * 0.5;
      deliver(ing, Math.ceil((missing + extra) / ing.packSize), now, date, 'Emergency purchase (Restaurant Depot run)');
    }
  }

  /** Days (as indexes) this delivery must cover: today until the day before the next delivery. */
  function coverDays(ing, d) {
    const weekday = weekdayOf(dates[d]);
    let gap = 1;
    while (!ing.deliveryDays.includes((weekday + gap) % 7)) gap++;
    return Array.from({ length: gap }, (_, k) => d + k);
  }

  // ---------------------------------------------------------------- 2. replay the days
  const wasteRng = createRandom(seed, 'waste');
  const countRng = createRandom(seed, 'counts');
  const tuesdays = dates.filter((d) => weekdayOf(d) === 2 && at(d, '09:00') <= anchorMs);
  const overstockDate = tuesdays[tuesdays.length - stories.overstock.occurrenceFromEnd];
  let lastStoryDelivery = null;
  let orderCursor = 0;

  // Opening count the morning before Day 1 (stock on hand when the history starts).
  const openingTime = at(startDate, '05:30');
  for (const ing of ingredients.filter((i) => !i.prepRecipe)) {
    const cycle = coverDays(ing, 0).reduce((sum, d) => sum + expectedUsage(ing.id, d), 0);
    const packs = Math.ceil((cycle * 1.05 + ing.reorderPoint * 1.3) / ing.packSize);
    const batch = addBatch(ing, packs * ing.packSize, openingTime, addDays(startDate, -1));
    recordMovement(ing, batch.quantity, 'manual_count', openingTime, startDate, { batchId: batch.batchId, note: 'Opening inventory count' });
  }

  dates.forEach((date, d) => {
    const weekday = weekdayOf(date);
    const events = [];
    const add = (time, priority, run) => { if (time <= anchorMs) events.push({ time, priority, run }); };

    // 06:00 - discard anything that expired overnight.
    add(at(date, '06:00'), 0, (now) => {
      for (const ing of ingredients) {
        for (const batch of ing.batches) {
          if (batch.quantity > 0 && rules.isExpired(batch, now)) {
            const quantity = batch.quantity;
            batch.quantity = 0;
            recordMovement(ing, -quantity, 'spoilage', now, date, { batchId: batch.batchId, note: `Batch ${batch.batchId} expired - discarded` });
          }
        }
        prune(ing);
        checkLowStock(ing, now);
      }
    });

    // Supplier deliveries, sized to last until the next delivery plus a safety buffer.
    for (const ing of ingredients.filter((i) => !i.prepRecipe && i.deliveryDays.includes(weekday))) {
      add(at(date, SUPPLIER_TIMES[ing.supplier] || '08:00'), 1, (now) => {
        const forecast = coverDays(ing, d).reduce((sum, k) => sum + expectedUsage(ing.id, k), 0) * deliveryRng.float(0.95, 1.15);
        let packs = Math.max(0, Math.ceil((forecast + ing.reorderPoint * 1.3 - usable(ing, now)) / ing.packSize));
        let note = packs ? `${packs} x ${ing.packLabel} from ${ing.supplier}` : null;
        if (ing.id === stories.overstock.ingredientId && date === overstockDate) {
          packs += stories.overstock.extraPacks;
          note = `${packs} x ${ing.packLabel} from ${ing.supplier} - ${stories.overstock.note}`;
        }
        if (packs > 0) {
          deliver(ing, packs, now, date, note);
          if (ing.id === stories.lowStock.ingredientId) lastStoryDelivery = movements[movements.length - 1];
        }
      });
    }

    // Prep: in the morning for the whole day, then a top-up before dinner.
    for (const ing of ingredients.filter((i) => i.prepRecipe)) {
      add(at(date, '10:00'), 2, (now) => {
        const need = expectedUsage(ing.id, d) * deliveryRng.float(1.05, 1.2) + ing.reorderPoint - usable(ing, now);
        if (need > 0) prepare(ing, Math.ceil(need / ing.prepRecipe.yield), now, date);
      });
      add(at(date, '16:30'), 2, (now) => {
        const need = expectedUsage(ing.id, d) * 0.6 + ing.reorderPoint - usable(ing, now);
        if (need > 0) prepare(ing, Math.ceil(need / ing.prepRecipe.yield), now, date);
      });
    }

    // Customer orders.
    while (orderCursor < planned.length && planned[orderCursor].date === date) {
      const order = planned[orderCursor++];
      add(order.time, 3, (now) => {
        for (const [id, amount] of order.required) ensure(byId.get(id), amount, now, date);
        const { plans } = orderRules.planRequirements(order.required, byId, now);
        for (const { ingredient, plan } of plans) {
          for (const a of plan.allocations) ingredient.batches.find((b) => b.batchId === a.batchId).quantity = a.remaining;
        }
        const record = { id: `ORD-${pad(++counters.order, 5)}`, ...orderRules.buildOrderRecord({ channel: order.channel, lines: order.lines, plans, now, date }) };
        orders.push(record);
        for (const { ingredient, amount } of plans) {
          prune(ingredient);
          recordMovement(ingredient, -amount, 'sale', now, date, { orderId: record.id });
          checkLowStock(ingredient, now);
        }
      });
    }

    // Kitchen waste during service.
    const wasteCount = wasteRng.int(...scenario.wasteEventsPerDay);
    for (let w = 0; w < wasteCount; w++) {
      const template = wasteRng.weighted(WASTE_TEMPLATES.map((t) => [t, t.weight]));
      const amounts = template.items.map(([id, min, max]) => [id, wasteRng.int(min, max)]);
      const minute = wasteRng.int(11 * 60 + 30, 21 * 60 + 30);
      add(at(date, '06:00') + (minute - 360) * MINUTE_MS, 4, (now) => {
        for (const [id, amount] of amounts) {
          const ing = byId.get(id);
          const taken = take(ing, amount, now);
          if (taken > 0) {
            recordMovement(ing, -taken, 'waste', now, date, { note: template.note });
            checkLowStock(ing, now);
          }
        }
      });
    }

    // Occasionally a perishable spoils before it can be used.
    if (wasteRng.chance(scenario.spoilageChancePerDay)) {
      const template = wasteRng.pick(SPOILAGE_TEMPLATES);
      const fraction = wasteRng.float(0.15, 0.45);
      add(at(date, wasteRng.pick(['09:45', '15:30', '22:15'])), 4, (now) => {
        const ing = byId.get(template.ingredientId);
        const taken = take(ing, Math.max(1, Math.round(ing.packSize * fraction)), now);
        if (taken > 0) {
          recordMovement(ing, -taken, 'spoilage', now, date, { note: template.note });
          checkLowStock(ing, now);
        }
      });
    }

    // Sunday night: partial stock count; small differences are booked as manual_count.
    if (weekday === 0) {
      const picks = [];
      while (picks.length < scenario.weeklyCountSize) {
        const ing = countRng.pick(ingredients);
        if (!picks.includes(ing)) picks.push(ing);
      }
      const variances = picks.map(() => countRng.normal(0, 0.012));
      add(at(date, '22:30'), 5, (now) => {
        picks.forEach((ing, idx) => {
          const system = usable(ing, now);
          const physical = Math.max(0, Math.round(system * (1 + variances[idx])));
          const change = physical - system;
          if (change === 0) return;
          if (change > 0) {
            const newest = rules.getUsableBatches(ing.batches, now).sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
            if (!newest) return;
            newest.quantity += change;
          } else {
            take(ing, -change, now);
          }
          recordMovement(ing, change, 'manual_count', now, date, { note: `Weekly count: counted ${physical} ${ing.unit}, system showed ${system}` });
          checkLowStock(ing, now);
        });
      });
    }

    // Two bookkeeping corrections over the period.
    if (d === 19) {
      add(at(date, '11:05'), 5, (now) => {
        const ing = byId.get('ING-008');
        const batch = addBatch(ing, ing.packSize, now, date);
        recordMovement(ing, ing.packSize, 'correction', now, date, { batchId: batch.batchId, note: 'Correction: tin received Tuesday but not entered' });
      });
    }
    if (d === 43) {
      add(at(date, '10:20'), 5, (now) => {
        const ing = byId.get('ING-012');
        const taken = take(ing, 12, now);
        recordMovement(ing, -taken, 'correction', now, date, { note: 'Correction: half case double-entered on last delivery' });
        checkLowStock(ing, now);
      });
    }

    events.sort((a, b) => a.time - b.time || a.priority - b.priority);
    for (const event of events) event.run(new Date(event.time));
  });

  // ---------------------------------------------------------------- 3. story: short-shipped mozzarella
  const lowStory = byId.get(stories.lowStock.ingredientId);
  const lowStoryInfo = { ingredient_id: lowStory.id, ingredient: lowStory.name };
  if (lastStoryDelivery) {
    const now = anchor;
    const excess = usable(lowStory, now) - (lowStory.reorderPoint + stories.lowStock.targetAboveMinimum);
    const batch = lowStory.batches.find((b) => b.batchId === lastStoryDelivery.batch_id);
    const packs = Math.min(Math.ceil(excess / lowStory.packSize), Math.floor(batch.quantity / lowStory.packSize));
    if (packs > 0) {
      // The supplier delivered fewer cases than ordered: shrink that delivery and
      // shift the running balance of every later mozzarella movement.
      const removed = packs * lowStory.packSize;
      batch.quantity -= removed;
      const ordered = lastStoryDelivery.change / lowStory.packSize;
      lastStoryDelivery.change -= removed;
      lastStoryDelivery.note = `${ordered - packs} of ${ordered} x ${lowStory.packLabel} delivered - ${stories.lowStock.note}`;
      const from = movements.indexOf(lastStoryDelivery);
      for (let i = from; i < movements.length; i++) {
        if (movements[i].ingredient_id === lowStory.id) movements[i].balance_after -= removed;
      }
      Object.assign(lowStoryInfo, { short_shipped_on: lastStoryDelivery.business_date, cases_missing: packs });
    }
  }

  // Keep the inventory listing readable: drop empty batches (newest is kept for IDs).
  ingredients.forEach(prune);

  const spikeOrders = orders.filter((o) => o.business_date === spikeDate).length;
  const meta = {
    seed,
    days,
    timezone: config.restaurant.timezone,
    start_date: startDate,
    end_date: endDate,
    now: anchor.toISOString(),
    now_local: `${endDate} ${localTime(anchor)}`,
    emergency_purchases: counters.emergency,
    stories: {
      low_stock: { ...lowStoryInfo, minimum_stock: lowStory.reorderPoint, current_stock: usable(lowStory, anchor), unit: lowStory.unit },
      overstock: { ingredient_id: stories.overstock.ingredientId, ingredient: byId.get(stories.overstock.ingredientId).name, bulk_delivery_on: overstockDate, extra_packs: stories.overstock.extraPacks },
      sales_spike: { date: spikeDate, orders: spikeOrders, note: stories.salesSpike.note },
      channel_fees: { note: 'Uber Eats / DoorDash: large gross, 25-30% commission' },
      best_seller: { item_id: 'pizza_margherita', name: 'Margherita Pizza' },
    },
  };

  return { inventory: ingredients, menu, orders, movements, alerts, meta };
}

module.exports = { generateDemoData, resolveAnchor };

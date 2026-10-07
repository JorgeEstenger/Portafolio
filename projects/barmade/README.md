# BarMade Backend (Prototype)

Inventory and sales API for a fictional Italian restaurant, built with **Node.js + Express**.
It ships with a **deterministic 60-day synthetic history** (about 7,300 orders and 71,000 inventory
movements) so the dashboard, alerts and recommendations have realistic data to show.

What it does:

- Turns every order into ingredient usage with **recipes** (including modifiers like extra cheese).
- Checks stock **before** changing anything, then deducts it using **FEFO** (First Expired, First Out).
- Writes an auditable **inventory movement** for every stock change (sale, delivery, waste, spoilage, count, correction, prep).
- Raises **LOW_STOCK**, **PREDICTED_RUNOUT**, **EXPIRING_SOON** and **EXPIRED** alerts, without duplicates.
- Reports sales by day, menu item and **order channel** (dine-in, takeout, website, Uber Eats, DoorDash, BarMade), with channel fees.
- Gives **overstock**, **specials** and **restock** recommendations from simple, explainable formulas. No AI is involved in any calculation.

Every route that existed before still exists and still accepts the same requests.

---

## Run locally

Requirements: Node.js 18 or newer (developed on Node 24).

```bash
npm install
npm start          # http://localhost:3000  (PORT to change)
npm run dev        # restart on file changes
npm test           # node:test suites, no extra dependencies
```

On startup the server generates the 60-day dataset (about 1 s) and prints a summary:

```
Loaded demo dataset: 7319 orders, 71569 movements, 3 active alert(s).
BarMade API running at http://localhost:3000 (business date 2026-10-07)
```

### Reset / reseed the demo data

```bash
curl -X POST http://localhost:3000/api/demo/reset
```

This reloads exactly the same orders, inventory, deliveries, waste, alerts and planted stories
every time. Restarting the server also resets the data, because it is held in memory. `GET /api/demo`
shows what is loaded: seed, date range, planted-story dates and record counts.

### The demo clock

The history ends at **Wednesday 2026-10-07, 6:30 PM New York time** ("Day 60", in the middle of the dinner rush).
After a reset, the API clock starts at that moment and then advances in real time, so
live orders always follow the history, whatever today's real date is. Every response that depends on
the date says which business date it used (`date`, `business_date`, `as_of`). The frontend should
read the date from these fields and not from the browser clock.

### Environment variables (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DEMO_DATASET` | `demo` | `demo` = 60-day dataset, `classic` = the original 12-ingredient fixture |
| `DEMO_SEED` | `20261007` | Random seed. Same seed = same dataset |
| `DEMO_DAYS` | `60` | Days of history |
| `DEMO_NOW` | `2026-10-07T18:30:00` | End of the history, in restaurant local time (or ISO with offset). `now` = the real current time |
| `RESTAURANT_TIMEZONE` | `America/New_York` | Used for business dates and the lunch/dinner patterns |
| `CHANNEL_FEES` | see below | JSON override, e.g. `{"uber_eats":0.28}` |
| `USAGE_WINDOW_DAYS` | `14` | History used for average daily usage |
| `OVERSTOCK_FACTOR` | `1.75` | Overstock when days of cover > target x factor |
| `RESTOCK_HORIZON_DAYS` | `7` | Restock covers this many days (capped at shelf life) |
| `SAFETY_STOCK_DAYS` | `2` | Safety stock, in days of average usage |
| `MOCK_NOW` | (unset) | Freeze the clock at a fixed time (the original option, still supported) |
| `FIRESTORE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` | (unset) | Optional Firestore persistence, see [PERSISTENCE.md](PERSISTENCE.md). The 60-day dataset is in-memory only |

Default channel fees (mock values, in [config/index.js](config/index.js)): dine_in 0%, takeout 0%,
website 2.9%, barmade 5%, uber_eats 30%, doordash 25%.

---

## API endpoints

Original routes (unchanged; some responses gained extra fields):

| Method | Path | Description |
|---|---|---|
| GET | `/api/inventory` | All ingredients with `totalQuantity`, `expiredQuantity`, `status`, batches. Optional `?status=LOW_STOCK` |
| GET | `/api/inventory/:id` | One ingredient. Accepts the ID (`ING-002`) or key (`mozzarella`) |
| POST | `/api/inventory/restock` | Add a batch (now also writes a `delivery` movement) |
| GET | `/api/menu`, `/api/menu/:id` | Menu with recipes (now 17 items, with `key`, `category`, `modifierIds`) |
| GET | `/api/orders` | Orders, newest first. **Now paginated**: `?limit=100&offset=0`, plus `?date=`, `?from=`, `?to=`, `?channel=`. `count` = rows returned, `total` = all matches |
| POST | `/api/orders` | Create an order (legacy or canonical body, see below) |
| GET | `/api/alerts` | Alerts. `?type=LOW_STOCK\|PREDICTED_RUNOUT\|EXPIRING_SOON\|EXPIRED`, `?status=ACTIVE\|RESOLVED` |
| POST | `/api/alerts/check-expiration` | Run the expiration + stock checks now |

New routes:

| Method | Path | Description |
|---|---|---|
| GET | `/api/orders/:id` | One order |
| GET | `/api/inventory/movements` | Movement log, newest first. `?ingredient_id=`, `?reason=`, `?order_id=`, `?date=`, `?from=`, `?to=`, `?limit=`, `?offset=` |
| GET | `/api/inventory/forecast` | Per ingredient: average daily usage, days of cover, predicted run-out date, next delivery, status. `?status=RUNOUT_RISK\|OVERSTOCK\|OK` |
| POST | `/api/inventory/delivery` | Receive stock: `{ ingredient_id, quantity, unit?, expires_at?, supplier?, note? }` |
| POST | `/api/inventory/waste` | `{ ingredient_id, quantity, unit?, reason: "waste"\|"spoilage", batch_id?, note? }` |
| POST | `/api/inventory/adjustments` | `{ ingredient_id, reason: "manual_count", counted_quantity }` or `{ ingredient_id, reason: "correction", change }` |
| POST | `/api/inventory/prep` | Make a prep batch from raw ingredients: `{ ingredient_id: "pizza_dough", batches: 1 }` |
| GET | `/api/recipes`, `/api/recipes/:id` | Recipes per menu item (direct and expanded to raw ingredients), prep recipes, modifiers |
| GET | `/api/dashboard/today` | Today's sales, top items, channels, hourly orders, inventory counts, active alerts. `?date=` for another day |
| GET | `/api/dashboard/sales?days=60` | Daily orders/revenue/fees/net, item and channel totals, SPIKE/DIP anomalies |
| GET | `/api/dashboard/channels?days=30` | Orders, gross, fees, net and margin per channel |
| GET | `/api/dashboard/items?days=30` | Quantity and revenue per menu item |
| GET | `/api/recommendations` | Run-out risks, overstock, and specials to promote |
| GET | `/api/restock` | Weekly purchase suggestions (whole packs) plus tomorrow's prep plan |
| POST | `/api/simulate/rush` | Burst of 20–50 dinner orders through the normal order pipeline. `{ orders?: 1-100, channel? }` |
| GET | `/api/demo` | Dataset info, planted stories, counts, demo clock |
| POST | `/api/demo/reset` | Reload the deterministic 60-day dataset |

Field naming: the original resources keep their camelCase fields (`ingredientId`, `reorderPoint`, …).
New fields and new endpoints use snake_case, matching the workflow spec (`gross_total`, `channel_fee`, …).
Alerts include both, for example `ingredientId` and `ingredient_id`.

---

## Example requests

```bash
B=http://localhost:3000

# Demo control
curl -X POST $B/api/demo/reset
curl $B/api/demo

# Dashboard
curl $B/api/dashboard/today
curl "$B/api/dashboard/sales?days=60"
curl "$B/api/dashboard/channels?days=30"

# Inventory
curl $B/api/inventory/mozzarella
curl "$B/api/inventory/movements?ingredient_id=mozzarella&limit=20"
curl "$B/api/inventory/forecast?status=RUNOUT_RISK"

# Canonical order (channel, item keys, modifiers)
curl -X POST $B/api/orders -H "Content-Type: application/json" \
  -d '{"channel":"uber_eats","items":[{"item_id":"pizza_margherita","qty":3,"modifiers":["extra_cheese"]}]}'

# Legacy order body still works (channel defaults to dine_in)
curl -X POST $B/api/orders -H "Content-Type: application/json" \
  -d '{"items":[{"menuItemId":"MENU-002","quantity":3}]}'

# Stock changes
curl -X POST $B/api/inventory/delivery -H "Content-Type: application/json" \
  -d '{"ingredient_id":"mozzarella","quantity":20,"unit":"kg"}'
curl -X POST $B/api/inventory/waste -H "Content-Type: application/json" \
  -d '{"ingredient_id":"basil","quantity":30,"reason":"waste","note":"Bruised leaves"}'
curl -X POST $B/api/inventory/adjustments -H "Content-Type: application/json" \
  -d '{"ingredient_id":"olive_oil","reason":"manual_count","counted_quantity":11000}'
curl -X POST $B/api/inventory/prep -H "Content-Type: application/json" \
  -d '{"ingredient_id":"pizza_dough","batches":1}'

# Recommendations, restock, rush
curl $B/api/recommendations
curl $B/api/restock
curl -X POST $B/api/simulate/rush -H "Content-Type: application/json" -d '{}'
```

(PowerShell: use `curl.exe` and single-quote the JSON, or `Invoke-RestMethod`.)

## Example responses (trimmed, from a fresh reset)

`POST /api/orders` with 3 x Margherita + extra cheese via Uber Eats, `201`:

```json
{
  "message": "Order ORD-07320 created.",
  "data": {
    "id": "ORD-07320",
    "status": "COMPLETED",
    "channel": "uber_eats",
    "placed_at": "2026-10-07T22:30:04.900Z",
    "business_date": "2026-10-07",
    "items": [{ "menuItemId": "MENU-001", "item_id": "pizza_margherita", "name": "Margherita Pizza",
                "quantity": 3, "modifiers": ["extra_cheese"], "unitPrice": 17.99, "lineTotal": 53.97 }],
    "total": 53.97, "gross_total": 53.97, "channel_fee_rate": 0.3, "channel_fee": 16.19, "net_total": 37.78,
    "consumed": [ { "ingredientId": "ING-002", "ingredientName": "Mozzarella Cheese", "unit": "g", "quantity": 675,
                    "batches": [{ "batchId": "MZ-026", "quantity": 675 }] } ]
  },
  "movements": [
    { "id": "MOV-071572", "ingredient_id": "ING-002", "ingredient": "Mozzarella Cheese", "change": -675, "unit": "g",
      "reason": "sale", "order_id": "ORD-07320", "timestamp": "2026-10-07T22:30:04.900Z",
      "business_date": "2026-10-07", "balance_after": 8706 }
  ],
  "alertsCreated": [],
  "alertsResolved": []
}
```

A low-stock alert as it appears in `alertsCreated` and `GET /api/alerts`:

```json
{
  "id": "ALERT-018", "type": "LOW_STOCK", "status": "ACTIVE", "severity": "high",
  "ingredientId": "ING-002", "ingredientName": "Mozzarella Cheese",
  "currentQuantity": 7506, "reorderPoint": 8000, "unit": "g",
  "ingredient_id": "ING-002", "ingredient": "Mozzarella Cheese", "current_stock": 7506, "minimum_stock": 8000,
  "display": { "current_stock": "7.51 kg" },
  "message": "Mozzarella Cheese is running low.", "createdAt": "2026-10-07T22:30:05.000Z"
}
```

`GET /api/dashboard/today`:

```json
{
  "date": "2026-10-07", "weekday": "Wednesday", "timezone": "America/New_York", "is_today": true,
  "sales": { "orders": 56, "items_sold": 217, "gross_revenue": 2796.83, "channel_fees": 256.32,
             "net_revenue": 2540.51, "average_order_value": 49.94 },
  "vs_same_time_last_week": { "date": "2026-09-30", "orders": 58, "orders_change_pct": -3.4 },
  "top_items": [{ "item_id": "pizza_margherita", "name": "Margherita Pizza", "quantity": 29, "revenue": 471.71 }],
  "channels": [{ "channel": "uber_eats", "fee_rate": 0.3, "orders": 12, "gross": 554.61, "fees": 166.38,
                 "net": 388.23, "net_margin_pct": 70 }],
  "hourly": [{ "hour": 12, "label": "12:00", "orders": 24, "gross": 1192.09 }],
  "inventory": { "ingredients": 30, "low_stock_count": 0, "out_of_stock_count": 0, "overstock_count": 1,
                 "runout_risk_count": 1, "expiring_soon_count": 2 },
  "active_alerts": [{ "type": "PREDICTED_RUNOUT", "ingredient": "Mozzarella Cheese", "severity": "warning" }]
}
```

`GET /api/recommendations` (specials part):

```json
{
  "ingredient": "Tomato Sauce",
  "reason": "14.3 days of inventory vs 7-day target",
  "excess_quantity": 262822, "unit": "ml", "display": { "excess_quantity": "262.82 L" },
  "recommended_items": ["Spaghetti Marinara", "Spaghetti & Meatballs", "Penne alla Vodka"],
  "excluded": [{ "name": "Margherita Pizza", "reason": "needs Mozzarella Cheese (low stock)" }]
}
```

`GET /api/restock` (one line):

```json
{
  "ingredient_id": "ING-002", "ingredient": "Mozzarella Cheese", "supplier": "Bella Dairy", "unit": "g",
  "current_stock": 7506, "average_daily_usage": 21395.36, "horizon_days": 7,
  "expected_usage": 149768, "safety_stock": 42791, "suggested_order": 187500, "suggested_packs": 75,
  "pack": "2.5 kg block", "status": "RUNOUT_RISK",
  "formula": "149768 expected + 42791 safety - 7506 on hand = 185053 g -> 75 pack(s)",
  "display": { "current_stock": "7.51 kg", "suggested_order": "187.5 kg" }
}
```

`POST /api/simulate/rush`:

```json
{
  "rush_number": 1, "orders_created": 37, "orders_rejected": 0, "items_sold": 127,
  "gross_revenue": 1737.73, "channel_fees": 242.69, "net_revenue": 1495.04,
  "inventory_movements_created": 376, "new_alerts": 1,
  "low_stock_now": ["Mozzarella Cheese", "San Pellegrino"],
  "inventory_changes": [{ "ingredient": "Mozzarella Cheese", "before": 7506, "after": 2166, "display": "7.51 kg -> 2.17 kg" }]
}
```

---

## How a normal order depletes inventory

`POST /api/orders` runs this pipeline ([services/orderService.js](services/orderService.js)). The pure steps are in
[services/orderRules.js](services/orderRules.js), and the 60-day generator and the rush simulator use the same functions.

1. **Normalize.** The legacy body `{menuItemId, quantity}` and the canonical body `{channel, item_id, qty, modifiers}`
   become one internal shape. Unknown channel, item or modifier: `400`/`404`.
2. **Recipe.** For each line, recipe quantity x quantity sold, with modifiers applied
   (`extra_cheese` adds 75 g mozzarella per item, `no_cheese` removes it), summed per ingredient.
   3 x Margherita = 3 dough balls, 600 ml sauce, 450 g mozzarella, 15 g basil, 30 ml olive oil.
3. **Check stock.** FEFO plan for every ingredient using only non-expired batches. If *anything* is short: `409`, nothing changes.
4. **Deduct.** All batch changes are applied together.
5. **Save the order** with `gross_total`, `channel_fee` (gross x channel rate) and `net_total`.
6. **Movements.** One `sale` movement per ingredient (`change` is negative, with `balance_after`).
7. **Alerts.** LOW_STOCK (stock ≤ minimum) and PREDICTED_RUNOUT checks for the ingredients used.

The frontend never calculates consumption. The dashboard has no separate statistics table to update: it is computed
from the order and movement logs on each request, so it always matches them.

Units: everything is stored in a base unit: grams, millilitres, or a count (units/slices/cans/bottles).
Other units (`kg`, `lb`, `L`, `gal`, …) are converted at the API edge ([utils/units.js](utils/units.js)).
Impossible conversions such as gallons into grams are rejected. `display` fields format quantities for people ("7.51 kg").

Time: timestamps are UTC ISO strings. Reports group by **business date**, which is the calendar date in `RESTAURANT_TIMEZONE`.

## Forecasts and recommendations (plain arithmetic)

Formulas live in [services/forecastRules.js](services/forecastRules.js):

- **Average daily usage** = (sale + prep_usage + waste) over the last 14 complete business days / 14.
- **Days remaining / days of cover** = current stock / average daily usage.
- **Predicted run-out**: there is a risk when stock is below the usage expected before the next scheduled delivery
  (the rest of today's service plus each full day until the delivery morning). This creates a `PREDICTED_RUNOUT` alert (severity `warning`).
- **Overstock**: days of cover > target days x 1.75 (for example tomato sauce: 14.3 days vs a 7-day target).
- **Specials**: for an overstocked ingredient, menu items that use it (also through prep items), ranked by amount used per serving,
  then by recent sales. Dishes that need a low/at-risk ingredient are excluded, since the kitchen can't promote what it can't make.
- **Restock** = expected usage over 7 days (or the shelf life, if shorter) + 2 days of safety stock − current stock,
  rounded up to whole packs. Prep items get a prep plan instead (tomorrow's usage + minimum − on hand, in whole batches).

## How the 60-day dataset is generated

[data/demo/generator.js](data/demo/generator.js) with the settings in [data/demo/scenario.js](data/demo/scenario.js) and the
catalog in [data/demo/catalog.js](data/demo/catalog.js). The catalog extends the original 12 ingredients and 5 menu items
(same IDs and recipes) to 30 ingredients, including 3 prep items (pizza dough, alfredo sauce, meatballs), and 17 menu items.

1. **Demand.** For each day, the order count = weekday base (Mon ≈ 86 … Sat ≈ 162) x slow growth trend x random noise.
   Order times follow lunch (11:30–14:00) and dinner (17:30–21:30) rush curves, with a few off-peak orders.
   Each order is built by [data/demo/orderFactory.js](data/demo/orderFactory.js): channel mix by daypart, bigger baskets on
   delivery apps, weighted dish popularity (Margherita the clear best seller), drinks, desserts and modifiers.
2. **Replay.** Each day is replayed as time-ordered events, using the same order rules as the live API:
   06:00 expired batches discarded (`spoilage`) → supplier deliveries on each ingredient's delivery days, sized to last until the
   next delivery plus a buffer (`delivery`) → 10:00 and 16:30 prep (`prep_production` / `prep_usage`) → customer orders (`sale`) →
   1–4 kitchen waste events and occasional spoiled produce (`waste` / `spoilage`) → Sunday-night partial counts (`manual_count`)
   → two bookkeeping fixes (`correction`). Stock never goes negative; if it would, the generator records an emergency purchase
   (there are none with the default seed). LOW_STOCK alerts raised and resolved during the 60 days are kept as history.
3. **Planted stories** (exact dates in `GET /api/demo`):
   - **Low stock**: Day 60's mozzarella delivery was short-shipped, leaving ~9.4 kg against an 8 kg minimum. A few
     pizza orders or one rush crosses it. A `PREDICTED_RUNOUT` warning is already active at reset.
   - **Overstock**: yesterday's tomato sauce delivery included a bulk deal, giving ~14 days of cover vs a 7-day target.
   - **Channel fees**: Uber Eats has the largest delivery gross but keeps only ~70% of it.
   - **Best seller**: Margherita Pizza (~3,300 sold vs ~2,350 Pepperoni).
   - **Sales spike**: Saturday 2026-09-19 (street festival), ~46% above a normal Saturday, flagged as `SPIKE`.

Determinism: a seeded PRNG ([utils/random.js](utils/random.js)) with separate streams for orders, waste, deliveries and counts.
The same seed always yields the same data, and the Nth rush after a reset is always the same rush.

---

## Project structure

```
├── config/index.js         # timezone, channel fees, demo + forecast settings (env overridable)
├── data/
│   ├── inventory.js, menu.js, orders.js, alerts.js   # original "classic" fixture (unchanged)
│   ├── demo/
│   │   ├── catalog.js      #   30 ingredients, 17 menu items, prep recipes, modifiers (extends the originals)
│   │   ├── scenario.js     #   demand pattern + planted stories
│   │   ├── orderFactory.js #   realistic random order requests (generator + rush)
│   │   └── generator.js    #   deterministic 60-day history
│   ├── store.js            # in-memory collections + resetStore('demo' | 'classic')
│   └── persistence.js      # optional Firestore transactions
├── repositories/           # data access - the only code that touches data/store.js
│   └── inventory/menu/order/alert/movementRepository.js
├── services/
│   ├── stockRules.js       #   pure: FEFO, batch/stock status
│   ├── orderRules.js       #   pure: normalize, recipes, pricing, records
│   ├── alertRules.js       #   pure: alert shapes
│   ├── forecastRules.js    #   pure: usage, run-out, overstock, restock, specials
│   ├── orderService, inventoryService, alertService, menuService, recipeService
│   ├── forecastService, dashboardService, simulationService, demoService
├── controllers/, routes/   # HTTP layer (reportRoutes = dashboard/recipes/recommendations/restock/simulate/demo)
├── utils/                  # clock (+ demo clock), timezone, units, random, ids, dates, AppError
├── tests/                  # api + persistence + stockRules (classic fixture), demo + rules (new)
├── app.js, server.js
```

**Request flow:** `route → controller → service → repository → data/store`

### Datasets

- `demo` (default): the 60-day dataset above.
- `classic`: the original fixture (12 ingredients, 5 menu items, 2 orders, dough 8 orders from LOW_STOCK).
  The original tests use it, and it is the Firestore seed. Start with `DEMO_DATASET=classic npm start` to use it.

### Swapping in a real database

Repositories are `async` and return copies, like a database driver. To move to MongoDB or PostgreSQL,
rewrite the files in `repositories/` with the same function names. `findSummaries` and `sumConsumption` map to
a column projection and a `GROUP BY`. Two places mark where a database would use a **transaction**:
`inventoryRepository.setBatchQuantities` (all-or-nothing update) and the `runExclusive` queue in `orderService.js`.

---

## Status values

- Ingredient `status`: `IN_STOCK`, `LOW_STOCK` (total ≤ reorderPoint), `OUT_OF_STOCK` (total = 0)
- Forecast `status`: `OK`, `RUNOUT_RISK`, `OVERSTOCK`, `NO_RECENT_USAGE`
- Batch `status`: `FRESH`, `EXPIRING_SOON` (≤ 48 h left), `EXPIRED`, `DEPLETED` (quantity 0)
- Alert `status`: `ACTIVE`, `RESOLVED`. Alert `severity`: `critical` (out of stock), `high` (low stock, expired), `warning` (run-out risk, expiring soon)
- Movement `reason`: `sale`, `delivery`, `waste`, `spoilage`, `manual_count`, `correction`, `prep_production`, `prep_usage` (positive change = stock in, negative = stock out)

## Errors

All errors share one shape:

```json
{ "error": { "code": "INSUFFICIENT_INVENTORY", "message": "...", "details": { } } }
```

| Status | When | Codes |
|---|---|---|
| 400 | Bad input | `VALIDATION_ERROR`, `INVALID_QUANTITY`, `MISSING_EXPIRATION_DATE`, `INVALID_DATE`, `EXPIRED_INVENTORY`, `INVALID_JSON`, `INVALID_ALERT_TYPE`, `INVALID_STATUS`, `INVALID_CHANNEL`, `INVALID_MODIFIER`, `INVALID_UNIT`, `INVALID_REASON`, `NOT_A_PREP_ITEM` |
| 404 | Unknown resource | `INGREDIENT_NOT_FOUND`, `MENU_ITEM_NOT_FOUND`, `ORDER_NOT_FOUND`, `BATCH_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | Not enough usable stock / unavailable | `INSUFFICIENT_INVENTORY` (each shortage says `INSUFFICIENT_STOCK` or `EXPIRED_STOCK_NOT_USABLE`), `DEMO_RESET_UNAVAILABLE` |
| 500 | Unexpected / bad recipe data | `INTERNAL_SERVER_ERROR`, `RECIPE_DATA_ERROR` |

## How FEFO works

**First Expired, First Out**: the batch closest to expiring is used first, so less food is thrown away.
For each ingredient (`services/stockRules.js → planFefoConsumption`):

1. Drop batches that are **expired** or **empty**.
2. Sort the rest by `expiresAt` (soonest first; ties → earliest `arrivedAt`).
3. Take from each batch until the required amount is covered.

A batch never goes below 0: the plan only takes `min(batch quantity, still needed)`,
and the repository rejects any negative value as a safety net.

## How alerts work

- **LOW_STOCK**: after every order or stock change, usable stock is compared with `reorderPoint` (the minimum).
  At or below it with no active alert, one is created. If an alert is already active, its `currentQuantity` is updated instead
  of duplicating it. When stock goes back above the minimum, the alert is `RESOLVED`.
- **PREDICTED_RUNOUT**: same lifecycle, based on the run-out rule above.
- **EXPIRING_SOON / EXPIRED**: `checkExpirations()` runs on startup / reset, after every delivery, and on
  `POST /api/alerts/check-expiration`. There is one active alert per batch per type. Expired stock is never used for orders.

There's no scheduler yet, so run the manual endpoint (or add a cron job later) to re-check expirations over time.

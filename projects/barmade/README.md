# BarMade Backend (Prototype)

## Persistent storage

Firestore persistence is available: set `FIRESTORE_PROJECT_ID` and the private `FIREBASE_SERVICE_ACCOUNT_JSON` in Render. See [PERSISTENCE.md](PERSISTENCE.md). Mocks are seeded only once when the database is initialized. Orders, inventory, and alerts then survive process restarts. Without these environment variables, the in-memory behavior described below still applies.


Inventory management API for an Italian restaurant, built with **Node.js + Express**.
Everything runs on **in-memory mock data** — no database yet — but the code is layered
so a database can be dropped in later without touching the business logic.

What it does:

- Tracks ingredients as **batches** (each with its own arrival and expiration date).
- Turns menu orders into ingredient usage via **recipes**.
- Checks that there is enough stock **before** changing anything, then subtracts it using **FEFO** (First Expired, First Out).
- Never uses **expired** stock for orders.
- Raises **LOW_STOCK**, **EXPIRING_SOON** and **EXPIRED** alerts, without duplicates.

---

## Requirements

- Node.js 18 or newer (developed on Node 24)

## Install

```bash
cd projects/barmade
npm install
```

## Run

```bash
npm start
```

On Windows PowerShell, use `npm.cmd install`, `npm.cmd start`, and `npm.cmd test` if script execution is disabled.

The API listens on `http://localhost:3000` (set `PORT` to change it).
`npm run dev` restarts the server automatically when files change.

> **Data resets on every restart.** Mock data lives in memory.

### About the mock dates

The mock inventory dates are generated **relative to today**, so the demo looks the
same whichever day you run it (some batches expire soon, one basil batch is already
expired, pizza dough is close to its reorder point). To pin "today" to a fixed date:

```bash
MOCK_NOW=2026-10-06T12:00:00 npm start
```

(PowerShell: `$env:MOCK_NOW="2026-10-06T12:00:00"; npm.cmd start`)

## Test

```bash
npm test
```

Uses Node's built-in test runner (`node:test`) — no extra dependencies. The tests start
the app on a random port, freeze the clock at `2026-10-06T12:00:00`, and reset the data
before each test. They cover: inventory listing, successful orders, inventory decreasing,
insufficient stock (nothing changes), FEFO batch consumption, expired stock being skipped,
low-stock alerts (and no duplicates), expiration alerts, restocking, and validation errors.

---

## Project structure

```
barmade-backend/
├── data/                 # Mock data (in-memory "database")
│   ├── inventory.js      #   12 ingredients with batches
│   ├── menu.js           #   5 menu items with recipes
│   ├── orders.js         #   2 historical orders
│   ├── alerts.js         #   starts empty
│   └── store.js          #   holds the live collections + resetStore()
├── repositories/         # Data access layer - the ONLY code that touches data/store.js
│   ├── inventoryRepository.js
│   ├── menuRepository.js
│   ├── orderRepository.js
│   └── alertRepository.js
├── services/             # Business logic
│   ├── stockRules.js     #   pure rules: FEFO, batch status, stock status
│   ├── inventoryService.js
│   ├── menuService.js
│   ├── orderService.js
│   └── alertService.js
├── controllers/          # HTTP request/response handling
├── routes/               # URL -> controller mapping
├── middleware/
│   └── errorHandler.js   # 404 + JSON error responses
├── utils/                # clock, dates, AppError, id generator
├── tests/                # node:test suites
├── app.js                # Express app (no listen - used by tests)
├── server.js             # Startup alert check + listen
└── package.json
```

**Request flow:** `route → controller → service → repository → data/store`

### Swapping in a real database

Repositories are `async` and return copies, just like a database driver.
To move to MongoDB or PostgreSQL, rewrite the four files in `repositories/`
with the same function names. Services, controllers and routes stay as they are.
Two spots are marked in the code where a database would use a **transaction** instead:
`inventoryRepository.setBatchQuantities` (all-or-nothing update) and the
`runExclusive` queue in `orderService.js` (prevents two orders from spending the same stock).

---

## Data model

**Ingredient**

```json
{
  "id": "ING-001",
  "name": "Tomato Sauce",
  "category": "Sauces",
  "unit": "ml",
  "reorderPoint": 10000,
  "batches": [
    { "batchId": "TS-001", "quantity": 5000, "arrivedAt": "2026-10-02T08:00:00", "expiresAt": "2026-10-09T23:59:59" }
  ]
}
```

`totalQuantity`, `expiredQuantity` and `status` are **calculated** from the batches on every
read rather than stored, so they can never get out of sync.

**Menu item**

```json
{
  "id": "MENU-002",
  "name": "Pepperoni Pizza",
  "price": 17.99,
  "ingredients": [
    { "ingredientId": "ING-003", "quantity": 1 },
    { "ingredientId": "ING-001", "quantity": 200 },
    { "ingredientId": "ING-002", "quantity": 150 },
    { "ingredientId": "ING-004", "quantity": 30 }
  ]
}
```

| Ingredient | Unit | Reorder point | | Menu item | Price |
|---|---|---|---|---|---|
| ING-001 Tomato Sauce | ml | 10000 | | MENU-001 Margherita Pizza | 15.99 |
| ING-002 Mozzarella Cheese | g | 5000 | | MENU-002 Pepperoni Pizza | 17.99 |
| ING-003 Pizza Dough | units | 30 | | MENU-003 Chicken Alfredo | 21.99 |
| ING-004 Pepperoni | slices | 300 | | MENU-004 Spaghetti Marinara | 16.99 |
| ING-005 Pasta (Spaghetti) | g | 5000 | | MENU-005 Coca-Cola | 2.99 |
| ING-006 Alfredo Sauce | ml | 3000 | | | |
| ING-007 Parmesan Cheese | g | 1000 | | | |
| ING-008 Olive Oil | ml | 2000 | | | |
| ING-009 Chicken | g | 4000 | | | |
| ING-010 Garlic | g | 500 | | | |
| ING-011 Basil | g | 200 | | | |
| ING-012 Coca-Cola Cans | cans | 48 | | | |

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/inventory` | All ingredients with `totalQuantity`, `expiredQuantity`, `status`, batches. Optional `?status=LOW_STOCK` |
| GET | `/api/inventory/:id` | One ingredient with its batches (FEFO order, each with a status) |
| POST | `/api/inventory/restock` | Add a new batch |
| GET | `/api/menu` | Menu items with recipes (ingredient names/units included) |
| GET | `/api/menu/:id` | One menu item |
| POST | `/api/orders` | Create an order and subtract ingredients |
| GET | `/api/orders` | Order history (newest first) |
| GET | `/api/alerts` | Alerts. Optional `?type=LOW_STOCK\|EXPIRING_SOON\|EXPIRED` and `?status=ACTIVE\|RESOLVED` |
| POST | `/api/alerts/check-expiration` | Run the expiration (and low-stock) check now |

### Status values

- Ingredient `status`: `IN_STOCK`, `LOW_STOCK` (total ≤ reorderPoint), `OUT_OF_STOCK` (total = 0)
- Batch `status`: `FRESH`, `EXPIRING_SOON` (≤ 48 h left), `EXPIRED`, `DEPLETED` (quantity 0)
- Alert `status`: `ACTIVE`, `RESOLVED`

### Errors

All errors share one shape:

```json
{ "error": { "code": "INSUFFICIENT_INVENTORY", "message": "...", "details": { } } }
```

| Status | When | Codes |
|---|---|---|
| 400 | Bad input | `VALIDATION_ERROR`, `INVALID_QUANTITY`, `MISSING_EXPIRATION_DATE`, `INVALID_DATE`, `EXPIRED_INVENTORY`, `INVALID_JSON`, `INVALID_ALERT_TYPE`, `INVALID_STATUS` |
| 404 | Unknown resource | `INGREDIENT_NOT_FOUND`, `MENU_ITEM_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | Not enough usable stock | `INSUFFICIENT_INVENTORY` (each shortage says `INSUFFICIENT_STOCK` or `EXPIRED_STOCK_NOT_USABLE`) |
| 500 | Unexpected / bad recipe data | `INTERNAL_SERVER_ERROR`, `RECIPE_DATA_ERROR` |

---

## Example requests

```bash
# Inventory
curl http://localhost:3000/api/inventory
curl http://localhost:3000/api/inventory?status=LOW_STOCK
curl http://localhost:3000/api/inventory/ING-003

# Menu
curl http://localhost:3000/api/menu

# Order 3 Pepperoni Pizzas
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"items":[{"menuItemId":"MENU-002","quantity":3}]}'

# Order history
curl http://localhost:3000/api/orders

# Restock tomato sauce
curl -X POST http://localhost:3000/api/inventory/restock \
  -H "Content-Type: application/json" \
  -d '{"ingredientId":"ING-001","quantity":10000,"arrivedAt":"2026-10-06T08:00:00","expiresAt":"2026-10-13T23:59:59"}'

# Alerts
curl http://localhost:3000/api/alerts
curl "http://localhost:3000/api/alerts?type=LOW_STOCK"
curl -X POST http://localhost:3000/api/alerts/check-expiration
```

`arrivedAt` is optional on restock (defaults to now). `expiresAt` is required and must be in the future.

---

## Example order flow

Request:

```json
POST /api/orders
{ "items": [ { "menuItemId": "MENU-002", "quantity": 3 } ] }
```

1. **Validate** — `items` is a non-empty array, each `quantity` is a whole number > 0.
2. **Find menu items** — `MENU-002` = Pepperoni Pizza (404 if not found).
3. **Calculate requirements** — recipe × 3, summed per ingredient across all lines:
   - Pizza Dough 1 × 3 = **3 units**
   - Tomato Sauce 200 × 3 = **600 ml**
   - Mozzarella 150 × 3 = **450 g**
   - Pepperoni 30 × 3 = **90 slices**
4. **Check stock first** — build a FEFO plan for every ingredient using only non-expired
   batches. If *any* ingredient is short, respond **409** and change **nothing**.
5. **Subtract** — apply every batch change together.
6. **Save the order** and **check low stock** for the ingredients used.

Response (`201`, trimmed):

```json
{
  "message": "Order ORD-003 created.",
  "data": { "id": "ORD-003", "status": "COMPLETED", "total": 53.97, "items": [ ... ] },
  "consumed": [
    { "ingredientId": "ING-003", "ingredientName": "Pizza Dough", "unit": "units", "quantity": 3,
      "batches": [ { "batchId": "PD-001", "quantity": 3 } ] },
    { "ingredientId": "ING-001", "ingredientName": "Tomato Sauce", "unit": "ml", "quantity": 600,
      "batches": [ { "batchId": "TS-001", "quantity": 600 } ] },
    ...
  ],
  "alertsCreated": []
}
```

---

## How FEFO works

**First Expired, First Out**: the batch closest to expiring is used first, so less food is thrown away.

For each ingredient (`services/stockRules.js → planFefoConsumption`):

1. Drop batches that are **expired** or **empty**.
2. Sort the rest by `expiresAt` (soonest first; ties → earliest `arrivedAt`).
3. Take from each batch until the required amount is covered.

Example — Tomato Sauce, order needs 6,000 ml:

| Batch | Before | Expires | Taken | After |
|---|---|---|---|---|
| A | 5,000 ml | Oct 8 | 5,000 | 0 |
| B | 10,000 ml | Oct 12 | 1,000 | 9,000 |

A batch never goes below 0: the plan only takes `min(batch quantity, still needed)`,
and the repository rejects any negative value as a safety net.

---

## How low-stock alerts work

After every order (and restock / expiration check) the usable total of each affected
ingredient is compared with its `reorderPoint`:

- `totalQuantity <= reorderPoint` and **no active** LOW_STOCK alert for that ingredient → create one.
- Already an active alert → no duplicate; its `currentQuantity` is just updated.
- Restocked above the reorder point → the alert becomes `RESOLVED`.

```json
{
  "id": "ALERT-004",
  "type": "LOW_STOCK",
  "status": "ACTIVE",
  "ingredientId": "ING-003",
  "ingredientName": "Pizza Dough",
  "currentQuantity": 30,
  "reorderPoint": 30,
  "unit": "units",
  "message": "Pizza Dough is running low.",
  "createdAt": "2026-10-06T12:00:00"
}
```

Try it: the mock data has 38 pizza dough with a reorder point of 30, so ordering
**8 pizzas** creates the alert.

## How expiration alerts work

`checkExpirations()` runs **on startup**, **after every restock**, and on
`POST /api/alerts/check-expiration`. For every batch that still has stock:

- `expiresAt` already passed → **EXPIRED** alert. The batch is excluded from `totalQuantity`
  and is never used for orders (it shows up as `expiredQuantity` so staff can discard it).
- Expires within **48 hours** → **EXPIRING_SOON** alert.
- One active alert per batch per type — re-running the check creates no duplicates.
- When a batch is used up, its expiration alerts are resolved; when an EXPIRING_SOON batch
  passes its date, that alert is resolved and an EXPIRED one is created.

```json
{
  "id": "ALERT-002",
  "type": "EXPIRING_SOON",
  "status": "ACTIVE",
  "ingredientId": "ING-002",
  "ingredientName": "Mozzarella Cheese",
  "batchId": "MZ-001",
  "quantity": 3500,
  "unit": "g",
  "expiresAt": "2026-10-07T23:59:59",
  "message": "Mozzarella Cheese expires soon.",
  "createdAt": "2026-10-06T12:00:00"
}
```

On startup the mock data produces: EXPIRING_SOON for **MZ-001** (mozzarella) and
**CH-001** (chicken), and EXPIRED for **BA-001** (basil).

Since there's no scheduler yet, run the manual endpoint (or add a cron job later) to
re-check over time.

## Deploy on Render

This backend is included in the portfolio repository at `projects/barmade`.
The repository-root `render.yaml` defines a free Node.js web service.

1. Open https://dashboard.render.com/select-repo?type=blueprint and select `JorgeEstenger/Portafolio`.
2. Use branch `main` and Blueprint path `render.yaml`.
3. Review and deploy the `barmade-api` service.

For a manual Web Service setup, use root directory `projects/barmade`, build command `npm ci && npm test`, start command `npm start`, and health check path `/`. Set `NODE_VERSION=24` and `NODE_ENV=production`. Render supplies `PORT`.

After deployment, open the assigned service URL and `/api/inventory` to verify the API.
This is a backend API, so the root returns JSON. It does not serve the Angular portfolio.
Inventory, orders, and alerts are stored in memory and reset whenever the process restarts.
Free services can sleep when idle, so the first request after inactivity can take longer.

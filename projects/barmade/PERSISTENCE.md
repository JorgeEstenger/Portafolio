# Persistent data on Render with Firestore

The API can use Firebase Firestore instead of process memory. The default Firestore database has a free quota on the Spark plan; no Cloud Functions deployment is needed.

## Setup

1. Create the Standard `(default)` Firestore database in Firebase project `barmade-206f3`, with private/production rules. Do not enable billing, PITR, or backups.
2. Give the Render backend a dedicated Google service account with only the `Cloud Datastore User` role on this project. Keep its JSON credential out of GitHub and chat.
3. In Render's Environment settings, set `FIRESTORE_PROJECT_ID=barmade-206f3` and set `FIREBASE_SERVICE_ACCOUNT_JSON` to the service account JSON as a secret. For local development, Application Default Credentials also work.
4. Deploy the updated backend source and restart it. Startup must successfully access Firestore; incorrect credentials cause startup to fail rather than silently falling back to mock data.

When `FIRESTORE_PROJECT_ID` is absent the API continues to use in-memory mock data. Tests must run without this variable to avoid touching live data.

## Behavior

Records live under `barmade/state/{inventory,menu,orders,alerts}`. Mock data is seeded only on the first successful transaction; subsequent restarts load saved records. Inventory changes, orders, and alert updates commit atomically. Failed operations commit nothing. Read-only requests do not rewrite unchanged records.

The implementation reads all four collections per request, appropriate for this small demo. Larger deployments should query individual records and paginate orders/alerts to reduce reads and stay within Firestore quotas.

Existing changes held only in the live Render process are not automatically migrated. Before redeploying, export any current data you need to retain; the first database seed otherwise uses the original mocks.

The API currently has no authentication for writes. Add authentication before using persistent storage for real business data.

## Verify persistence

Create a demo order, note its ID and resulting inventory, restart the Render service, then confirm the same order and quantities are still present. Do not claim persistence is active until this live check succeeds.

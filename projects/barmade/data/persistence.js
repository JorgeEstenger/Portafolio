const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();
const collections = ['inventory', 'menu', 'orders', 'alerts', 'movements'];
let database;

function getDatabase() {
  if (database) return database;
  const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let credential = applicationDefault();
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let account;
    try {
      account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.');
    }
    if (account.project_id !== process.env.FIRESTORE_PROJECT_ID) {
      throw new Error('Firebase credentials must belong to FIRESTORE_PROJECT_ID.');
    }
    credential = cert(account);
  }
  const app = initializeApp({ credential, projectId: process.env.FIRESTORE_PROJECT_ID }, 'barmade');
  database = getFirestore(app);
  return database;
}

// All reads happen before writes. Firestore retries conflicts, so stock changes,
// orders and alert updates commit together even across multiple API instances.
async function runTransaction(db, task, seed) {
  const root = db.collection('barmade').doc('state');
  return db.runTransaction(async (tx) => {
    const marker = await tx.get(root);
    const snapshots = await Promise.all(collections.map((name) => tx.get(root.collection(name))));
    const before = Object.fromEntries(collections.map((name, i) => [
      name, snapshots[i].docs.map((doc) => doc.data()),
    ]));
    let state;
    if (!marker.exists) {
      if (collections.some((name) => before[name].length)) {
        throw new Error('Firestore contains BarMade records without initialization metadata. Refusing to overwrite them.');
      }
      state = seed();
    } else {
      state = structuredClone(before);
    }
    const result = await context.run(state, task);
    for (const name of collections) {
      const previous = new Map(before[name].map((record) => [record.id, record]));
      for (const record of state[name]) {
        if (JSON.stringify(record) !== JSON.stringify(previous.get(record.id))) {
          tx.set(root.collection(name).doc(record.id), record);
        }
        previous.delete(record.id);
      }
      for (const id of previous.keys()) tx.delete(root.collection(name).doc(id));
    }
    if (!marker.exists) tx.set(root, { schemaVersion: 1 });
    return result;
  });
}

function persistent(task) {
  return async function (...args) {
    if (context.getStore() || !process.env.FIRESTORE_PROJECT_ID) return task(...args);
    const { createSeed } = require('./store');
    return runTransaction(getDatabase(), () => task(...args), createSeed);
  };
}

module.exports = { context, persistent, runTransaction };

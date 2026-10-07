/**
 * Inventory data access.
 *
 * All functions are async and return copies, exactly like a database driver
 * would. To move to MongoDB/PostgreSQL, rewrite this file (same function
 * signatures) and nothing in services/controllers needs to change.
 */

const { store } = require('../data/store');

const clone = (value) => structuredClone(value);

async function findAll() {
  return clone(store.inventory);
}

async function findById(id) {
  const ingredient = store.inventory.find((i) => i.id === id);
  return ingredient ? clone(ingredient) : null;
}

async function findByIds(ids) {
  return clone(store.inventory.filter((i) => ids.includes(i.id)));
}

/** Append a batch to an ingredient. Returns the updated ingredient, or null if not found. */
async function addBatch(ingredientId, batch) {
  const ingredient = store.inventory.find((i) => i.id === ingredientId);
  if (!ingredient) return null;
  ingredient.batches.push(clone(batch));
  return clone(ingredient);
}

/**
 * Apply several batch quantity changes at once.
 * changes: [{ ingredientId, batchId, quantity }] where quantity is the NEW value.
 *
 * Validates every change before writing anything, so either all changes are
 * applied or none are (a database would use a transaction here).
 */
async function setBatchQuantities(changes) {
  const targets = changes.map((change) => {
    const ingredient = store.inventory.find((i) => i.id === change.ingredientId);
    const batch = ingredient && ingredient.batches.find((b) => b.batchId === change.batchId);
    if (!batch) throw new Error(`Batch ${change.batchId} not found for ${change.ingredientId}`);
    if (!(change.quantity >= 0)) throw new Error(`Batch ${change.batchId} cannot go negative`);
    return { batch, quantity: change.quantity };
  });
  targets.forEach(({ batch, quantity }) => {
    batch.quantity = quantity;
  });
}

module.exports = { findAll, findById, findByIds, addBatch, setBatchQuantities };

/**
 * Generate the next sequential ID for a prefix, e.g. "ORD-003" -> "ORD-004".
 * Looks at existing IDs so it keeps working after data is reset or reloaded.
 * The zero-padding of existing IDs is kept ("ORD-07319" -> "ORD-07320").
 * (A real database would generate IDs itself.)
 */
function nextId(prefix, existingIds, width = 3) {
  let digits = width;
  const max = existingIds.reduce((highest, id) => {
    if (typeof id !== 'string' || !id.startsWith(`${prefix}-`)) return highest;
    const n = Number.parseInt(id.slice(prefix.length + 1), 10);
    if (Number.isNaN(n)) return highest;
    digits = Math.max(digits, id.length - prefix.length - 1);
    return Math.max(highest, n);
  }, 0);
  return `${prefix}-${String(max + 1).padStart(digits, '0')}`;
}

/**
 * Faster variant for append-only collections (orders, movements) whose IDs
 * only ever increase: only the last ID needs to be looked at.
 */
function nextIdAfter(prefix, lastId, width = 3) {
  return nextId(prefix, lastId ? [lastId] : [], width);
}

module.exports = { nextId, nextIdAfter };

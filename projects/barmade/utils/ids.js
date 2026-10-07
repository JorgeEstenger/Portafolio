/**
 * Generate the next sequential ID for a prefix, e.g. "ORD-003" -> "ORD-004".
 * Looks at existing IDs so it keeps working after data is reset or reloaded.
 * (A real database would generate IDs itself.)
 */
function nextId(prefix, existingIds, width = 3) {
  const max = existingIds.reduce((highest, id) => {
    if (typeof id !== 'string' || !id.startsWith(`${prefix}-`)) return highest;
    const n = Number.parseInt(id.slice(prefix.length + 1), 10);
    return Number.isNaN(n) ? highest : Math.max(highest, n);
  }, 0);
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

module.exports = { nextId };

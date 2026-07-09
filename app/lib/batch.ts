// Derives a human-readable batch reference from a production order UUID and
// creation timestamp. Deterministic: same inputs always produce the same output.
export function deriveBatchRef(id: string, createdAt: string): string {
  const year = new Date(createdAt).getFullYear()
  const num  = parseInt(id.replace(/-/g, '').slice(-6), 16) % 9999 + 1
  return `BT-${year}-${String(num).padStart(4, '0')}`
}

/** Date helpers shared by the gate, the advisory pass and the writers. */

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Today as YYYY-MM-DD, UTC. `now` is injectable so tests are deterministic. */
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

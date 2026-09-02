/**
 * Ids of orders this browser created (POS bills rung up on this machine).
 *
 * The kitchen board uses it to stay silent about its own orders: a counter
 * terminal that also keeps the board open shouldn't be alerted about an order
 * the operator just typed in. The order still shows on the board and still has
 * to be acknowledged — only the alarm is suppressed on this device.
 */

const KEY = "rms_local_orders";
const LIMIT = 100;

function read(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

export function rememberLocalOrder(id: number) {
  if (typeof window === "undefined" || !id) return;
  try {
    const ids = [...read().filter((v) => v !== id), id].slice(-LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // storage full / disabled — worst case the board alerts for our own order
  }
}

export function getLocalOrderIds(): Set<number> {
  return new Set(read());
}

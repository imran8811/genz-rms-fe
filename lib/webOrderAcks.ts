/**
 * Online orders whose arrival alert has been dismissed on this terminal.
 *
 * Pressing **OK** on the alert only silences it — it says "I have seen this",
 * not "I have dealt with it". The order stays waiting on `/counter` until the
 * staff have phoned the customer and either sent it to the kitchen or cancelled
 * it, so dismissal cannot be inferred from the order's own state and has to be
 * remembered here.
 *
 * localStorage rather than a column because **the restaurant has one counter**:
 * there is no second terminal to agree with, and the only thing that has to
 * survive is a page reload — without which a refresh mid-phone-call would set
 * the alarm off again over an order already being handled.
 */

const KEY = "rms_web_order_acks";
const LIMIT = 200;

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

/** Returns the full set, so callers can drop the card in the same tick. */
export function dismissWebOrder(id: number): Set<number> {
  if (typeof window === "undefined" || !id) return getDismissedWebOrders();
  const ids = [...read().filter((v) => v !== id), id].slice(-LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // storage full / disabled — worst case the alert returns on the next poll,
    // which is the safe direction to fail in for an order nobody has handled.
  }
  return new Set(ids);
}

export function getDismissedWebOrders(): Set<number> {
  return new Set(read());
}

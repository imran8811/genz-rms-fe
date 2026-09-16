/**
 * Ids of complaints logged from this browser.
 *
 * Same idea as `lib/localOrders.ts` and `lib/etaAsks.ts`: the terminal that
 * raised something doesn't alarm itself about it. Whoever just typed a
 * complaint into the Sales screen plainly knows it exists, and if that machine
 * also keeps the kitchen board open in another tab, the chime would be
 * announcing their own keystrokes.
 *
 * The complaint still appears on the board's Complaints tab and still has to be
 * acknowledged in the back — only the sound is suppressed, and only here.
 */

const KEY = "rms_local_complaints";
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

export function rememberLocalComplaint(id: number) {
  if (typeof window === "undefined" || !id) return;
  try {
    const ids = [...read().filter((v) => v !== id), id].slice(-LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // storage full / disabled — worst case this browser chimes for its own
    // complaint, which is noise rather than a failure.
  }
}

export function getLocalComplaintIds(): Set<number> {
  return new Set(read());
}

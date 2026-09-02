/**
 * Time questions this browser raised ("how long on #3021?").
 *
 * The board alarms — klaxon plus an amber frame — when a time question is
 * outstanding, but the terminal that *asked* shouldn't alarm itself: the front
 * desk pressed the button, it knows. Same idea as `localOrders.ts`, which keeps
 * a POS terminal from being alerted about the bill it just rang up.
 *
 * Entries are dropped once the question is no longer outstanding (answered, or
 * cleared because the order went ready), so the next question — from whichever
 * terminal — alarms this one again.
 */

const KEY = "rms_eta_asks";
const LIMIT = 100;
/**
 * A poll already in flight when we asked comes back without our request on it.
 * Keep the entry through that window or the board would forget the ask was ours
 * and then alarm this terminal about its own question a poll later.
 */
const GRACE_MS = 20000;

/** order id -> when this browser asked (ms). */
type Asks = Record<string, number>;

function read(): Asks {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Asks = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(Number(id))) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function write(asks: Asks) {
  if (typeof window === "undefined") return;
  try {
    // Keep it bounded: oldest asks first out.
    const trimmed = Object.entries(asks)
      .sort((a, b) => a[1] - b[1])
      .slice(-LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // storage full / disabled — worst case this terminal alarms for its own ask
  }
}

function ids(asks: Asks): Set<number> {
  return new Set(Object.keys(asks).map(Number));
}

export function rememberEtaAsk(id: number): Set<number> {
  if (!id) return getEtaAskIds();
  const asks = read();
  asks[String(id)] = Date.now();
  write(asks);
  return ids(asks);
}

export function forgetEtaAsk(id: number): Set<number> {
  const asks = read();
  delete asks[String(id)];
  write(asks);
  return ids(asks);
}

export function getEtaAskIds(): Set<number> {
  return ids(read());
}

/**
 * Drop our record for every order that no longer has a question outstanding —
 * but not within `GRACE_MS` of asking, when the server simply may not have been
 * polled since. Returns the surviving ids.
 */
export function pruneEtaAsks(settledIds: number[]): Set<number> {
  const asks = read();
  const cutoff = Date.now() - GRACE_MS;
  let changed = false;
  for (const id of settledIds) {
    const at = asks[String(id)];
    if (at !== undefined && at < cutoff) {
      delete asks[String(id)];
      changed = true;
    }
  }
  if (changed) write(asks);
  return ids(asks);
}

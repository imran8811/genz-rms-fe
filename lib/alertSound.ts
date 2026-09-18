/**
 * Alert sounds for the kitchen orders board and the front desk, synthesised
 * with the Web Audio API so there is no audio asset to ship (and nothing to
 * 404 offline).
 *
 * Three repeating alarms, deliberately unalike so the kitchen can tell them
 * apart from across the room without looking:
 *   - a rising three-note chime: an order has landed. Raised by two independent
 *     alarms — `new-order` (the kitchen board's own unacknowledged slips) and
 *     `web-order` (an online order the counter hasn't picked up). They share the
 *     chime on purpose: to whoever hears it, "an order came in" is one event.
 *   - `time-question` — a two-tone klaxon: the front desk is asking how much
 *     longer an order will take.
 *   - `complaint` — a low, descending buzz: a customer has complained about an
 *     order. It falls where the other two climb or alternate, and sits an octave
 *     below both, so nobody has to read the board to know which of the three it
 *     is — which matters most for this one, because it is the sound that means
 *     something has already gone wrong.
 *
 * …and one **one-shot ping**, `ready`: two falling bell notes for the front
 * desk when the kitchen marks an order collected-ready. It is the odd one out
 * on purpose — it is a notification, nobody is expected to acknowledge it, and
 * it plays once. It therefore takes no part in the arbitration below; it just
 * yields to any alarm that happens to be sounding rather than layering over it.
 *
 * Only ever **one alarm plays at a time** (`PRIORITY` / `sync`). Callers request
 * an alarm rather than starting it, because they no longer all live on one page:
 * the board decides about its own slips while `WebOrderNotifier` follows the
 * operator around the RMS, and neither can see what the other wants. Two chimes
 * layered over each other would defeat the point of giving them separate sounds.
 *
 * All of them are meant to carry over a working kitchen, so everything runs
 * through a compressor with makeup gain (see `ensureContext`) rather than a
 * bare gain node — that keeps the average level high, which is what "loud"
 * actually means across a noisy room, without the clipping a raw high gain
 * would produce.
 *
 * Browsers block audio until the page has had a user gesture, so callers must
 * run `unlockAlertSound()` from a click/keypress before any of this is
 * actually audible.
 */

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

type AlertKind = "new-order" | "web-order" | "complaint" | "time-question";

/**
 * A one-shot notification, not an alarm: it plays once and is over, so it has
 * no loop, no claim and no place in `PRIORITY`. It still needs to be a `kind`
 * because `beep()` files every note it schedules under one, and a ping's notes
 * must not be swept away by a `stopAlert()` for somebody else's alarm.
 */
type PingKind = "ready";

/** Anything that can schedule notes — an alarm or a one-shot ping. */
type Voiced = AlertKind | PingKind;

/**
 * Loudest claim wins, and the rest stay silent until it is cleared. `new-order`
 * and `web-order` sound identical, so their order relative to each other is
 * inaudible — what matters is that a landed order outranks the rest: food not
 * yet started is the only thing here that gets worse by waiting.
 *
 * A complaint outranks a time question because it is about a customer who is
 * already unhappy, where the question is about one who is merely waiting — and
 * neither of them stops the kitchen cooking, so both yield to an order.
 */
const PRIORITY: AlertKind[] = ["new-order", "web-order", "complaint", "time-question"];

type Voice = { osc: OscillatorNode; gain: GainNode };

let ctx: AudioContext | null = null;
/** Everything is played into this, not straight at `destination`. */
let bus: GainNode | null = null;
const loops: Partial<Record<AlertKind, ReturnType<typeof setInterval>>> = {};
/** Notes already scheduled, per alarm, so stopping one can silence it mid-chime
 *  without cutting the other one short. */
const voices: Record<Voiced, Voice[]> = {
  "new-order": [],
  "web-order": [],
  complaint: [],
  "time-question": [],
  ready: [],
};
/** Alarms callers currently want. What actually plays is decided by `sync()`. */
const requested = new Set<AlertKind>();

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();

    // bus -> compressor -> makeup -> speakers. The compressor tames the peaks
    // so the makeup gain can push the whole alarm close to full scale; the two
    // together are what make it audible over extraction fans and a fryer.
    bus = ctx.createGain();
    bus.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-6, ctx.currentTime);
    comp.knee.setValueAtTime(10, ctx.currentTime);
    comp.ratio.setValueAtTime(4, ctx.currentTime);
    comp.attack.setValueAtTime(0.003, ctx.currentTime);
    comp.release.setValueAtTime(0.12, ctx.currentTime);
    const makeup = ctx.createGain();
    makeup.gain.value = 1.6;
    bus.connect(comp);
    comp.connect(makeup);
    makeup.connect(ctx.destination);
  }
  return ctx;
}

function beep(
  kind: Voiced,
  audio: AudioContext,
  at: number,
  freq: number,
  duration = 0.16,
  type: OscillatorType = "square",
  level = 0.55,
) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  // Short attack/decay envelope — a raw square wave gated on/off clicks.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.02);
  gain.gain.setValueAtTime(level, at + duration * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain);
  gain.connect(bus ?? audio.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);

  const voice = { osc, gain };
  voices[kind].push(voice);
  osc.onended = () => {
    voices[kind] = voices[kind].filter((v) => v !== voice);
  };
}

/**
 * One note of the klaxon: the fundamental plus its octave, which reads far
 * brighter (and so carries further) than the same energy in one tone.
 */
function blast(audio: AudioContext, at: number, freq: number, duration: number) {
  beep("time-question", audio, at, freq, duration, "square", 0.95);
  beep("time-question", audio, at, freq * 2, duration, "square", 0.35);
}

/**
 * One three-note rising chime — an order has landed. Takes the alarm it is
 * playing for so its notes are filed under that alarm: `web-order` borrows this
 * chime, and notes tagged as someone else's would survive the fade when its own
 * claim is dropped.
 */
function newOrderChime(kind: AlertKind = "new-order") {
  const audio = ensureContext();
  if (!audio || audio.state !== "running") return;
  const t = audio.currentTime + 0.01;
  beep(kind, audio, t, 880);
  beep(kind, audio, t + 0.2, 1175);
  beep(kind, audio, t + 0.4, 1568, 0.26);
}

/**
 * The front desk asking "how long?" — a two-tone klaxon, nothing like the
 * new-order chime on purpose: it alternates between two pitches instead of
 * climbing, so the sound alone says which alarm is going off. It is the loudest
 * thing the board plays, because it is the only cue for it now that the slip no
 * longer shakes and the tablet no longer buzzes.
 */
function timeQuestionChime() {
  const audio = ensureContext();
  if (!audio || audio.state !== "running") return;
  const t = audio.currentTime + 0.01;
  blast(audio, t, 784, 0.22);
  blast(audio, t + 0.24, 587, 0.22);
  blast(audio, t + 0.48, 784, 0.22);
  blast(audio, t + 0.72, 587, 0.32);
}

/**
 * A customer has complained — three falling notes, each doubled an octave down
 * on a sawtooth so the sound is low and rough where the new-order chime is
 * bright and the klaxon is piercing. It *descends*, which is the opposite shape
 * to the chime: across a noisy kitchen the direction of the pitch is the part
 * that survives, so it is what tells these two apart, not their timbre.
 *
 * Slower than the other two as well (a longer gap between repeats), because
 * unlike a waiting order nothing about a complaint gets worse in the next ten
 * seconds — it has to be unmissable, not urgent.
 */
function complaintChime() {
  const audio = ensureContext();
  if (!audio || audio.state !== "running") return;
  const t = audio.currentTime + 0.01;
  const fall = (at: number, freq: number, duration: number) => {
    beep("complaint", audio, at, freq, duration, "sawtooth", 0.85);
    beep("complaint", audio, at, freq / 2, duration, "sawtooth", 0.5);
  };
  fall(t, 392, 0.28);
  fall(t + 0.32, 311, 0.28);
  fall(t + 0.64, 233, 0.44);
}

/**
 * An order is ready to collect — the kitchen's answer back to the front desk.
 *
 * Unlike everything above it this is a **notification, not an alarm**: two
 * quick bell-like notes, played once (twice over, so one hiss of the fryer
 * can't swallow the whole thing) and done. Nothing is waiting on the counter
 * pressing anything — the toast stays on screen until it is dismissed, and the
 * order keeps sitting on the pass either way — so a sound that kept repeating
 * would only teach the staff to mute the terminal.
 *
 * Triangle waves an octave apart, falling rather than rising: the board's
 * new-order chime climbs on a square wave, and these two can be heard by the
 * same terminal. Direction plus timbre is what tells them apart across a room.
 */
function readyChime() {
  const audio = ensureContext();
  if (!audio || audio.state !== "running") return;
  const t = audio.currentTime + 0.01;
  const ding = (at: number, freq: number) => {
    beep("ready", audio, at, freq, 0.13, "triangle", 0.8);
    beep("ready", audio, at, freq / 2, 0.13, "triangle", 0.4);
  };
  ding(t, 1568);
  ding(t + 0.15, 1047);
  ding(t + 0.5, 1568);
  ding(t + 0.65, 1047);
}

const ALARMS: Record<AlertKind, { play: () => void; everyMs: number }> = {
  "new-order": { play: () => newOrderChime("new-order"), everyMs: 2600 },
  "web-order": { play: () => newOrderChime("web-order"), everyMs: 2600 },
  complaint: { play: complaintChime, everyMs: 3400 },
  "time-question": { play: timeQuestionChime, everyMs: 2000 },
};

function startAlert(kind: AlertKind) {
  if (loops[kind]) return;
  const alarm = ALARMS[kind];
  alarm.play();
  loops[kind] = setInterval(alarm.play, alarm.everyMs);
}

function stopAlert(kind: AlertKind) {
  const loop = loops[kind];
  if (loop) {
    clearInterval(loop);
    delete loops[kind];
  }
  const audio = ctx;
  if (!audio) return;
  const now = audio.currentTime;
  for (const { osc, gain } of voices[kind]) {
    try {
      // Short fade instead of a hard stop, which would click.
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      osc.stop(now + 0.04);
    } catch {
      // already stopped
    }
  }
  voices[kind] = [];
}

/**
 * Play the highest-priority alarm anyone is asking for and silence the rest.
 * `startAlert` is idempotent, so an alarm that is already the winner keeps its
 * loop running rather than restarting mid-chime on every re-render.
 */
function sync() {
  const winner = PRIORITY.find((kind) => requested.has(kind)) ?? null;
  for (const kind of PRIORITY) {
    if (kind !== winner) stopAlert(kind);
  }
  if (winner) startAlert(winner);
}

function requestAlert(kind: AlertKind, on: boolean) {
  if (on === requested.has(kind)) return;
  if (on) requested.add(kind);
  else requested.delete(kind);
  sync();
}

/** Resume the audio context. Call from a user gesture. */
export async function unlockAlertSound(): Promise<boolean> {
  const audio = ensureContext();
  if (!audio) return false;
  if (audio.state !== "running") {
    try {
      await audio.resume();
    } catch {
      return false;
    }
  }
  return audio.state === "running";
}

export function alertSoundReady(): boolean {
  return ctx?.state === "running";
}

/** New order waiting: chime immediately, then keep chiming until stopped. */
export function startAlertSound() {
  requestAlert("new-order", true);
}

/** Silences immediately, including notes of the current chime already scheduled. */
export function stopAlertSound() {
  requestAlert("new-order", false);
}

/**
 * An online order has landed and the counter hasn't picked it up yet. Same
 * chime as a new bill on the board — nobody has to learn a third sound — but a
 * separate claim, because the counter acknowledges it separately.
 */
export function startWebOrderSound() {
  requestAlert("web-order", true);
}

export function stopWebOrderSound() {
  requestAlert("web-order", false);
}

/**
 * A customer complaint the kitchen hasn't acknowledged. Keeps sounding until
 * someone in the back presses OK on the board's Complaints tab — pressing OK is
 * "we know", not "it's fixed", which is why the alarm is allowed to stop long
 * before the complaint is closed.
 */
export function startComplaintSound() {
  requestAlert("complaint", true);
}

export function stopComplaintSound() {
  requestAlert("complaint", false);
}

/** Front desk is waiting on a preparation time for a slip on the board. */
export function startTimeQuestionSound() {
  requestAlert("time-question", true);
}

export function stopTimeQuestionSound() {
  requestAlert("time-question", false);
}

/**
 * An order has been marked ready — ping the front desk once.
 *
 * This is the one sound here that is **not** a claim: it fires and finishes, so
 * it never enters the one-at-a-time arbitration above and nothing has to stop
 * it. What it does respect is the other half of that rule — if any alarm is
 * currently sounding, the ping is dropped rather than layered over it. An alarm
 * is already calling someone to a screen, and the toast this ping belongs to
 * stays up until it is dismissed, so the alert survives the silence.
 *
 * Needs `unlockAlertSound()` to have run from a gesture, like the alarms; until
 * then this is a no-op and the toast is the whole alert, as it was before.
 */
export function playReadyPing() {
  if (requested.size > 0) return;
  readyChime();
}

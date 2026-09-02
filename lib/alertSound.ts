/**
 * Repeating alert chimes for the kitchen orders board, synthesised with the Web
 * Audio API so there is no audio asset to ship (and nothing to 404 offline).
 *
 * Two sounds, deliberately unalike so the kitchen can tell them apart from
 * across the room without looking:
 *   - a rising three-note chime: an order has landed. Raised by two independent
 *     alarms — `new-order` (the kitchen board's own unacknowledged slips) and
 *     `web-order` (an online order the counter hasn't picked up). They share the
 *     chime on purpose: to whoever hears it, "an order came in" is one event.
 *   - `time-question` — a two-tone klaxon: the front desk is asking how much
 *     longer an order will take.
 *
 * Only ever **one alarm plays at a time** (`PRIORITY` / `sync`). Callers request
 * an alarm rather than starting it, because they no longer all live on one page:
 * the board decides about its own slips while `WebOrderNotifier` follows the
 * operator around the RMS, and neither can see what the other wants. Two chimes
 * layered over each other would defeat the point of giving them separate sounds.
 *
 * Both are meant to carry over a working kitchen, so everything runs through a
 * compressor with makeup gain (see `ensureContext`) rather than a bare gain
 * node — that keeps the average level high, which is what "loud" actually means
 * across a noisy room, without the clipping a raw high gain would produce.
 *
 * Browsers block audio until the page has had a user gesture, so callers must
 * run `unlockAlertSound()` from a click/keypress before either alarm will
 * actually be audible.
 */

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

type AlertKind = "new-order" | "web-order" | "time-question";

/**
 * Loudest claim wins, and the rest stay silent until it is cleared. `new-order`
 * and `web-order` sound identical, so their order relative to each other is
 * inaudible — what matters is that a landed order outranks a time question.
 */
const PRIORITY: AlertKind[] = ["new-order", "web-order", "time-question"];

type Voice = { osc: OscillatorNode; gain: GainNode };

let ctx: AudioContext | null = null;
/** Everything is played into this, not straight at `destination`. */
let bus: GainNode | null = null;
const loops: Partial<Record<AlertKind, ReturnType<typeof setInterval>>> = {};
/** Notes already scheduled, per alarm, so stopping one can silence it mid-chime
 *  without cutting the other one short. */
const voices: Record<AlertKind, Voice[]> = {
  "new-order": [],
  "web-order": [],
  "time-question": [],
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
  kind: AlertKind,
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

const ALARMS: Record<AlertKind, { play: () => void; everyMs: number }> = {
  "new-order": { play: () => newOrderChime("new-order"), everyMs: 2600 },
  "web-order": { play: () => newOrderChime("web-order"), everyMs: 2600 },
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

/** Front desk is waiting on a preparation time for a slip on the board. */
export function startTimeQuestionSound() {
  requestAlert("time-question", true);
}

export function stopTimeQuestionSound() {
  requestAlert("time-question", false);
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isKitchenUser, useAuth } from "@/lib/auth";
import type {
  ComplaintFeed,
  KitchenFeed,
  KitchenOrder,
  KitchenStatus,
  OrderComplaint,
} from "@/lib/types";
import OrderSlip from "@/components/OrderSlip";
import ComplaintCard from "@/components/ComplaintCard";
import {
  alertSoundReady,
  startAlertSound,
  startComplaintSound,
  startTimeQuestionSound,
  stopAlertSound,
  stopComplaintSound,
  stopTimeQuestionSound,
  unlockAlertSound,
} from "@/lib/alertSound";
import { getLocalOrderIds } from "@/lib/localOrders";
import { getLocalComplaintIds } from "@/lib/localComplaints";
import { forgetEtaAsk, getEtaAskIds, pruneEtaAsks, rememberEtaAsk } from "@/lib/etaAsks";

const POLL_MS = 10000;
/** How long a locally-set status may mask polled data (covers one in-flight poll). */
const OVERRIDE_GRACE_MS = 15000;

/**
 * `complaints` is the fourth tab rather than a page of its own: a complaint is
 * about food this board made, and the kitchen is already standing in front of
 * this screen. Putting it anywhere else would mean a second screen to watch.
 */
type Filter = "active" | "ready" | "all" | "complaints";

export default function OrdersPage() {
  // The kitchen login answers time questions; it never raises them (the front
  // desk does, and the API 403s it anyway), so it gets no "⏱ Time" button.
  const { user } = useAuth();
  const kitchenOnly = isKitchenUser(user);

  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [complaints, setComplaints] = useState<OrderComplaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [complaintBusyId, setComplaintBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [soundOn, setSoundOn] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** Is this board the screen someone is actually looking at right now? */
  const [watching, setWatching] = useState(true);
  /** Time questions raised from this browser — it doesn't alarm about its own. */
  const [askedHere, setAskedHere] = useState<Set<number>>(() => new Set());

  /** Statuses set locally that an in-flight poll may not have picked up yet. */
  const overrides = useRef(new Map<number, { status: KitchenStatus; until: number }>());
  /** Same, for time questions/answers written from this board. */
  const etaWrites = useRef(new Map<number, { order: KitchenOrder; until: number }>());
  /** Complaints acknowledged here, held until the poll echoes it — id → expiry. */
  const complaintAcks = useRef(new Map<number, number>());
  const polling = useRef(false);
  const pollingComplaints = useRef(false);

  const applyOverride = useCallback((order: KitchenOrder): KitchenOrder => {
    const pending = overrides.current.get(order.id);
    if (!pending) return order;
    // Held until the poll echoes the status back — not "until the poll is at
    // least this far along", because Undo moves a slip *backwards* and a rank
    // test would treat the stale "ready" still in flight as having caught up.
    // Expired either way, so a write that never landed can't mask the server
    // forever: the board has to show the truth, not a local guess.
    if (order.kitchen_status === pending.status || Date.now() > pending.until) {
      overrides.current.delete(order.id);
      return order;
    }
    return { ...order, kitchen_status: pending.status };
  }, []);

  /**
   * Hold a just-written time question/answer over a poll that was already in
   * flight when it was written — otherwise an answered slip would snap back to
   * asking (and start alarming again) for a few seconds.
   */
  const applyEtaWrite = useCallback((order: KitchenOrder): KitchenOrder => {
    const pending = etaWrites.current.get(order.id);
    if (!pending) return order;
    const caughtUp =
      (pending.order.eta_requested_at ?? "") === (order.eta_requested_at ?? "") &&
      (pending.order.eta_set_at ?? "") === (order.eta_set_at ?? "");
    // Expire rather than mask forever: if the write never landed, the board has
    // to show the truth instead of a local guess.
    if (caughtUp || Date.now() > pending.until) {
      etaWrites.current.delete(order.id);
      return order;
    }
    return {
      ...order,
      eta_requested_at: pending.order.eta_requested_at,
      eta_minutes: pending.order.eta_minutes,
      eta_set_at: pending.order.eta_set_at,
    };
  }, []);

  const load = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const feed = await api.get<KitchenFeed>("/orders/kitchen");
      const next = feed.orders.map((o) => applyEtaWrite(applyOverride(o)));
      setOrders(next);
      // Once a question is off an order — answered, or dropped because it went
      // ready — it stops being "ours", so the next one (from any terminal)
      // alarms this board again.
      setAskedHere(pruneEtaAsks(next.filter((o) => !o.eta_requested_at).map((o) => o.id)));
      setUpdatedAt(Date.now());
      setError("");
    } catch (e) {
      setError((e as Error).message || "Failed to load orders.");
    } finally {
      polling.current = false;
      setLoading(false);
    }
  }, [applyOverride, applyEtaWrite]);

  /**
   * Hold a just-pressed OK over a poll that was already in flight — otherwise
   * an acknowledged complaint would snap back to `new` for a few seconds and
   * start the alarm again, which reads as the press not having worked.
   */
  const applyComplaintAck = useCallback((complaint: OrderComplaint): OrderComplaint => {
    const until = complaintAcks.current.get(complaint.id);
    if (!until) return complaint;
    // Expire rather than mask forever: a press that never landed must surface
    // as an unacknowledged complaint, not stay hidden behind a local guess.
    if (complaint.status !== "new" || Date.now() > until) {
      complaintAcks.current.delete(complaint.id);
      return complaint;
    }
    return { ...complaint, status: "seen" };
  }, []);

  /**
   * The complaints feed is loaded separately from the slips and **fails
   * quietly**: the board is what the kitchen is cooking from, and blanking it
   * (or covering it in a red banner) because a complaint didn't load would be a
   * worse failure than a complaint arriving one tick late.
   */
  const loadComplaints = useCallback(async () => {
    if (pollingComplaints.current) return;
    pollingComplaints.current = true;
    try {
      const feed = await api.get<ComplaintFeed>("/complaints/kitchen");
      setComplaints(feed.complaints.map(applyComplaintAck));
    } catch {
      // Next tick recovers.
    } finally {
      pollingComplaints.current = false;
    }
  }, [applyComplaintAck]);

  // Poll for new orders and complaints on one timer, and catch both up
  // immediately when the tab regains focus.
  useEffect(() => {
    load();
    loadComplaints();
    const timer = setInterval(() => {
      load();
      loadComplaints();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        load();
        loadComplaints();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, loadComplaints]);

  // The alarm belongs to whoever is actually watching the board — a backgrounded
  // tab (e.g. on the counter terminal that is busy taking the order) stays quiet
  // and starts ringing again only when someone brings the board back up.
  useEffect(() => {
    const sync = () => setWatching(document.visibilityState === "visible" && document.hasFocus());
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, []);

  // localStorage isn't readable while rendering on the server, so pick up this
  // browser's outstanding asks after mount rather than on the first poll.
  useEffect(() => setAskedHere(getEtaAskIds()), []);

  // Drives the "x min ago" ticker on every slip from one timer.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Browsers block audio until the page has been interacted with, so unlock on
  // the first gesture anywhere on the board.
  useEffect(() => {
    let cancelled = false;
    unlockAlertSound().then((ok) => {
      if (!cancelled) setSoundOn(ok);
    });
    const onGesture = () => {
      if (alertSoundReady()) return;
      unlockAlertSound().then((ok) => setSoundOn(ok));
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, []);

  const pendingNew = useMemo(
    () => orders.filter((o) => o.kitchen_status === "new"),
    [orders],
  );

  /**
   * What actually raises the alarm: unacknowledged orders that were NOT rung up
   * on this machine. A POS terminal keeping the board open already knows about
   * the bill its operator just typed in — the slip still appears and still has
   * to be acknowledged, it just doesn't ring here.
   */
  const alerting = useMemo(() => {
    const mine = getLocalOrderIds();
    return pendingNew.filter((o) => !mine.has(o.id));
  }, [pendingNew]);

  /**
   * Complaints nobody in the back has acknowledged — minus any logged from this
   * browser, exactly as with the new-order chime: the person who typed it in on
   * the Sales screen doesn't need telling about it.
   */
  const complaintsUnseen = useMemo(() => {
    const mine = getLocalComplaintIds();
    return complaints.filter((c) => c.status === "new" && !mine.has(c.id));
  }, [complaints]);

  /** Still open (acknowledged or not) — what the tab counts. */
  const complaintsOpen = useMemo(
    () => complaints.filter((c) => c.status !== "resolved"),
    [complaints],
  );

  /**
   * Orders the front desk is waiting on a preparation time for — minus any this
   * browser asked about itself, exactly as with the new-order chime.
   */
  const timeAsked = useMemo(
    () =>
      orders.filter(
        (o) => o.eta_requested_at && o.kitchen_status !== "ready" && !askedHere.has(o.id),
      ),
    [orders, askedHere],
  );

  // Keep chiming while someone is on the board and an outside order is waiting.
  const newOrderAlarm = soundOn && watching && alerting.length > 0;
  useEffect(() => {
    if (newOrderAlarm) startAlertSound();
    else stopAlertSound();
  }, [newOrderAlarm]);

  // A complaint rings with its own (low, falling) sound, and keeps ringing until
  // someone in the back presses OK on the Complaints tab. Which of the three
  // alarms is actually audible is decided in `lib/alertSound.ts` — only one
  // plays at a time, and a landed order outranks a complaint.
  const complaintAlarm = soundOn && watching && complaintsUnseen.length > 0;
  useEffect(() => {
    if (complaintAlarm) startComplaintSound();
    else stopComplaintSound();
  }, [complaintAlarm]);

  // One alarm at a time: a fresh order outranks a time question, and two chimes
  // playing over each other would be impossible to tell apart — which is the
  // entire point of giving the time question its own sound.
  const timeAlarm = soundOn && watching && !newOrderAlarm && timeAsked.length > 0;
  useEffect(() => {
    if (timeAlarm) startTimeQuestionSound();
    else stopTimeQuestionSound();
  }, [timeAlarm]);

  useEffect(
    () => () => {
      stopAlertSound();
      stopTimeQuestionSound();
      stopComplaintSound();
    },
    [],
  );

  // Waiting counts in the tab title, for when the board isn't in front.
  useEffect(() => {
    const parts: string[] = [];
    if (alerting.length > 0) parts.push(`(${alerting.length}) New orders`);
    if (complaintsUnseen.length > 0) parts.push(`⚠ ${complaintsUnseen.length} complaints`);
    if (timeAsked.length > 0) parts.push(`⏱ ${timeAsked.length} time asked`);
    document.title = parts.join(" · ") || "Orders";
  }, [alerting.length, complaintsUnseen.length, timeAsked.length]);

  async function setStatus(order: KitchenOrder, status: KitchenStatus) {
    setBusyId(order.id);
    overrides.current.set(order.id, { status, until: Date.now() + OVERRIDE_GRACE_MS });
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, kitchen_status: status } : o)));
    try {
      const updated = await api.post<KitchenOrder>(`/orders/${order.id}/kitchen-status`, {
        kitchen_status: status,
      });

      // A 200 is not proof it saved — if the row came back unchanged, every
      // other screen (front desk) would keep showing the order as new while
      // this one pretends it moved on. Surface it instead of hiding it.
      if (updated?.kitchen_status !== status) {
        overrides.current.delete(order.id);
        setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
        setError(
          `Bill #${order.order_number}: the server accepted the request but did not save "${status}" ` +
            `(it still reads "${updated?.kitchen_status ?? "unknown"}"). Other screens will show the ` +
            `old status — check the API deployment.`,
        );
        return;
      }

      // Otherwise the override stays briefly: dropping it here would let a poll
      // already in flight, still carrying the old status, revert the slip.
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setError("");
    } catch (e) {
      // Put the slip back the way it was — a poll may be in flight, in which
      // case load() no-ops and nothing else would undo the optimistic change.
      overrides.current.delete(order.id);
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, kitchen_status: order.kitchen_status } : o)),
      );
      setError((e as Error).message || "Could not update the order — try again.");
      load();
    } finally {
      setBusyId(null);
    }
  }

  /** Front desk: "the customer is asking — how long?" */
  async function askTime(order: KitchenOrder) {
    setBusyId(order.id);
    // Recorded before the request so an alarm can't beat the response back and
    // ring this terminal about the question it is in the middle of raising.
    setAskedHere(rememberEtaAsk(order.id));
    try {
      const updated = await api.post<KitchenOrder>(`/orders/${order.id}/eta-request`, {});
      etaWrites.current.set(order.id, { order: updated, until: Date.now() + OVERRIDE_GRACE_MS });
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setError("");
    } catch (e) {
      setAskedHere(forgetEtaAsk(order.id));
      setError((e as Error).message || "Could not ask the kitchen — try again.");
    } finally {
      setBusyId(null);
    }
  }

  /** Kitchen: answer with the minutes still needed. */
  async function setEta(order: KitchenOrder, minutes: number) {
    setBusyId(order.id);
    try {
      const updated = await api.post<KitchenOrder>(`/orders/${order.id}/eta`, { minutes });
      etaWrites.current.set(order.id, { order: updated, until: Date.now() + OVERRIDE_GRACE_MS });
      // Answered — this board has nothing outstanding on it any more.
      setAskedHere(forgetEtaAsk(order.id));
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setError("");
    } catch (e) {
      setError((e as Error).message || "Could not send the time — try again.");
      load();
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Kitchen presses OK on a complaint: "we have seen this". It stops the alarm
   * and nothing else — the complaint stays open until the front desk closes it,
   * because whether the customer is satisfied is not the kitchen's call.
   */
  async function markComplaintSeen(complaint: OrderComplaint) {
    setComplaintBusyId(complaint.id);
    // Optimistic, and held over an in-flight poll: the alarm has to stop on the
    // press, not a round trip later.
    complaintAcks.current.set(complaint.id, Date.now() + OVERRIDE_GRACE_MS);
    setComplaints((prev) =>
      prev.map((c) => (c.id === complaint.id ? { ...c, status: "seen" as const } : c)),
    );
    try {
      const updated = await api.post<OrderComplaint>(`/complaints/${complaint.id}/seen`, {});
      setComplaints((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setError("");
    } catch (e) {
      // Put it back — otherwise the kitchen is left believing the back office
      // knows about a complaint that is still marked unseen everywhere else.
      complaintAcks.current.delete(complaint.id);
      setComplaints((prev) => prev.map((c) => (c.id === complaint.id ? complaint : c)));
      setError((e as Error).message || "Could not acknowledge the complaint — try again.");
    } finally {
      setComplaintBusyId(null);
    }
  }

  const counts = useMemo(
    () => ({
      new: pendingNew.length,
      received: orders.filter((o) => o.kitchen_status === "received").length,
      ready: orders.filter((o) => o.kitchen_status === "ready").length,
      all: orders.length,
    }),
    [orders, pendingNew.length],
  );

  const visible = useMemo(() => {
    // The complaints tab renders its own list; this stays on the slips so the
    // board doesn't recompute when a complaint lands.
    if (filter === "complaints") return [];
    const list =
      filter === "all"
        ? orders
        : filter === "ready"
          ? orders.filter((o) => o.kitchen_status === "ready")
          : orders.filter((o) => o.kitchen_status !== "ready");

    // Newest first: the order that just landed belongs at the top of the board,
    // where the kitchen is looking. The feed arrives oldest-first, so sort a
    // copy — `orders` itself stays in server order.
    //
    // Ahead of that, an unanswered time question wins: someone is standing at
    // the counter waiting on it, and the slip is by definition old enough to
    // have sunk down the board.
    return [...list].sort((a, b) => {
      const asked = Number(Boolean(b.eta_requested_at)) - Number(Boolean(a.eta_requested_at));
      if (asked !== 0) return asked;
      const byTime = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return byTime !== 0 ? byTime : b.id - a.id;
    });
  }, [orders, filter]);

  const tabs: { key: Filter; label: string; count: number; alert?: boolean }[] = [
    { key: "active", label: "Active", count: counts.new + counts.received },
    { key: "ready", label: "Ready", count: counts.ready },
    { key: "all", label: "All today", count: counts.all },
    // Counts what is still open, but pulses on what is unacknowledged — the
    // number is the workload, the pulse is the thing making a noise.
    {
      key: "complaints",
      label: "⚠ Complaints",
      count: complaintsOpen.length,
      alert: complaintsUnseen.length > 0,
    },
  ];

  return (
    <>
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-ink">Kitchen Orders</h1>
            <p className="text-sm text-gray-500">
              {new Date().toLocaleDateString("en-GB", {
                weekday: "long",
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => (soundOn ? setSoundOn(false) : unlockAlertSound().then(setSoundOn))}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                soundOn
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "bg-brand-yellow text-brand-ink hover:brightness-95"
              }`}
              title={soundOn ? "Alert sound is on — click to mute" : "Alert sound is off — click to enable"}
            >
              {soundOn ? "🔔 Sound on" : "🔕 Sound off"}
            </button>

            <button
              onClick={load}
              className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
            >
              Refresh
            </button>

            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {updatedAt
                ? `Updated ${new Date(updatedAt).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}`
                : "Connecting…"}
            </div>
          </div>
        </div>

        {/* Status counters + filter tabs */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === tab.key
                  ? "bg-brand-red text-white"
                  : tab.alert
                    ? "animate-pulse bg-red-100 text-brand-red hover:bg-red-200"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 opacity-80">{tab.count}</span>
            </button>
          ))}

          <span className="ml-auto flex items-center gap-3 text-xs font-medium">
            {complaintsUnseen.length > 0 && (
              <span className="flex items-center gap-1.5 rounded-md bg-red-100 px-2 py-1 font-semibold text-brand-red">
                ⚠ Complaints {complaintsUnseen.length}
              </span>
            )}
            {timeAsked.length > 0 && (
              <span className="flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-1 font-semibold text-amber-800">
                ⏱ Time asked {timeAsked.length}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-brand-red">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-red" /> New {counts.new}
            </span>
            <span className="flex items-center gap-1.5 text-amber-600">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> In kitchen {counts.received}
            </span>
            <span className="flex items-center gap-1.5 text-emerald-600">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Ready {counts.ready}
            </span>
          </span>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
      </header>

      {/* Board */}
      <main className="flex-1 overflow-y-auto p-6">
        {filter === "complaints" ? (
          complaints.length === 0 ? (
            <div className="py-20 text-center">
              <div className="text-4xl">🙂</div>
              <p className="mt-3 font-medium text-gray-600">No complaints today.</p>
              <p className="text-sm text-gray-400">
                One logged at the counter appears here straight away, with its own alarm.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {complaints.map((complaint) => (
                <ComplaintCard
                  key={complaint.id}
                  complaint={complaint}
                  now={now}
                  busy={complaintBusyId === complaint.id}
                  onSeen={() => markComplaintSeen(complaint)}
                />
              ))}
            </div>
          )
        ) : loading ? (
          <div className="py-20 text-center text-gray-400">Loading orders…</div>
        ) : visible.length === 0 ? (
          <div className="py-20 text-center">
            <div className="text-4xl">🍕</div>
            <p className="mt-3 font-medium text-gray-600">
              {filter === "ready" ? "Nothing marked ready yet." : "No orders on the board right now."}
            </p>
            <p className="text-sm text-gray-400">New orders appear here automatically.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((order) => (
              <OrderSlip
                key={order.id}
                order={order}
                now={now}
                busy={busyId === order.id}
                askedHere={askedHere.has(order.id)}
                onReceived={() => setStatus(order, "received")}
                onReady={() => setStatus(order, "ready")}
                onUnready={() => setStatus(order, "received")}
                onAskTime={kitchenOnly ? undefined : () => askTime(order)}
                onSetEta={(minutes) => setEta(order, minutes)}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

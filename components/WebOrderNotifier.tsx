"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { isKitchenUser, useAuth } from "@/lib/auth";
import type { KitchenFeed, KitchenOrder } from "@/lib/types";
import { formatPKR } from "@/lib/currency";
import { clockTime, elapsed } from "@/components/OrderSlip";
import {
  alertSoundReady,
  startWebOrderSound,
  stopWebOrderSound,
  unlockAlertSound,
} from "@/lib/alertSound";
import { dismissWebOrder, getDismissedWebOrders } from "@/lib/webOrderAcks";

/**
 * Announces an order placed on the website — and only announces it.
 *
 * The staff **phone the customer to verify an online order** before it is
 * cooked, and that call does not happen in the seconds after the chime starts.
 * So the alert carries a single **OK**: it says "I have seen this", stops the
 * sound and gets out of the way. Deciding the order's fate belongs on the
 * counter board (`/counter`), where it waits with *Send to kitchen* / *Cancel*
 * for as long as the call takes.
 *
 * That is why dismissal is remembered locally (`lib/webOrderAcks.ts`) rather
 * than read off the order: a dismissed order is still waiting, so its own state
 * cannot say whether anyone has looked at it. The restaurant has one counter,
 * so there is no second terminal to agree with — only a page reload to survive.
 *
 * Mounted in the app shell and on `/billing` so it follows the operator;
 * `/orders` included, where it cannot collide with the kitchen board's alarm
 * because an unverified order is not on that board at all.
 */

const POLL_MS = 10000;
/**
 * How recent an unhandled online order has to be to still be worth ringing
 * about. Past this the card stays — nobody has dealt with it — but the room
 * stops being alarmed, so a terminal opened at the end of the day doesn't chime
 * over the lunch rush.
 */
const ALARM_WINDOW_MINS = 60;

function itemCount(order: KitchenOrder): number {
  return order.items.reduce((n, item) => n + item.quantity, 0);
}

export default function WebOrderNotifier() {
  // A kitchen login is by definition not the counter, and the API 403s it on
  // this feed anyway — polling would only produce errors in the back.
  const { user } = useAuth();
  const enabled = !isKitchenUser(user);

  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(() => new Set());
  const [soundOn, setSoundOn] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const polling = useRef(false);

  const load = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      // The counter's whole board — sent and cancelled orders come back too,
      // which is what the page needs; the alert wants only what is still
      // waiting on the phone call.
      const feed = await api.get<KitchenFeed>("/orders/counter");
      setOrders(feed.orders.filter((o) => !o.released_at && o.status !== "cancelled"));
      setNow(Date.now());
    } catch {
      // Silent: a blip in polling must not disturb whatever the operator is
      // doing. The next tick recovers.
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  // Drives the "6 min ago" labels and ages orders out of the alarm window.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Browsers block audio until the page has been interacted with, so unlock on
  // the first gesture anywhere — the same handshake the orders board uses.
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  // localStorage isn't readable while rendering on the server, so pick this
  // browser's dismissals up after mount rather than on the first poll.
  useEffect(() => setDismissed(getDismissedWebOrders()), []);

  /** Not yet seen by anyone here. Newest first — where the eye starts. */
  const pending = useMemo(
    () =>
      orders
        .filter((o) => !dismissed.has(o.id))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [orders, dismissed],
  );

  const alarming = useMemo(
    () => pending.filter((o) => now - new Date(o.created_at).getTime() < ALARM_WINDOW_MINS * 60000),
    [pending, now],
  );

  // Unlike the kitchen board this does NOT wait for the tab to be focused: the
  // point is to reach a counter that is looking at something else.
  const ringing = enabled && soundOn && alarming.length > 0;
  useEffect(() => {
    if (ringing) startWebOrderSound();
    else stopWebOrderSound();
  }, [ringing]);

  useEffect(() => () => stopWebOrderSound(), []);

  if (!enabled || pending.length === 0) return null;

  return (
    // Positioning belongs to the shared column in `components/CounterAlerts.tsx`
    // now that the ready-order toast wants the same corner — a second `fixed`
    // box here would stack the two on the same pixels and bury this one.
    <div role="alert" aria-live="assertive" className="pointer-events-auto flex flex-col gap-2">
      {pending.length > 1 && (
        <div className="rounded-lg bg-brand-ink px-3 py-2 text-sm font-semibold text-white shadow-soft">
          {pending.length} online orders waiting
        </div>
      )}

      {pending.map((order) => (
        <div
          key={order.id}
          className="rounded-xl border-2 border-brand-red bg-white shadow-soft ring-4 ring-brand-red/25"
        >
          <div className="flex items-start justify-between gap-2 border-b border-dashed border-gray-300 px-4 py-2.5">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-brand-red">
                🛵 New online order
              </div>
              <div className="font-mono text-2xl font-extrabold leading-none text-brand-ink">
                #{order.order_number}
              </div>
            </div>
            <div className="text-right">
              <span className="inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                {order.order_type}
              </span>
              <div className="mt-1 font-mono text-xs text-gray-500">
                {clockTime(order.created_at)} · {elapsed(order.created_at, now)}
              </div>
            </div>
          </div>

          <div className="px-4 py-2.5 font-mono text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-gray-600">
                {itemCount(order)} item{itemCount(order) === 1 ? "" : "s"}
              </span>
              <span className="text-lg font-extrabold text-brand-ink">{formatPKR(order.total)}</span>
            </div>

            <ul className="mt-2 space-y-1 text-xs">
              {order.items.map((item) => (
                <li key={item.id} className="flex gap-2">
                  <span className="font-bold text-brand-red">{item.quantity}×</span>
                  <span className="flex-1 text-brand-ink">
                    {item.item_name}
                    {item.size ? <span className="text-gray-500"> ({item.size})</span> : null}
                  </span>
                </li>
              ))}
            </ul>

            {/* Customer, address and payment method come across in the notes —
                the counter needs them to call back and dispatch, and they are
                the whole reason this order stops here first. */}
            {order.notes && order.notes.trim() && (
              <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-line rounded-md bg-brand-cream px-3 py-2 text-xs leading-relaxed text-brand-ink">
                {order.notes.trim()}
              </div>
            )}
          </div>

          {/* OK only silences the alarm — the order still has to be verified by
              phone — so the card has to say where it went, or dismissing it
              would look like disposing of it. */}
          <div className="border-t border-dashed border-gray-300 px-4 pt-2.5">
            <p className="text-[11px] leading-snug text-gray-500">
              Call the customer to confirm, then send it to the kitchen or cancel it on{" "}
              <Link href="/counter" className="font-semibold text-brand-red hover:underline">
                Orders / Counter
              </Link>
              .
            </p>
          </div>

          <div className="flex items-center gap-2 px-4 pb-2.5 pt-2">
            <button
              onClick={() => setDismissed(dismissWebOrder(order.id))}
              className="flex-1 rounded-lg bg-brand-red py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-red-dark"
            >
              OK
            </button>
            {!soundOn && (
              <button
                onClick={() => unlockAlertSound().then(setSoundOn)}
                title="The browser has blocked the alert sound — click to enable it"
                className="flex-shrink-0 rounded-lg bg-brand-yellow px-2.5 py-2.5 text-xs font-semibold text-brand-ink transition-colors hover:brightness-95"
              >
                🔕
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

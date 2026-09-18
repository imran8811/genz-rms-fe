"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { isKitchenUser, useAuth } from "@/lib/auth";
import type { KitchenFeed, KitchenOrder } from "@/lib/types";
import { clockTime } from "@/components/OrderSlip";
import { alertSoundReady, playReadyPing, unlockAlertSound } from "@/lib/alertSound";

/**
 * The kitchen's alert back to the front desk: raises a **toast** in the corner of
 * whatever RMS screen is open when an order is marked ready, so the counter knows
 * to collect it without watching the board — and **pings** once as it does.
 *
 * The two halves cover each other. The front desk is usually looking at a
 * customer rather than at a screen, so a silent toast was being missed until
 * somebody happened to glance over; the ping is the half that works when nobody
 * is watching. It plays once and is gone, so the toast is still the half that
 * survives being missed — it stays up until it is dismissed.
 *
 * The toast is the whole *visible* alert — there is no OS notification behind
 * it, and the ping is not one either: it is synthesised in `lib/alertSound.ts`
 * and comes out of the page, so nothing about it can be silenced, throttled or
 * refused by the OS while the tab is open. This was
 * a desktop notification until the counter laptop became a tablet, at which point
 * it stopped working entirely and silently: `new Notification(...)` throws on
 * Android Chrome, the throw was caught, and nobody was told anything. A pop-up
 * the OS is free to silence, throttle or refuse was the wrong carrier for
 * something the front desk has to act on; drawing it in the page cannot fail that
 * way. **Don't reintroduce a notification as a "fallback"** — on the tablet the
 * browser freezes this poll the moment it is backgrounded, so the fallback would
 * not fire in the very case it was added for, and it would double-alert in every
 * other. Reaching a backgrounded tablet needs real Web Push (VAPID keys plus a
 * send from `genz-rms-apis`), not the Notification API.
 *
 * Renders into the shared column in `components/CounterAlerts.tsx`, below the
 * online-order alarm — it must never cover an order still waiting to be verified.
 *
 * Stays quiet on `/orders`: the kitchen board already shows these slips, and the
 * person who pressed "Ready" doesn't need telling. Quiet for a **kitchen login**
 * anywhere, for the same reason — it can now open `/complaints`, and this alert
 * is the kitchen talking to the front desk, not to itself.
 */

const POLL_MS = 10000;

type ReadyToast = {
  /** Order id — also the dedupe key, so one order can only hold one toast. */
  id: number;
  orderNumber: string;
  summary: string;
};

function summarise(order: KitchenOrder): string {
  const count = order.items.reduce((n, item) => n + item.quantity, 0);
  return `${order.order_type} · ${count} item${count === 1 ? "" : "s"} · ready ${clockTime(order.ready_at)}`;
}

export default function ReadyOrderNotifier() {
  const pathname = usePathname();
  const { user } = useAuth();
  const enabled = !pathname.startsWith("/orders") && !isKitchenUser(user);

  const [toasts, setToasts] = useState<ReadyToast[]>([]);
  /** Whether the browser has let the audio context start — see the unlock below. */
  const [soundOn, setSoundOn] = useState(false);

  /** Orders already announced, so a poll every 10s doesn't re-announce them. */
  const announced = useRef(new Set<number>());
  /** The first poll only records what is already ready — no backlog of toasts. */
  const primed = useRef(false);
  const polling = useRef(false);

  /**
   * A toast stays up until the front desk closes it. It used to time out after
   * 30s, which meant an order could go ready while nobody was looking at the
   * counter screen and the only trace of it was gone by the time somebody was —
   * the alert has to survive being missed. Clearing it is an acknowledgement,
   * so the ✕ is the only thing that takes one down.
   */
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const raise = useCallback((order: KitchenOrder) => {
    const toast: ReadyToast = {
      id: order.id,
      orderNumber: order.order_number,
      summary: summarise(order),
    };
    setToasts((current) => [...current.filter((t) => t.id !== toast.id), toast]);
  }, []);

  const load = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const feed = await api.get<KitchenFeed>("/orders/kitchen");
      const ready = feed.orders.filter((o) => o.kitchen_status === "ready");

      let raised = 0;
      for (const order of ready) {
        if (announced.current.has(order.id)) continue;
        if (primed.current) {
          raise(order);
          raised += 1;
        }
        announced.current.add(order.id);
      }

      // One ping for the poll rather than one per order: two things coming off
      // the pass inside the same 10s window is still one trip to the hatch, and
      // the toasts say how many. The priming poll raises nothing, so a page
      // reload is silent as well as toast-free.
      if (raised > 0) playReadyPing();

      // Anything no longer ready (day rolled over, kitchen stepped it back) can
      // be forgotten, so it alerts again if it comes off the pass a second time.
      const ids = new Set(ready.map((o) => o.id));
      for (const id of [...announced.current]) {
        if (!ids.has(id)) announced.current.delete(id);
      }
      primed.current = true;
    } catch {
      // Silent: a blip in polling must not disturb whatever the operator is
      // doing. The next tick recovers.
    } finally {
      polling.current = false;
    }
  }, [raise]);

  /**
   * Browsers refuse to start an audio context until the page has been
   * interacted with, so try immediately (it works on a soft navigation, where
   * the gesture already happened) and otherwise wait for the first click or
   * keypress anywhere — the same handshake the orders board and
   * `WebOrderNotifier` use. At a till that first gesture arrives within
   * seconds; the amber "beep is blocked" row below covers the case where the
   * screen has been sitting untouched since it was opened.
   */
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

  useEffect(() => {
    if (!enabled) {
      // Coming back from the board shouldn't re-announce what it already showed,
      // and a toast raised elsewhere shouldn't outlive the move onto it.
      announced.current.clear();
      primed.current = false;
      setToasts([]);
      return;
    }
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

  if (!enabled || toasts.length === 0) return null;

  return (
    <div role="status" aria-live="polite" className="pointer-events-auto flex flex-col gap-2">
      {/* The beep is the part of this alert that reaches someone serving a
          customer, so a browser still blocking audio is worth one line — once
          for the stack, not once per toast. Tapping it both unlocks the context
          and plays the ping, so the staff hear what they are listening for. */}
      {!soundOn && (
        <button
          type="button"
          onClick={() =>
            unlockAlertSound().then((ok) => {
              setSoundOn(ok);
              if (ok) playReadyPing();
            })
          }
          className="rounded-lg bg-brand-yellow px-3 py-2 text-left text-xs font-semibold text-brand-ink shadow-soft transition-[filter] hover:brightness-95"
        >
          🔕 Ready beep is blocked by the browser — tap to turn it on
        </button>
      )}

      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="relative rounded-xl border-2 border-emerald-500 bg-white shadow-soft ring-4 ring-emerald-500/20"
        >
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label={`Dismiss the ready alert for order #${toast.orderNumber}`}
            className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none text-gray-400 transition-colors hover:bg-gray-100 hover:text-brand-ink"
          >
            ✕
          </button>

          {/* pr-11 keeps the order number clear of the ✕ — at four digits it
              otherwise runs under it. */}
          <div className="px-4 py-3 pr-11">
            <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-600">
              ✅ Ready to collect
            </div>
            <div className="font-mono text-2xl font-extrabold leading-none text-brand-ink">
              #{toast.orderNumber}
            </div>
            <div className="mt-1.5 font-mono text-xs text-gray-500">{toast.summary}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import type { KitchenFeed, KitchenOrder } from "@/lib/types";
import { clockTime } from "@/components/OrderSlip";

/**
 * The kitchen's alert back to the front desk: raises a **toast** in the corner of
 * whatever RMS screen is open when an order is marked ready, so the counter knows
 * to collect it without watching the board.
 *
 * The toast is the whole alert — there is no OS notification behind it. This was
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
 * person who pressed "Ready" doesn't need telling.
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
  const enabled = !pathname.startsWith("/orders");

  const [toasts, setToasts] = useState<ReadyToast[]>([]);

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

      for (const order of ready) {
        if (announced.current.has(order.id)) continue;
        if (primed.current) raise(order);
        announced.current.add(order.id);
      }

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

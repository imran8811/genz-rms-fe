"use client";

import ReadyOrderNotifier from "@/components/ReadyOrderNotifier";
import WebOrderNotifier from "@/components/WebOrderNotifier";

/**
 * The counter's alert corner — one fixed top-right column that both notifiers
 * render into, mounted wherever the front desk works (`(rms)` layout, `/billing`).
 *
 * Each notifier used to position itself, which was fine while only one of them
 * drew anything on screen. Now that a ready order raises a **toast** rather than
 * a desktop notification, both want the same corner, and separately-positioned
 * `fixed` boxes would have been stacked on the same pixels — burying the online
 * order card, which is the one that needs a phone call. Sharing a column means
 * neither can cover the other.
 *
 * Order matters: the online-order alarm sits **above** ready toasts, because it
 * is the one holding up an unverified order.
 *
 * The column itself ignores pointer events, so an empty or short stack can't
 * swallow taps on the POS behind it; each card turns them back on for itself.
 */
export default function CounterAlerts() {
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[60] flex max-h-[calc(100vh-1.5rem)] w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-y-auto">
      <WebOrderNotifier />
      <ReadyOrderNotifier />
    </div>
  );
}

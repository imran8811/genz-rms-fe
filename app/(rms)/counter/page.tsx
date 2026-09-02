"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { KitchenFeed, KitchenOrder } from "@/lib/types";
import { formatPKR } from "@/lib/currency";
import { clockTime, elapsed } from "@/components/OrderSlip";

/**
 * The counter's board — what `/orders` is to the kitchen.
 *
 * Orders placed on the website land here rather than in the kitchen: the staff
 * **phone the customer to verify** before anything is cooked, and only then is
 * the order sent through. Until that call happens it sits in **Waiting**, which
 * is the whole point of the page — the arrival alert is dismissible in one tap
 * precisely because this is where the order keeps waiting.
 *
 * Sending releases the order that already exists (`POST /orders/{id}/release`)
 * rather than creating a counter copy, so one sale stays one row and Sales
 * counts the money once. Cancelling (`/reject`) takes it out of Sales entirely.
 */

const POLL_MS = 10000;

type Filter = "waiting" | "sent" | "cancelled" | "all";

function itemCount(order: KitchenOrder): number {
  return order.items.reduce((n, item) => n + item.quantity, 0);
}

function isWaiting(o: KitchenOrder): boolean {
  return !o.released_at && o.status !== "cancelled";
}

export default function CounterOrdersPage() {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("waiting");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const polling = useRef(false);

  const load = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const feed = await api.get<KitchenFeed>("/orders/counter");
      setOrders(feed.orders);
      setUpdatedAt(Date.now());
      setNow(Date.now());
      setError("");
    } catch (e) {
      setError((e as Error).message || "Failed to load orders.");
    } finally {
      polling.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
  }, [load]);

  // Drives the "x min ago" ticker on every card from one timer.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const counts = useMemo(
    () => ({
      waiting: orders.filter(isWaiting).length,
      sent: orders.filter((o) => o.released_at && o.status !== "cancelled").length,
      cancelled: orders.filter((o) => o.status === "cancelled").length,
      all: orders.length,
    }),
    [orders],
  );

  // Waiting counts in the tab title, for when the counter is on another screen.
  useEffect(() => {
    document.title = counts.waiting > 0 ? `(${counts.waiting}) Counter` : "Counter";
  }, [counts.waiting]);

  const visible = useMemo(() => {
    const list =
      filter === "waiting"
        ? orders.filter(isWaiting)
        : filter === "sent"
          ? orders.filter((o) => o.released_at && o.status !== "cancelled")
          : filter === "cancelled"
            ? orders.filter((o) => o.status === "cancelled")
            : orders;

    // Newest first: the order that just landed is the one being called about.
    // The feed arrives oldest-first, so sort a copy.
    return [...list].sort((a, b) => {
      const byTime = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return byTime !== 0 ? byTime : b.id - a.id;
    });
  }, [orders, filter]);

  async function act(order: KitchenOrder, action: "release" | "reject") {
    setBusyId(order.id);
    setConfirmingId(null);
    try {
      const updated = await api.post<KitchenOrder>(`/orders/${order.id}/${action}`, {});
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setError("");
    } catch (e) {
      // Never assume it landed: if the release failed, the kitchen does not
      // have the order and the card has to keep saying it is waiting.
      setError((e as Error).message || "Could not update the order — try again.");
      load();
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "waiting", label: "Waiting", count: counts.waiting },
    { key: "sent", label: "Sent to kitchen", count: counts.sent },
    { key: "cancelled", label: "Cancelled", count: counts.cancelled },
    { key: "all", label: "All today", count: counts.all },
  ];

  return (
    <>
      <header className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-ink">Counter Orders</h1>
            <p className="text-sm text-gray-500">
              Orders from the website — call the customer to confirm, then send or cancel.
            </p>
          </div>

          <div className="flex items-center gap-2">
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === tab.key
                  ? "bg-brand-red text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 opacity-80">{tab.count}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="py-20 text-center text-gray-400">Loading orders…</div>
        ) : visible.length === 0 ? (
          <div className="py-20 text-center">
            <div className="text-4xl">🛵</div>
            <p className="mt-3 font-medium text-gray-600">
              {filter === "waiting"
                ? "No online orders waiting."
                : filter === "sent"
                  ? "Nothing sent to the kitchen yet today."
                  : filter === "cancelled"
                    ? "Nothing cancelled today."
                    : "No online orders today."}
            </p>
            <p className="text-sm text-gray-400">Orders from the website appear here automatically.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((order) => {
              const waiting = isWaiting(order);
              const cancelled = order.status === "cancelled";

              return (
                <div
                  key={order.id}
                  className={`flex flex-col rounded-xl border-2 bg-white shadow-soft ${
                    waiting
                      ? "border-brand-red ring-2 ring-brand-red/25"
                      : cancelled
                        ? "border-gray-200 opacity-75"
                        : "border-emerald-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 border-b border-dashed border-gray-300 px-4 py-3">
                    <div>
                      <div className="font-mono text-2xl font-extrabold leading-none text-brand-ink">
                        #{order.order_number}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-brand-ink px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                          {order.order_type}
                        </span>
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                          {order.source === "app" ? "App" : "Web"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold tracking-wide ${
                          waiting
                            ? "bg-brand-red text-white"
                            : cancelled
                              ? "bg-gray-400 text-white"
                              : "bg-emerald-600 text-white"
                        }`}
                      >
                        {waiting ? "TO VERIFY" : cancelled ? "CANCELLED" : "SENT"}
                      </span>
                      <div className="mt-1.5 font-mono text-xs text-gray-500">
                        {clockTime(order.created_at)}
                      </div>
                      <div className="font-mono text-xs font-semibold text-gray-400">
                        {elapsed(order.created_at, now)}
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 px-4 py-3 font-mono text-sm">
                    <ul className="space-y-2">
                      {order.items.map((item) => (
                        <li key={item.id}>
                          <div className="flex gap-2">
                            <span className="font-bold text-brand-red">{item.quantity}×</span>
                            <span className="flex-1 font-semibold text-brand-ink">
                              {item.item_name}
                              {item.size ? (
                                <span className="font-normal text-gray-500"> ({item.size})</span>
                              ) : null}
                            </span>
                          </div>
                          {item.deal_selections && item.deal_selections.length > 0 && (
                            <ul className="mt-0.5 pl-7 text-xs text-gray-600">
                              {item.deal_selections.map((sel, i) => (
                                <li key={i}>↳ {sel}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>

                    {/* Customer name, phone and address arrive in the notes —
                        this is the number the staff have to ring, so it is the
                        most important thing on the card. */}
                    {order.notes && order.notes.trim() && (
                      <div className="mt-3 whitespace-pre-line rounded-md bg-brand-cream px-3 py-2 text-xs leading-relaxed text-brand-ink">
                        {order.notes.trim()}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-dashed border-gray-300 px-4 py-3">
                    <div className="mb-3 flex items-baseline justify-between font-mono">
                      <span className="text-xs uppercase tracking-wide text-gray-500">
                        {itemCount(order)} item{itemCount(order) === 1 ? "" : "s"}
                      </span>
                      <span className="text-lg font-extrabold text-brand-ink">
                        {formatPKR(order.total)}
                      </span>
                    </div>

                    {waiting ? (
                      confirmingId === order.id ? (
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-xs text-gray-600">Cancel this order?</span>
                          <button
                            onClick={() => act(order, "reject")}
                            disabled={busyId === order.id}
                            className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                          >
                            Yes, cancel
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => act(order, "release")}
                            disabled={busyId === order.id}
                            className="flex-1 rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Send to kitchen
                          </button>
                          <button
                            onClick={() => setConfirmingId(order.id)}
                            disabled={busyId === order.id}
                            title="Customer did not confirm — cancel this order"
                            className="flex-shrink-0 rounded-lg border border-gray-300 px-3 py-3 text-sm font-semibold text-gray-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )
                    ) : cancelled ? (
                      <div className="rounded-lg bg-gray-100 py-2 text-center text-sm font-semibold text-gray-500">
                        Cancelled
                      </div>
                    ) : (
                      <div className="rounded-lg bg-emerald-50 py-2 text-center text-sm font-semibold text-emerald-700">
                        Sent to kitchen at {clockTime(order.released_at)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}

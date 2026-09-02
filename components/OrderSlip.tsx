"use client";

import { useState } from "react";
import type { KitchenOrder } from "@/lib/types";
import { formatPKR } from "@/lib/currency";

/**
 * How long a slip must have been on the board before the front desk can ask the
 * kitchen for a time. Under five minutes the only honest answer is "it just came
 * in" — and the kitchen has enough alarms without being asked about them.
 */
export const ETA_ASK_AFTER_MINS = 5;

const SOURCE_LABEL: Record<string, string> = {
  pos: "Counter",
  foodpanda: "Food Panda",
  web: "Online",
  app: "App",
};

const SOURCE_STYLE: Record<string, string> = {
  pos: "bg-slate-100 text-slate-700",
  foodpanda: "bg-pink-100 text-pink-700",
  web: "bg-indigo-100 text-indigo-700",
  app: "bg-violet-100 text-violet-700",
};

const STATUS_FRAME: Record<string, string> = {
  new: "border-brand-red ring-2 ring-brand-red/25",
  received: "border-amber-400",
  ready: "border-emerald-300",
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  new: { label: "NEW", className: "bg-brand-red text-white animate-pulse" },
  received: { label: "IN KITCHEN", className: "bg-amber-500 text-white" },
  ready: { label: "READY", className: "bg-emerald-600 text-white" },
};

/**
 * An API that is a version ahead/behind (or a column that hasn't been migrated
 * yet) can hand us a status this build has never heard of. A slip must still
 * render: a blank status means the order is unacknowledged, and an unknown one
 * is shown as-is in grey rather than being dressed up as something it isn't.
 */
function statusStyle(status: KitchenOrder["kitchen_status"] | null | undefined) {
  if (!status) return { frame: STATUS_FRAME.new, badge: STATUS_BADGE.new };
  return {
    frame: STATUS_FRAME[status] ?? "border-gray-300",
    badge: STATUS_BADGE[status] ?? { label: String(status).toUpperCase(), className: "bg-gray-400 text-white" },
  };
}

export function clockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "just now" / "6 min" / "1h 12m" since `iso`, measured against `now` (ms). */
export function elapsed(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Minutes still to go on the kitchen's estimate, counted down from when it was
 * given — quoting the raw answer half an hour later would be a lie. `null` when
 * the kitchen has not answered.
 */
export function etaRemaining(order: KitchenOrder, now: number): number | null {
  if (order.eta_minutes == null || !order.eta_set_at) return null;
  const sinceMins = (now - new Date(order.eta_set_at).getTime()) / 60000;
  return Math.max(0, Math.ceil(order.eta_minutes - sinceMins));
}

interface Props {
  order: KitchenOrder;
  /** Current time in ms — passed in so one timer drives every slip on the board. */
  now: number;
  onReceived?: () => void;
  onReady?: () => void;
  /** Marked ready by mistake — put the slip back on the active board. */
  onUnready?: () => void;
  /** Front desk: ask the kitchen how much longer this order will take. */
  onAskTime?: () => void;
  /** Kitchen: answer with the minutes still needed. */
  onSetEta?: (minutes: number) => void;
  /** This browser raised the outstanding question — so don't alarm it about its own. */
  askedHere?: boolean;
  busy?: boolean;
}

export default function OrderSlip({
  order,
  now,
  onReceived,
  onReady,
  onUnready,
  onAskTime,
  onSetEta,
  askedHere,
  busy,
}: Props) {
  const { frame, badge } = statusStyle(order.kitchen_status);
  const ageMins = Math.floor((now - new Date(order.created_at).getTime()) / 60000);
  const isLate = order.kitchen_status !== "ready" && ageMins >= 20;

  const [minutes, setMinutes] = useState("");

  const done = order.kitchen_status === "ready";
  /** A question is outstanding — the kitchen has not answered it yet. */
  const waiting = !done && Boolean(order.eta_requested_at);
  const remaining = done ? null : etaRemaining(order, now);
  const canAsk = !done && !waiting && ageMins >= ETA_ASK_AFTER_MINS;
  /** Only the screens that didn't ask get the amber alarm frame, so the front
   *  desk's own board stays readable while it waits. */
  const alarming = waiting && !askedHere;

  const submitEta = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 0) return;
    onSetEta?.(Math.round(value));
    setMinutes("");
  };

  return (
    <div
      className={`flex flex-col rounded-xl border-2 bg-white shadow-soft ${
        alarming ? "border-amber-500 ring-4 ring-amber-400/40" : frame
      } ${done ? "opacity-75" : ""}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-dashed border-gray-300 px-4 py-3">
        <div>
          <div className="font-mono text-2xl font-extrabold leading-none text-brand-ink">
            #{order.order_number}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-brand-ink px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
              {order.order_type}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                SOURCE_STYLE[order.source] ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {SOURCE_LABEL[order.source] ?? order.source ?? "—"}
            </span>
          </div>
        </div>
        <div className="text-right">
          <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold tracking-wide ${badge.className}`}>
            {badge.label}
          </span>
          <div className="mt-1.5 font-mono text-xs text-gray-500">{clockTime(order.created_at)}</div>
          <div className={`font-mono text-xs font-semibold ${isLate ? "text-brand-red" : "text-gray-400"}`}>
            {elapsed(order.created_at, now)}
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 px-4 py-3 font-mono text-sm">
        <ul className="space-y-2">
          {order.items.map((item) => (
            <li key={item.id}>
              <div className="flex gap-2">
                <span className="font-bold text-brand-red">{item.quantity}×</span>
                <span className="flex-1 font-semibold text-brand-ink">
                  {item.item_name}
                  {item.size ? <span className="font-normal text-gray-500"> ({item.size})</span> : null}
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

        {order.notes && order.notes.trim() && (
          <div className="mt-3 whitespace-pre-line rounded-md bg-brand-cream px-3 py-2 text-xs leading-relaxed text-brand-ink">
            {order.notes.trim()}
          </div>
        )}
      </div>

      {/* Preparation time: front desk asks, kitchen answers */}
      {waiting ? (
        <div className="border-t border-dashed border-amber-300 bg-amber-50 px-4 py-3">
          {askedHere ? (
            <>
              <div className="text-xs font-bold uppercase tracking-wide text-amber-800">
                ⏱ Waiting for the kitchen
              </div>
              <p className="mt-1 text-xs text-amber-700">
                Asked {elapsed(order.eta_requested_at!, now) === "just now"
                  ? "just now"
                  : `${elapsed(order.eta_requested_at!, now)} ago`}
                {" "}— the answer appears here.
              </p>
            </>
          ) : (
            <>
              <div className="text-xs font-bold uppercase tracking-wide text-amber-800">
                ⏱ Front desk asks: how many minutes left?
              </div>
              <form onSubmit={submitEta} className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={240}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="5"
                  aria-label={`Minutes still needed for order ${order.order_number}`}
                  className="w-20 rounded-lg border-2 border-amber-400 bg-white px-2 py-2 text-center font-mono text-xl font-bold text-brand-ink focus:border-amber-500 focus:outline-none"
                />
                <span className="text-sm font-medium text-amber-800">min</span>
                <button
                  type="submit"
                  disabled={busy || minutes.trim() === ""}
                  className="flex-1 rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
                >
                  Update
                </button>
              </form>
            </>
          )}
        </div>
      ) : remaining !== null ? (
        <div className="border-t border-dashed border-sky-200 bg-sky-50 px-4 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            Kitchen said ~{order.eta_minutes} min at {clockTime(order.eta_set_at)}
          </div>
          <div className="font-mono text-base font-extrabold text-sky-900">
            {remaining > 0 ? `≈ ${remaining} min left` : "time is up — chase the kitchen"}
          </div>
        </div>
      ) : null}

      {/* Total + actions */}
      <div className="border-t border-dashed border-gray-300 px-4 py-3">
        <div className="mb-3 flex items-baseline justify-between font-mono">
          <span className="text-xs uppercase tracking-wide text-gray-500">Total</span>
          <span className="text-lg font-extrabold text-brand-ink">{formatPKR(order.total)}</span>
        </div>

        {order.kitchen_status === "ready" ? (
          /* "Ready" is one tap away from the item list, so it does get pressed
             on the wrong slip. Undo sits deliberately small and to the side —
             far from where the big green button was — and puts the order back
             in the kitchen rather than at "new", which would set the
             new-order alarm off again over an order already being cooked. */
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-lg bg-emerald-50 py-2 text-center text-sm font-semibold text-emerald-700">
              Ready at {clockTime(order.ready_at)}
            </div>
            {onUnready && (
              <button
                onClick={onUnready}
                disabled={busy}
                title="Marked ready by mistake — put this order back on the active board"
                aria-label={`Undo ready for order ${order.order_number}`}
                className="flex-shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"
              >
                ↩ Undo
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            {/* Front desk: the customer is asking. Sits with the kitchen's own
                buttons — compact, so "Ready" stays the obvious one to press. */}
            {canAsk && onAskTime && (
              <button
                onClick={onAskTime}
                disabled={busy}
                title="Ask the kitchen how much longer this will take"
                className="flex-shrink-0 rounded-lg bg-brand-red px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-red-dark disabled:opacity-50"
              >
                ⏱ Time
              </button>
            )}
            {order.kitchen_status === "new" && onReceived && (
              <button
                onClick={onReceived}
                disabled={busy}
                className="flex-1 rounded-lg bg-slate-800 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
              >
                OK — Received
              </button>
            )}
            {onReady && (
              <button
                onClick={onReady}
                disabled={busy}
                className="flex-1 rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                Ready
              </button>
            )}
          </div>
        )}

        {order.kitchen_status === "received" && (
          <div className="mt-2 text-center text-[11px] text-gray-400">
            Received at {clockTime(order.received_at)}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import type { OrderComplaint } from "@/lib/types";
import { formatPKR } from "@/lib/currency";
import { clockTime, elapsed } from "@/components/OrderSlip";

/**
 * A customer complaint as the kitchen sees it, on the board's Complaints tab.
 *
 * Built like an order slip so it reads the same way from across the pass, with
 * two deliberate differences:
 * - **The complaint text is the card.** The bill is context — what the customer
 *   said is the thing being acted on, so it gets the size and the contrast, and
 *   the items sit underneath in small type for "which one was it?".
 * - **One button, OK — Seen.** It means "we know", nothing more: it stops the
 *   alarm and leaves the complaint open. Whether the customer ends up satisfied
 *   is settled at the counter (a refund, a remake, a phone call), and giving the
 *   kitchen a "Resolved" button here would let the back of house close a
 *   conversation it isn't having.
 */

interface Props {
  complaint: OrderComplaint;
  /** Current time in ms — one ticker drives every card, as on the slips. */
  now: number;
  busy?: boolean;
  /** Kitchen acknowledges it. Absent once the complaint is no longer `new`. */
  onSeen?: () => void;
}

export default function ComplaintCard({ complaint, now, busy, onSeen }: Props) {
  const order = complaint.order;
  const unseen = complaint.status === "new";
  const resolved = complaint.status === "resolved";

  const frame = unseen
    ? "border-brand-red ring-2 ring-brand-red/25"
    : resolved
      ? "border-emerald-300"
      : "border-amber-400";

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border-2 bg-white shadow-soft ${frame}`}>
      {/* Header: what came back, and when the complaint landed */}
      <div className="flex items-start justify-between gap-2 border-b border-dashed border-gray-300 px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                unseen
                  ? "animate-pulse bg-brand-red text-white"
                  : resolved
                    ? "bg-emerald-600 text-white"
                    : "bg-amber-500 text-white"
              }`}
            >
              {unseen ? "⚠ Complaint" : resolved ? "Resolved" : "Seen"}
            </span>
            <span className="truncate font-mono text-lg font-extrabold leading-none text-brand-ink">
              #{order?.order_number ?? complaint.order_id}
            </span>
          </div>
          <div className="mt-1 font-mono text-xs text-gray-500">
            {order ? `${order.order_type} · ${formatPKR(order.total)} · ` : ""}
            bill {clockTime(order?.created_at ?? null)}
          </div>
        </div>
        <div className="flex-shrink-0 text-right font-mono text-xs text-gray-500">
          <div className="font-semibold text-brand-ink">{clockTime(complaint.created_at)}</div>
          <div>{elapsed(complaint.created_at, now)} ago</div>
        </div>
      </div>

      {/* The complaint itself — the reason the card exists */}
      <div className="px-4 py-3">
        <p className="whitespace-pre-line text-sm font-medium leading-relaxed text-brand-ink">
          {complaint.body}
        </p>
        <div className="mt-2 text-[11px] text-gray-400">
          Logged by {complaint.logged_by_name?.trim() || "the front desk"}
          {complaint.seen_at && ` · seen ${clockTime(complaint.seen_at)}`}
          {complaint.resolved_at && ` · closed ${clockTime(complaint.resolved_at)}`}
        </div>
      </div>

      {/* What was on the bill — small, because it is the context, not the point */}
      {order && order.items.length > 0 && (
        <div className="border-t border-dashed border-gray-200 px-4 py-2.5">
          <ul className="space-y-0.5 font-mono text-[11px] text-gray-600">
            {order.items.map((item) => (
              <li key={item.id} className="flex gap-2">
                <span className="font-bold text-gray-400">{item.quantity}×</span>
                <span className="flex-1">
                  {item.item_name}
                  {item.size && <span className="text-gray-400"> ({item.size})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Acknowledgement. `mt-auto` keeps the button on the bottom edge so a row
          of cards with complaints of different lengths still has one action line. */}
      <div className="mt-auto border-t border-gray-200 px-4 py-2.5">
        {unseen && onSeen ? (
          <button
            onClick={onSeen}
            disabled={busy}
            className="w-full rounded-lg bg-brand-red py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-red-dark disabled:opacity-50"
          >
            {busy ? "…" : "OK — Seen"}
          </button>
        ) : (
          <p className="text-center text-[11px] text-gray-400">
            {resolved
              ? "Closed by the front desk."
              : "Acknowledged — the front desk closes it off."}
          </p>
        )}
      </div>
    </div>
  );
}

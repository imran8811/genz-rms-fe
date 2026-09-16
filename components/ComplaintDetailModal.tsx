"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/currency";
import type { KitchenOrder, OrderComplaint } from "@/lib/types";

/**
 * Everything about one complained-about order, opened by clicking its row on
 * the Complaints page: the full bill — items, charges, totals, notes, and how
 * the kitchen handled it on the night — above every complaint logged against it.
 *
 * The bill is shown in full rather than summarised because this modal is opened
 * to answer "what actually happened with this order?", usually with the
 * customer on the phone: which items, what was paid, when it was rung up, how
 * long the kitchen took. Reading that off a sales row and a complaint row
 * separately is how the wrong order gets refunded.
 *
 * **All complaints on the order, not just the one clicked.** A second complaint
 * about the same bill changes what to do about the first one, so they are shown
 * as one thread, oldest last.
 */

const SOURCE_LABEL: Record<string, string> = {
  pos: "Walk-in / Counter",
  foodpanda: "Food Panda",
  web: "Website",
  app: "App",
};

function dateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });
}

/** How long the kitchen had the order, when both ends of it are known. */
function prepTime(order: KitchenOrder): string {
  if (!order.ready_at) return "—";
  const mins = Math.round(
    (new Date(order.ready_at).getTime() - new Date(order.created_at).getTime()) / 60000,
  );
  if (mins < 1) return "under a minute";
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

interface Props {
  order: KitchenOrder;
  /** Every complaint on this order, newest first. */
  complaints: OrderComplaint[];
  onClose: () => void;
  /** A complaint that just changed state, so the page can update its row. */
  onChanged: (complaint: OrderComplaint) => void;
}

export default function ComplaintDetailModal({ order, complaints, onClose, onChanged }: Props) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  /** Which complaint is having a closing note written, and what it says. */
  const [closing, setClosing] = useState<{ id: number; note: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busyId === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busyId]);

  async function act(complaint: OrderComplaint, path: "resolve" | "reopen", body: unknown = {}) {
    setBusyId(complaint.id);
    setError("");
    try {
      const updated = await api.post<OrderComplaint>(`/complaints/${complaint.id}/${path}`, body);
      onChanged(updated);
      setClosing(null);
    } catch (e) {
      setError((e as Error).message || "Could not update the complaint — try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Order ${order.order_number} and its complaints`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-bold text-gray-900">
                {order.order_number}
              </span>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                {order.order_type}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {SOURCE_LABEL[order.source] ?? order.source}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  order.status === "completed"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {order.status}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-gray-400">{dateTime(order.created_at)}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 text-lg leading-none text-gray-400 transition-colors hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {/* ── The complaints ── */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
              Complaints ({complaints.length})
            </h3>
            <div className="space-y-3">
              {complaints.map((complaint) => {
                const resolved = complaint.status === "resolved";
                return (
                  <div
                    key={complaint.id}
                    className={`rounded-xl border p-4 ${
                      resolved ? "border-gray-200 bg-gray-50" : "border-brand-red/40 bg-red-50/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          complaint.status === "new"
                            ? "bg-brand-red text-white"
                            : resolved
                              ? "bg-emerald-600 text-white"
                              : "bg-amber-500 text-white"
                        }`}
                      >
                        {complaint.status === "new"
                          ? "Not seen by the kitchen"
                          : resolved
                            ? "Resolved"
                            : "Open · kitchen notified"}
                      </span>
                      <span className="text-xs text-gray-400">{dateTime(complaint.created_at)}</span>
                    </div>

                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-800">
                      {complaint.body}
                    </p>

                    <div className="mt-2 text-[11px] text-gray-400">
                      Logged by {complaint.logged_by_name?.trim() || "the front desk"}
                      {complaint.seen_at && ` · kitchen saw it ${clock(complaint.seen_at)}`}
                      {complaint.resolved_at && ` · closed ${clock(complaint.resolved_at)}`}
                    </div>

                    {complaint.resolution && (
                      <div className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-gray-700 ring-1 ring-gray-200">
                        <span className="font-semibold text-gray-500">Outcome: </span>
                        {complaint.resolution}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-3">
                      {closing?.id === complaint.id ? (
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <label className="mb-1.5 block text-xs font-medium text-gray-500">
                            What was done about it? (optional)
                          </label>
                          <textarea
                            value={closing.note}
                            onChange={(e) => setClosing({ id: complaint.id, note: e.target.value })}
                            rows={2}
                            maxLength={500}
                            placeholder="e.g. Remade and delivered, customer happy."
                            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => setClosing(null)}
                              className="flex-1 rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-400"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() =>
                                act(complaint, "resolve", { resolution: closing.note.trim() || null })
                              }
                              disabled={busyId === complaint.id}
                              className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {busyId === complaint.id ? "Saving…" : "Mark resolved"}
                            </button>
                          </div>
                        </div>
                      ) : resolved ? (
                        <button
                          onClick={() => act(complaint, "reopen")}
                          disabled={busyId === complaint.id}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-400 disabled:opacity-50"
                        >
                          {busyId === complaint.id ? "…" : "Reopen"}
                        </button>
                      ) : (
                        <button
                          onClick={() => setClosing({ id: complaint.id, note: "" })}
                          className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-100"
                        >
                          Mark resolved
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── The bill ── */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Order details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              {[
                { label: "Placed", value: clock(order.created_at) },
                { label: "Accepted by kitchen", value: clock(order.received_at) },
                { label: "Marked ready", value: clock(order.ready_at) },
                { label: "Time in kitchen", value: prepTime(order) },
              ].map((row) => (
                <div key={row.label}>
                  <div className="mb-0.5 text-xs text-gray-400">{row.label}</div>
                  <div className="font-medium text-gray-800">{row.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-gray-100">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2.5 text-left font-medium text-gray-500">Item</th>
                    <th className="px-4 py-2.5 text-right font-medium text-gray-500">Price</th>
                    <th className="px-4 py-2.5 text-center font-medium text-gray-500">Qty</th>
                    <th className="px-4 py-2.5 text-right font-medium text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5 text-gray-700">
                        <div className="font-medium">{item.item_name}</div>
                        {item.size && <div className="text-gray-400">{item.size}</div>}
                        {item.deal_selections && item.deal_selections.length > 0 && (
                          <div className="text-gray-400">{item.deal_selections.join(", ")}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">
                        {formatPKR(item.unit_price)}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-600">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-800">
                        {formatPKR(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 space-y-2 rounded-xl bg-gray-50 p-4 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatPKR(order.subtotal)}</span>
              </div>
              {order.extra_topping > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Extra Topping</span>
                  <span>{formatPKR(order.extra_topping)}</span>
                </div>
              )}
              {order.delivery_charge > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Delivery Charge</span>
                  <span>{formatPKR(order.delivery_charge)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-bold text-gray-900">
                <span>Total</span>
                <span>{formatPKR(order.total)}</span>
              </div>
            </div>

            {/* Customer, address and payment method arrive in `notes` on an
                online order — on a complaint call, that is the phone number. */}
            <div className="mt-3">
              <h4 className="mb-1.5 text-xs font-semibold text-gray-500">Order notes</h4>
              <p
                className={`whitespace-pre-line text-sm ${
                  order.notes ? "text-gray-700" : "italic text-gray-400"
                }`}
              >
                {order.notes || "No notes on this order."}
              </p>
            </div>
          </section>
        </div>

        <div className="flex-shrink-0 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

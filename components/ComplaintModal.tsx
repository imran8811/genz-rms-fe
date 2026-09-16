"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/currency";
import { rememberLocalComplaint } from "@/lib/localComplaints";
import type { OrderComplaint } from "@/lib/types";

/**
 * "The customer is complaining about this order" — the one thing the front desk
 * does with a complaint, opened from the ⚠ button on a Sales row.
 *
 * It is a single free-text box on purpose. A category dropdown was the obvious
 * alternative and is the wrong shape for the moment this gets used: someone is
 * on the phone, or standing at the counter with a cold pizza, and the complaint
 * is whatever they are saying. Sorting it into "quality / missing item / late"
 * is work for later, done by someone who isn't mid-conversation — and the
 * kitchen needs the sentence, not the bucket.
 *
 * Saving alarms the kitchen board immediately (see `lib/alertSound.ts`), so the
 * complaint is remembered locally (`lib/localComplaints.ts`) before it is shown
 * — a counter terminal with the board open in another tab must not chime at the
 * person who just typed it.
 */

/** The little an order has to expose to be complained about. */
export interface ComplaintOrderRef {
  id: number;
  order_number: string;
  order_type: string;
  total: number;
  created_at: string;
}

interface Props {
  order: ComplaintOrderRef;
  onClose: () => void;
  /** The saved complaint, so the caller can mark its row as "came back". */
  onLogged: (complaint: OrderComplaint) => void;
}

export default function ComplaintModal({ order, onClose, onLogged }: Props) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Straight into the box: this is opened with something to type already in
  // mind, and the click that opened it shouldn't need a second one to write.
  useEffect(() => inputRef.current?.focus(), []);

  // Escape closes, as everywhere else — but never mid-save, where it would look
  // like the complaint was discarded when it is already on its way.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const submit = async () => {
    const text = body.trim();
    if (!text || saving) return;
    setSaving(true);
    setError("");
    try {
      const complaint = await api.post<OrderComplaint>(`/orders/${order.id}/complaints`, {
        body: text,
      });
      rememberLocalComplaint(complaint.id);
      onLogged(complaint);
      onClose();
    } catch (e) {
      setError((e as Error).message || "Could not save the complaint — try again.");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Log a complaint against order ${order.order_number}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
              <span className="text-brand-red">⚠</span> Log a customer complaint
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Order <span className="font-mono font-semibold text-gray-700">{order.order_number}</span>{" "}
              · {order.order_type} · {formatPKR(order.total)} ·{" "}
              {new Date(order.created_at).toLocaleString("en-PK", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 text-lg leading-none text-gray-400 transition-colors hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          <label htmlFor="complaint-body" className="mb-1.5 block text-sm font-semibold text-gray-700">
            What did the customer say?
          </label>
          <textarea
            id="complaint-body"
            ref={inputRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="e.g. Pizza arrived cold and the garlic sauce was missing. Customer called at 9:40pm."
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
          />
          <div className="mt-1.5 flex items-center justify-between text-xs">
            {/* Says where this goes: pressing Save makes a noise in the kitchen,
                which is not what a "notes" box normally does. */}
            <span className="text-gray-400">The kitchen is alerted as soon as you save this.</span>
            <span className="text-gray-300">{body.trim().length}/2000</span>
          </div>

          {error && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
        </div>

        <div className="flex gap-3 border-t border-gray-100 px-5 py-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || body.trim().length === 0}
            className="flex-1 rounded-lg bg-brand-red py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-red-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Log complaint"}
          </button>
        </div>
      </div>
    </div>
  );
}

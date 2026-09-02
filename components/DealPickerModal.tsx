"use client";

import { useMemo, useState } from "react";
import type { CartLine, Menu, MenuItem } from "@/lib/types";
import { formatPKR } from "@/lib/currency";

interface Props {
  deal: MenuItem;
  menu: Menu;
  onClose: () => void;
  onAdd: (line: Omit<CartLine, "lineId">) => void;
}

export default function DealPickerModal({ deal, menu, onClose, onAdd }: Props) {
  const selection = deal.pizzaSelection!;

  const pizzaCategory = menu.categories.find((c) => c.id === "pizza");
  const choices = useMemo<MenuItem[]>(() => {
    if (!pizzaCategory) return [];
    return pizzaCategory.items.filter((it) => selection.from.includes(it.id));
  }, [pizzaCategory, selection.from]);

  const [picks, setPicks] = useState<string[]>([]);
  const [qty, setQty] = useState(1);

  const togglePick = (id: string) => {
    setPicks((prev) => {
      if (prev.includes(id)) {
        const idx = prev.indexOf(id);
        return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      }
      if (prev.length >= selection.count) {
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  const pickCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    picks.forEach((id) => {
      counts[id] = (counts[id] ?? 0) + 1;
    });
    return counts;
  }, [picks]);

  const addPick = (id: string) => {
    setPicks((prev) => (prev.length >= selection.count ? prev : [...prev, id]));
  };

  const removePick = (id: string) => {
    setPicks((prev) => {
      const idx = prev.lastIndexOf(id);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  };

  const remaining = selection.count - picks.length;
  const ready = remaining === 0 && qty > 0;

  const submit = () => {
    if (!ready) return;
    const pizzaNames = picks
      .map((id) => choices.find((c) => c.id === id)?.name)
      .filter((n): n is string => Boolean(n));
    const dealSelections = deal.dealExtras
      ? [...pizzaNames, ...deal.dealExtras]
      : pizzaNames;
    onAdd({
      itemId: deal.id,
      categoryId: "pizza",
      name: deal.name,
      size: undefined,
      unitPrice: deal.price ?? 0,
      quantity: qty,
      dealSelections,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{deal.name}</h3>
            {deal.description && (
              <p className="text-sm text-gray-500">{deal.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mb-3 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Pick <strong>{selection.count}</strong> {selection.size} pizza
          {selection.count > 1 ? "s" : ""} — {remaining} remaining
        </div>

        <div className="mb-4 max-h-72 space-y-2 overflow-y-auto pr-1">
          {choices.map((c) => {
            const count = pickCounts[c.id] ?? 0;
            return (
              <div
                key={c.id}
                className={[
                  "flex items-center justify-between rounded-xl border p-3",
                  count > 0 ? "border-brand-red bg-red-50" : "border-gray-200 bg-white",
                ].join(" ")}
              >
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                  {selection.count > 1 && count > 0 && (
                    <div className="text-[11px] text-gray-500">{count} selected</div>
                  )}
                </div>
                {selection.count === 1 ? (
                  <button
                    type="button"
                    onClick={() => togglePick(c.id)}
                    className={[
                      "min-h-[44px] rounded-lg px-4 py-2 text-sm font-semibold",
                      count > 0
                        ? "bg-brand-red text-white"
                        : "bg-gray-100 text-gray-700 active:bg-gray-200",
                    ].join(" ")}
                  >
                    {count > 0 ? "Selected" : "Pick"}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => removePick(c.id)}
                      disabled={count === 0}
                      className="h-10 w-10 rounded-lg border border-gray-200 text-lg font-bold text-gray-700 active:bg-gray-100 disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="min-w-[1.5rem] text-center text-base font-bold tabular-nums">
                      {count}
                    </span>
                    <button
                      type="button"
                      onClick={() => addPick(c.id)}
                      disabled={picks.length >= selection.count}
                      className="h-10 w-10 rounded-lg border border-gray-200 text-lg font-bold text-gray-700 active:bg-gray-100 disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Deal quantity
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="h-12 w-12 rounded-xl border border-gray-200 text-xl font-bold text-gray-700 active:bg-gray-100"
            >
              −
            </button>
            <div className="min-w-[3rem] text-center text-2xl font-bold tabular-nums">
              {qty}
            </div>
            <button
              type="button"
              onClick={() => setQty((q) => q + 1)}
              className="h-12 w-12 rounded-xl border border-gray-200 text-xl font-bold text-gray-700 active:bg-gray-100"
            >
              +
            </button>
          </div>
        </div>

        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="flex h-14 w-full items-center justify-between rounded-xl bg-brand-red px-5 text-base font-bold text-white shadow-soft transition active:bg-brand-red-dark disabled:bg-gray-300"
        >
          <span>Add to bill</span>
          <span>{formatPKR((deal.price ?? 0) * qty)}</span>
        </button>
      </div>
    </div>
  );
}

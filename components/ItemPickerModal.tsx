"use client";

import { useMemo, useState } from "react";
import type { CartLine, MenuCategory, MenuItem } from "@/lib/types";
import { formatPKR } from "@/lib/currency";

interface Props {
  category: MenuCategory;
  item: MenuItem;
  onClose: () => void;
  onAdd: (line: Omit<CartLine, "lineId">) => void;
  isFoodpanda: boolean | null;
  onFoodpandaChange: (value: boolean) => void;
}

export default function ItemPickerModal({ category, item, onClose, onAdd, isFoodpanda, onFoodpandaChange }: Props) {
  const sizes = category.type === "sized" ? category.sizes ?? [] : [];

  const initialSize = useMemo(() => {
    if (category.type !== "sized" || !item.prices) return undefined;
    if (item.defaultSize && typeof item.prices[item.defaultSize] === "number") {
      return item.defaultSize;
    }
    if (category.id === "pizza") {
      const large = sizes.find((s) => s === "Large" && typeof item.prices?.[s] === "number");
      if (large) return large;
    }
    return sizes.find((s) => typeof item.prices?.[s] === "number");
  }, [category.type, category.id, item.prices, item.defaultSize, sizes]);

  const [size, setSize] = useState<string | undefined>(initialSize);
  const [qty, setQty] = useState(1);

  const unitPrice = useMemo(() => {
    if (category.type === "single") return item.price ?? 0;
    if (size && item.prices && typeof item.prices[size] === "number") {
      return item.prices[size] as number;
    }
    return 0;
  }, [category.type, item, size]);

  const canAdd = unitPrice > 0 && qty > 0 && isFoodpanda !== null;

  const submit = () => {
    if (!canAdd) return;
    onAdd({
      itemId: item.id,
      categoryId: category.id,
      name: item.name,
      size,
      unitPrice,
      quantity: qty,
      dealSelections: item.dealExtras,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold text-gray-900">{item.name}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {item.description && (
          <p className="mb-3 text-sm text-gray-500">{item.description}</p>
        )}

        {category.type === "sized" && sizes.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Size
            </p>
            <div className="flex flex-wrap gap-2">
              {sizes.map((s) => {
                const price = item.prices?.[s];
                const disabled = typeof price !== "number";
                const isActive = size === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSize(s)}
                    className={[
                      "min-h-[48px] flex-1 rounded-xl border px-4 py-2 text-sm font-semibold transition",
                      disabled
                        ? "cursor-not-allowed border-gray-200 text-gray-300"
                        : isActive
                          ? "border-brand-red bg-brand-red text-white"
                          : "border-gray-200 bg-white text-gray-700 active:bg-gray-50",
                    ].join(" ")}
                  >
                    <div>{s}</div>
                    <div className="mt-0.5 text-[11px] font-medium opacity-80">
                      {disabled ? "—" : formatPKR(price as number)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Quantity
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

        <div
          className={[
            "mb-4 rounded-xl border p-3 transition",
            isFoodpanda === null
              ? "border-amber-300 bg-amber-50"
              : isFoodpanda
                ? "border-pink-400 bg-pink-50"
                : "border-gray-200 bg-white",
          ].join(" ")}
        >
          <div className="mb-2 flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke={isFoodpanda ? "#db2777" : "#6b7280"} strokeWidth={1.8} className="h-5 w-5">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            <span className="text-sm font-semibold text-gray-900">
              Is this a Food Panda order?
            </span>
            <span className="text-brand-red">*</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onFoodpandaChange(true)}
              className={[
                "min-h-[44px] rounded-lg border text-sm font-bold transition",
                isFoodpanda === true
                  ? "border-pink-500 bg-pink-500 text-white"
                  : "border-gray-200 bg-white text-gray-700 active:bg-gray-50",
              ].join(" ")}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => onFoodpandaChange(false)}
              className={[
                "min-h-[44px] rounded-lg border text-sm font-bold transition",
                isFoodpanda === false
                  ? "border-gray-700 bg-gray-700 text-white"
                  : "border-gray-200 bg-white text-gray-700 active:bg-gray-50",
              ].join(" ")}
            >
              No
            </button>
          </div>
          {isFoodpanda === null && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Please select Yes or No to continue.
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={!canAdd}
          onClick={submit}
          className="flex h-14 w-full items-center justify-between rounded-xl bg-brand-red px-5 text-base font-bold text-white shadow-soft transition active:bg-brand-red-dark disabled:bg-gray-300"
        >
          <span>Add to bill</span>
          <span>{formatPKR(unitPrice * qty)}</span>
        </button>
      </div>
    </div>
  );
}

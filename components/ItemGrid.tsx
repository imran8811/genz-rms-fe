"use client";

import type { MenuCategory, MenuItem } from "@/lib/types";
import { formatPKR, toAmount } from "@/lib/currency";

interface Props {
  category: MenuCategory | null;
  onPick: (category: MenuCategory, item: MenuItem) => void;
}

/** A sized item's span across its sizes — one price if they all agree. */
function rangeLabel(item: MenuItem): string | null {
  const values = Object.values(item.prices ?? {})
    .map(toAmount)
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? formatPKR(min) : `${formatPKR(min)} – ${formatPKR(max)}`;
}

/**
 * The category's `type` says which price an item is meant to carry, but this
 * falls back to the other rather than printing "—": a card with no price on it
 * is the one thing the till can't work from, and an item whose shape disagrees
 * with its category is still cheaper to show than to hide.
 */
function priceLabel(category: MenuCategory, item: MenuItem): string {
  const single = toAmount(item.price);
  const range = rangeLabel(item);
  if (category.type === "sized") return range ?? (single === undefined ? "—" : formatPKR(single));
  return single === undefined ? (range ?? "—") : formatPKR(single);
}

export default function ItemGrid({ category, onPick }: Props) {
  if (!category) {
    return <section className="flex-1 p-6 text-gray-500">No category</section>;
  }

  if (category.comingSoon) {
    return (
      <section className="flex flex-1 items-center justify-center text-gray-400">
        {category.name} — coming soon
      </section>
    );
  }

  return (
    <section className="flex-1 overflow-y-auto bg-gray-50 px-4 py-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {category.items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(category, item)}
            className="group flex min-h-[88px] flex-col justify-between rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition active:scale-[0.98] active:bg-gray-50"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold leading-tight text-gray-900">
                {item.name}
              </span>
              {item.signature && (
                <span className="rounded bg-brand-yellow px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-ink">
                  Signature
                </span>
              )}
              {item.special && !item.signature && (
                <span className="rounded bg-brand-red/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-red">
                  Special
                </span>
              )}
            </div>
            {item.description && (
              <span className="mt-1 line-clamp-2 text-[11px] text-gray-500">
                {item.description}
              </span>
            )}
            <span className="mt-2 text-sm font-bold text-brand-red">
              {priceLabel(category, item)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

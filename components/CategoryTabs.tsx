"use client";

import type { MenuCategory } from "@/lib/types";

interface Props {
  categories: MenuCategory[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export default function CategoryTabs({ categories, activeId, onSelect }: Props) {
  return (
    <nav className="w-44 shrink-0 overflow-y-auto border-r border-gray-200 bg-white py-2">
      <ul className="space-y-1 px-2">
        {categories.map((cat) => {
          const isActive = cat.id === activeId;
          const disabled = cat.comingSoon || cat.items.length === 0;
          return (
            <li key={cat.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(cat.id)}
                className={[
                  // 10px of vertical padding (`py-2.5` is exactly 10px).
                  //
                  // `min-h` tracks the natural single-line height
                  // (10 + 10 + ~18px ≈ 38px) so it stays a floor and never
                  // inflates the row. Change the padding here and this moves with
                  // it: it was once 48px, which *was* the height, and the padding
                  // couldn't be seen past it at all.
                  "w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition",
                  "min-h-[38px]",
                  disabled
                    ? "cursor-not-allowed text-gray-300"
                    : isActive
                      ? "bg-brand-red text-white shadow-soft"
                      : "text-gray-700 hover:bg-gray-100 active:bg-gray-200",
                ].join(" ")}
              >
                <span className="block leading-tight">{cat.name}</span>
                {cat.comingSoon && (
                  <span className="mt-0.5 block text-[10px] uppercase tracking-wide">
                    Coming soon
                  </span>
                )}
                {cat.seasonal && !cat.comingSoon && (
                  <span
                    className={[
                      "mt-0.5 block text-[10px] uppercase tracking-wide",
                      isActive ? "text-white/80" : "text-amber-600",
                    ].join(" ")}
                  >
                    Seasonal
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

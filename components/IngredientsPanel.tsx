"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Ingredient } from "@/lib/costing";

function fmtCost(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-PK", { maximumFractionDigits: 4 });
}

/**
 * Read-only ingredient price list (costing perspective). Items are added and
 * edited from Purchasing → Items; here we only show the derived per-unit cost
 * that drives every recipe.
 */
export default function IngredientsPanel() {
  const [items, setItems] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.get<Ingredient[]>("/costing/ingredients"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ingredients");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.supplier ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3">
        <p className="text-sm text-gray-500">
          Pack price ÷ pack size = unit cost, used to price every recipe.
          Add or edit items from Purchasing → Items.
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / supplier…"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-red w-56"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-5 py-3">Ingredient</th>
              <th className="px-5 py-3">Supplier</th>
              <th className="px-5 py-3 text-right">Pack size</th>
              <th className="px-5 py-3 text-right">Pack price</th>
              <th className="px-5 py-3 text-right">Unit cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-5 py-4">
                      <div className="h-4 bg-gray-100 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-gray-400">
                  {items.length === 0 ? "No items yet — add them from Purchasing → Items." : "No matches."}
                </td>
              </tr>
            ) : (
              filtered.map((i) => {
                const missing = i.pack_price == null;
                return (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">
                      {i.name}
                      {missing && (
                        <span title="No price set — needs a price" className="ml-2 text-amber-500">
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500">{i.supplier ?? "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600">
                      {i.pack_size != null ? `${i.pack_size}${i.pack_unit ?? i.base_unit}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600">
                      {i.pack_price != null ? "Rs" + i.pack_price.toLocaleString("en-PK") : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-gray-900">
                      {missing ? "—" : `${fmtCost(i.unit_cost)}/${i.base_unit}`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

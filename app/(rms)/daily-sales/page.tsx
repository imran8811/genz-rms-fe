"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";

/**
 * One row per trading day from `GET /sales/daily`: the till's own sales beside
 * Food Panda's (paid through the app, so never in the drawer). Split exactly as
 * the Sales page's cards split them, and bucketed on the same day, so a row
 * here reads the same as `/sales` for that date.
 */
interface DailyRow {
  date: string;
  sales: number;
  sales_orders: number;
  foodpanda: number;
  foodpanda_orders: number;
}

interface DailyPage {
  data: DailyRow[];
  /** Pass back as `?before=` for the next (older) page; null when history runs out. */
  next_before: string | null;
}

const PAGE_SIZE = 30;

function fmt(n: number) { return "Rs" + n.toLocaleString("en-PK"); }
function fmtDay(ymd: string) {
  // Parse as a local date — `new Date("2026-10-14")` is UTC midnight and can
  // land on the previous day once formatted.
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PK", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });
}

function LoadingRow() {
  return (
    <tr>
      {Array.from({ length: 3 }).map((_, i) => (
        <td key={i} className="px-3 py-2"><div className="h-4 bg-gray-100 rounded animate-pulse"/></td>
      ))}
    </tr>
  );
}

export default function DailySalesPage() {
  const [rows, setRows] = useState<DailyRow[]>([]);
  /** `undefined` = first page not fetched yet; `null` = no more history. */
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  // Guards against the observer firing twice before the first fetch settles.
  const inFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (inFlight.current || cursor === null) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) qs.set("before", cursor);
      const page = await api.get<DailyPage>(`/sales/daily?${qs}`);
      setRows((prev) => [...prev, ...page.data]);
      setCursor(page.next_before);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cursor]);

  // Re-created whenever the cursor moves, which also re-checks the sentinel:
  // if one page doesn't fill a tall screen, it is still in view and the next
  // page loads straight away instead of waiting for a scroll that can't happen.
  // Stops on an error so a dead backend isn't hammered — Retry restarts it.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || cursor === null || error) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { root: scrollRef.current, rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [cursor, error, loadMore]);

  const firstLoad = loading && rows.length === 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="hidden md:flex bg-white border-b border-gray-200 px-6 py-4 items-center justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Daily Sales</h1>
          <p className="text-sm text-gray-500">Regular and Food Panda sales, day by day</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Date</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Sales</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Food Panda Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={r.date} className="hover:bg-gray-50/60">
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDay(r.date)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="font-semibold text-gray-800">{fmt(r.sales)}</div>
                      <div className="text-xs text-gray-400">{r.sales_orders} orders</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="font-semibold text-pink-700">{fmt(r.foodpanda)}</div>
                      <div className="text-xs text-gray-400">{r.foodpanda_orders} orders</div>
                    </td>
                  </tr>
                ))}

                {firstLoad && Array.from({ length: 8 }).map((_, i) => <LoadingRow key={i}/>)}
                {loading && !firstLoad && <LoadingRow/>}

                {!loading && !error && cursor === null && rows.length === 0 && (
                  <tr><td colSpan={3} className="px-5 py-12 text-center text-gray-400">No sales recorded yet.</td></tr>
                )}
                {!loading && !error && cursor === null && rows.length > 0 && (
                  <tr><td colSpan={3} className="px-5 py-4 text-center text-xs text-gray-400">That&apos;s every day on record.</td></tr>
                )}
                {error && (
                  <tr>
                    <td colSpan={3} className="px-5 py-4 text-center text-sm text-red-700">
                      Could not load sales: {error}.{" "}
                      <button onClick={() => setError(null)} className="font-semibold underline">Retry</button>
                    </td>
                  </tr>
                )}

                {/* Infinite-scroll trigger: coming into view loads the next (older) page. */}
                <tr ref={sentinelRef} aria-hidden><td colSpan={3} className="h-px p-0"/></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

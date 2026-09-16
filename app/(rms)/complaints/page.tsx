"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/currency";
import type { ComplaintStatus, KitchenOrder, OrderComplaint } from "@/lib/types";
import ComplaintDetailModal from "@/components/ComplaintDetailModal";

/**
 * The complaints register: every order a customer complained about, newest
 * first, with the complaint itself on the row.
 *
 * This is the front desk's screen, not the kitchen's — the kitchen sees today's
 * complaints on its own board and can only acknowledge them. Here a complaint
 * is read back days later (the customer rings again, a manager asks what
 * happened), which is why the page opens on a **range** rather than a single
 * day, unlike Sales: complaints are rare enough that one day of them is usually
 * an empty screen.
 *
 * Clicking a row opens the whole order beside the complaint thread — see
 * `components/ComplaintDetailModal`.
 */

type StatusFilter = "open" | "new" | "resolved" | "all";

interface ComplaintsPage {
  data: OrderComplaint[];
  total: number;
}

const STATUS_STYLE: Record<ComplaintStatus, { label: string; className: string }> = {
  new: { label: "Not seen", className: "bg-red-100 text-red-700" },
  seen: { label: "Open", className: "bg-amber-100 text-amber-700" },
  resolved: { label: "Resolved", className: "bg-green-100 text-green-700" },
};

const TYPE_COLOR: Record<string, string> = {
  "Dine-in": "bg-blue-100 text-blue-700",
  Takeaway: "bg-yellow-100 text-yellow-700",
  Delivery: "bg-orange-100 text-orange-700",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** The default window: far enough back to cover "last week's order", not a year. */
function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-PK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function LoadingRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2">
          <div className="h-4 animate-pulse rounded bg-gray-100" />
        </td>
      ))}
    </tr>
  );
}

export default function ComplaintsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(todayStr);
  const [search, setSearch] = useState("");

  const [complaints, setComplaints] = useState<OrderComplaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** The order being read, with every complaint on it (not just the filtered one). */
  const [openOrder, setOpenOrder] = useState<KitchenOrder | null>(null);
  const [openThread, setOpenThread] = useState<OrderComplaint[]>([]);
  const [openLoading, setOpenLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to });
    if (statusFilter !== "all") params.set("status", statusFilter);
    api
      .get<ComplaintsPage>(`/complaints?${params.toString()}`)
      .then((page) => setComplaints(page.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Open the order behind a complaint. The thread is fetched by `order_id`
   * rather than filtered out of the list: a second complaint on the same bill
   * may well be resolved (or outside the date range) while this one isn't, and
   * deciding what to do about one of them means seeing all of them.
   */
  const openComplaint = async (complaint: OrderComplaint) => {
    if (!complaint.order) {
      setError("That complaint's order is no longer in the system.");
      return;
    }
    setOpenOrder(complaint.order);
    setOpenThread([complaint]);
    setOpenLoading(true);
    try {
      const page = await api.get<ComplaintsPage>(`/complaints?order_id=${complaint.order_id}`);
      if (page.data.length > 0) setOpenThread(page.data);
    } catch {
      // Keep the modal on the one complaint we already have rather than closing
      // it — the order details are the bulk of what it is open for.
    } finally {
      setOpenLoading(false);
    }
  };

  /** A complaint changed in the modal: patch it into both lists in place. */
  const syncComplaint = (updated: OrderComplaint) => {
    setOpenThread((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setComplaints((prev) => {
      const next = prev.map((c) => (c.id === updated.id ? updated : c));
      // A row that no longer matches the filter drops out, so "Open" doesn't
      // keep listing something just marked resolved.
      if (statusFilter === "all") return next;
      if (statusFilter === "open") return next.filter((c) => c.status !== "resolved");
      return next.filter((c) => c.status === statusFilter);
    });
  };

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return complaints;
    return complaints.filter(
      (c) =>
        c.body.toLowerCase().includes(q) ||
        (c.logged_by_name ?? "").toLowerCase().includes(q) ||
        (c.order?.order_number ?? "").toLowerCase().includes(q),
    );
  }, [complaints, search]);

  const stats = useMemo(() => {
    const unseen = complaints.filter((c) => c.status === "new").length;
    const open = complaints.filter((c) => c.status !== "resolved").length;
    const resolved = complaints.filter((c) => c.status === "resolved").length;
    return { unseen, open, resolved, total: complaints.length };
  }, [complaints]);

  const tabs: [StatusFilter, string][] = [
    ["open", "Open"],
    ["new", "Not seen by kitchen"],
    ["resolved", "Resolved"],
    ["all", "All"],
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header. Same rule as Sales: the date range is a desktop control and is
          hidden on a phone, where the page reads the last 30 days. */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Complaints</h1>
          <p className="text-sm text-gray-500">Orders customers complained about</p>
        </div>

        <div className="hidden items-center gap-1.5 md:flex">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value || defaultFrom())}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
          />
          <span className="text-sm text-gray-400">to</span>
          <input
            type="date"
            value={to}
            min={from}
            max={todayStr()}
            onChange={(e) => setTo(e.target.value || todayStr())}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
          />
          <button
            onClick={load}
            className="ml-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Stat cards */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
          {[
            { label: "Not seen by kitchen", value: stats.unseen, color: "text-red-600" },
            { label: "Open", value: stats.open, color: "text-amber-600" },
            { label: "Resolved", value: stats.resolved, color: "text-green-600" },
            { label: "In this range", value: stats.total, color: "text-gray-800" },
          ].map((card) => (
            <div
              key={card.label}
              className="min-w-0 rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-soft"
            >
              <div className="truncate text-xs text-gray-500">{card.label}</div>
              <div
                className={`truncate text-lg font-bold leading-tight tabular-nums ${
                  loading ? "animate-pulse text-gray-200" : card.color
                }`}
              >
                {loading ? "—" : card.value}
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-3 py-3 sm:px-5 sm:py-4">
            <h2 className="font-semibold text-gray-900">Complaint log</h2>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
              <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-100 p-0.5">
                {tabs.map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setStatusFilter(value)}
                    className={`flex-shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-all sm:px-3 ${
                      statusFilter === value
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order # or text…"
                className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-red sm:w-52 sm:flex-none"
              />
              <span className="text-sm text-gray-400">
                {loading ? "…" : `${displayed.length} complaints`}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Order #</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Total</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Complaint</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Logged by</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">When</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => <LoadingRow key={i} cols={7} />)
                ) : displayed.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                      {search.trim()
                        ? "No complaint matches that search."
                        : statusFilter === "open"
                          ? "No open complaints in this range. 🎉"
                          : "No complaints in this range."}
                    </td>
                  </tr>
                ) : (
                  displayed.map((complaint) => (
                    <tr
                      key={complaint.id}
                      onClick={() => openComplaint(complaint)}
                      className={`cursor-pointer transition-colors ${
                        complaint.status === "new" ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-gray-700">
                        {complaint.order?.order_number ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {complaint.order && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              TYPE_COLOR[complaint.order.order_type] ?? "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {complaint.order.order_type}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-800">
                        {complaint.order ? formatPKR(complaint.order.total) : "—"}
                      </td>
                      {/* One line, truncated: the row is for finding the right
                          complaint, the modal is for reading it. */}
                      <td className="max-w-[22rem] px-3 py-2">
                        <div className="truncate text-gray-700">{complaint.body}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {complaint.logged_by_name?.trim() || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">
                        {fmtDate(complaint.created_at)}{" "}
                        <span className="text-xs text-gray-400">
                          {fmtTime(complaint.created_at)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_STYLE[complaint.status].className
                          }`}
                        >
                          {STATUS_STYLE[complaint.status].label}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {openOrder && (
        <ComplaintDetailModal
          order={openOrder}
          complaints={openThread}
          onClose={() => {
            if (openLoading) return;
            setOpenOrder(null);
            setOpenThread([]);
          }}
          onChanged={syncComplaint}
        />
      )}
    </div>
  );
}

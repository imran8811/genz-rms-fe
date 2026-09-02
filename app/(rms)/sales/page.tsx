"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { useMenu } from "@/lib/menuStore";
import ReceiptPreviewModal from "@/components/ReceiptPreviewModal";

type Period       = "today" | "week" | "month";
type OrderType    = "Dine-in" | "Takeaway" | "Delivery";
type OrderSource  = "pos" | "foodpanda" | "web" | "app";
type Status       = "completed" | "cancelled";
type StatusFilter = "all" | Status;
type PanelMode    = "view" | "edit";

/**
 * How the order reached us, as the counter thinks of it. Food Panda orders are
 * ordinary Takeaway rows with `source = foodpanda`; on a sales list that
 * distinction matters more than the order type (they're paid through the app,
 * so they never hit the drawer), hence a channel of their own.
 */
type Channel = "Food Panda" | OrderType;
type ChannelFilter = "all" | Channel;

interface SalesSummary {
  revenue: number;
  orders: number;
  avg_value: number;
  deliveries: number;
  /** Keyed by channel: Food Panda is its own bucket, not part of Takeaway. */
  by_type: Record<Channel, { count: number; revenue: number }>;
  foodpanda?: { orders: number; revenue: number };
  staff_food?: { orders: number; total: number };
}

interface ExpenseSummary {
  today: number;
}

interface OrderItem {
  id: number;
  item_name: string;
  size: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
}

interface ApiOrder {
  id: number;
  order_number: string;
  order_type: OrderType;
  source: OrderSource;
  subtotal: number;
  delivery_charge: number;
  extra_topping: number;
  total: number;
  status: Status;
  notes: string | null;
  created_at: string;
  items: OrderItem[];
}

interface OrdersPage { data: ApiOrder[]; total: number; }

interface EditItem {
  id: number;
  item_name: string;
  size: string | null;
  unit_price: number;
  quantity: number;
}

interface EditForm {
  order_type:      OrderType;
  status:          Status;
  delivery_charge: number;
  extra_topping:   number;
  notes:           string;
  items:           EditItem[];
}

const typeColor: Record<Channel, string> = {
  "Dine-in":         "bg-blue-100 text-blue-700",
  "Takeaway":        "bg-yellow-100 text-yellow-700",
  "Delivery":        "bg-orange-100 text-orange-700",
  "Food Panda": "bg-pink-100 text-pink-700",
};

/** Food Panda first — its rows are Takeaway underneath, but that isn't what the
 *  sales list is being read for. */
function channelOf(o: { order_type: OrderType; source?: OrderSource }): Channel {
  return o.source === "foodpanda" ? "Food Panda" : o.order_type;
}

/**
 * Where the order came *from*, which is a different question to what kind of
 * order it is. `orders.source` only records how it entered the RMS, so for
 * anything rung up at the till the order type is what carries the answer: a
 * Dine-in or Takeaway bill means someone was standing there, a Delivery bill
 * means they phoned or sent a WhatsApp. Orders that arrive through an
 * integration already say so in `source` and are taken at their word.
 */
type OrderOrigin = "Walk-in" | "WhatsApp/Call" | "Food Panda" | "Web" | "App";

const originColor: Record<OrderOrigin, string> = {
  "Walk-in":       "bg-slate-100 text-slate-700",
  "WhatsApp/Call": "bg-emerald-100 text-emerald-700",
  "Food Panda":    "bg-pink-100 text-pink-700",
  "Web":           "bg-indigo-100 text-indigo-700",
  "App":           "bg-violet-100 text-violet-700",
};

function originOf(o: { order_type: OrderType; source?: OrderSource }): OrderOrigin {
  switch (o.source) {
    case "web":       return "Web";
    case "app":       return "App";
    case "foodpanda": return "Food Panda";
    default:          return o.order_type === "Delivery" ? "WhatsApp/Call" : "Walk-in";
  }
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmt(n: number) { return "Rs" + n.toLocaleString("en-PK"); }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function LoadingRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2"><div className="h-4 bg-gray-100 rounded animate-pulse"/></td>
      ))}
    </tr>
  );
}

function orderToForm(o: ApiOrder): EditForm {
  return {
    order_type:      o.order_type,
    status:          o.status,
    delivery_charge: o.delivery_charge,
    extra_topping:   o.extra_topping,
    notes:           o.notes ?? "",
    items:           o.items.map((i) => ({
      id: i.id, item_name: i.item_name, size: i.size,
      unit_price: i.unit_price, quantity: i.quantity,
    })),
  };
}

export default function SalesPage() {
  const menu = useMenu();
  const [receiptOrder, setReceiptOrder] = useState<ApiOrder | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [summary, setSummary]           = useState<SalesSummary | null>(null);
  const [todayExpenses, setTodayExpenses] = useState<number | null>(null);
  const [orders, setOrders]             = useState<ApiOrder[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  // panel state
  const [selected, setSelected]         = useState<ApiOrder | null>(null);
  const [panelMode, setPanelMode]       = useState<PanelMode>("view");
  const [editForm, setEditForm]         = useState<EditForm | null>(null);
  const [saving, setSaving]             = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // inline row delete
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId]           = useState<number | null>(null);

  const fetchSummary = useCallback(() => {
    api.get<SalesSummary>(`/sales/summary?date=${selectedDate}`).then(setSummary).catch(() => {});
  }, [selectedDate]);

  const fetchAll = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<SalesSummary>(`/sales/summary?date=${selectedDate}`),
      api.get<OrdersPage>(`/orders?date=${selectedDate}`),
      api.get<ExpenseSummary>(`/expenses/summary?date=${selectedDate}`),
    ])
      .then(([s, o, e]) => { setSummary(s); setOrders(o.data); setTodayExpenses(e.today); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedDate]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const isToday = selectedDate >= todayStr();
  const shiftDate = (days: number) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + days);
    const next = d.toISOString().slice(0, 10);
    if (next <= todayStr()) setSelectedDate(next);
  };

  const syncSelected = (updated: ApiOrder) => {
    setSelected(updated);
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  };

  /* ── open helpers ── */
  const openView = (order: ApiOrder) => {
    setSelected(order);
    setPanelMode("view");
    setConfirmDelete(false);
  };

  const openEdit = (order: ApiOrder) => {
    setSelected(order);
    setPanelMode("edit");
    setEditForm(orderToForm(order));
    setConfirmDelete(false);
  };

  const closePanel = () => { setSelected(null); setConfirmDelete(false); };

  /* ── edit helpers ── */
  const setItemField = (idx: number, field: keyof EditItem, value: number) => {
    setEditForm((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((it, i) => i === idx ? { ...it, [field]: value } : it);
      return { ...prev, items };
    });
  };

  const editSubtotal = useMemo(
    () => editForm?.items.reduce((s, i) => s + i.unit_price * i.quantity, 0) ?? 0,
    [editForm?.items],
  );
  const editTotal = editSubtotal + (editForm?.extra_topping ?? 0) + (editForm?.delivery_charge ?? 0);

  /* ── actions ── */
  const handleSaveEdit = async () => {
    if (!selected || !editForm) return;
    setSaving(true);
    try {
      const updated = await api.patch<ApiOrder>(`/orders/${selected.id}`, {
        order_type:      editForm.order_type,
        status:          editForm.status,
        delivery_charge: editForm.delivery_charge,
        extra_topping:   editForm.extra_topping,
        notes:           editForm.notes,
        items:           editForm.items.map((i) => ({
          id: i.id, quantity: i.quantity, unit_price: i.unit_price,
        })),
      });
      syncSelected(updated);
      setPanelMode("view");
      fetchSummary();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (status: Status) => {
    if (!selected) return;
    setActionLoading(true);
    try {
      const updated = await api.patch<ApiOrder>(`/orders/${selected.id}`, { status });
      syncSelected(updated);
      fetchSummary();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await api.delete(`/orders/${selected.id}`);
      setOrders((prev) => prev.filter((o) => o.id !== selected.id));
      closePanel();
      fetchSummary();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteFromRow = async (id: number) => {
    setDeletingId(id);
    try {
      await api.delete(`/orders/${id}`);
      setOrders((prev) => prev.filter((o) => o.id !== id));
      if (selected?.id === id) closePanel();
      fetchSummary();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  };

  /* ── derived ── */
  const s = summary;
  // Physical cash in the drawer = total sales, minus what didn't come in as cash:
  // Food Panda (paid via the app), staff food (charged to salary), and expenses
  // (cash paid out).
  const cashInDrawer = s
    ? s.revenue - (s.foodpanda?.revenue ?? 0) - (s.staff_food?.total ?? 0) - (todayExpenses ?? 0)
    : null;
  const byType = (type: Channel) => ({ count: s?.by_type?.[type]?.count ?? 0, revenue: s?.by_type?.[type]?.revenue ?? 0 });
  const displayed = orders.filter(
    (o) =>
      (statusFilter === "all" || o.status === statusFilter) &&
      (channelFilter === "all" || channelOf(o) === channelFilter),
  );

  /** Counts per channel, so a filter that would come back empty says so up front. */
  const channelCounts = useMemo(() => {
    const counts = { "Dine-in": 0, Takeaway: 0, Delivery: 0, "Food Panda": 0 } as Record<Channel, number>;
    for (const o of orders) {
      if (statusFilter !== "all" && o.status !== statusFilter) continue;
      counts[channelOf(o)] += 1;
    }
    return counts;
  }, [orders, statusFilter]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header.
          Hidden below `md`: the title, the date nav and the four channel cards
          need ~900px to sit on one line, and on a phone they cost most of the
          screen before a single figure is on it. Mobile therefore reads
          *today* — the date nav is a desktop control. `flex-wrap` covers the
          middle widths, where the row fits the screen but not one line. */}
      <div className="hidden md:flex bg-white border-b border-gray-200 px-6 py-4 flex-wrap items-center justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sales</h1>
          <p className="text-sm text-gray-500">
            {isToday ? "Today" : fmtDate(selectedDate)} · sales & orders overview
          </p>
        </div>

        {/* Date selector */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => shiftDate(-1)}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm">◀</button>
          <input type="date" value={selectedDate} max={todayStr()}
            onChange={(e) => setSelectedDate(e.target.value || todayStr())}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
          <button onClick={() => shiftDate(1)} disabled={isToday}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm disabled:opacity-40">▶</button>
          {!isToday && (
            <button onClick={() => setSelectedDate(todayStr())}
              className="ml-1 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700">Today</button>
          )}
        </div>

        {/* Order type breakdown — Food Panda counts as a type of its own */}
        <div className="flex flex-wrap items-center gap-2">
          {(["Dine-in", "Takeaway", "Delivery", "Food Panda"] as Channel[]).map((type) => {
            const bt = byType(type);
            return (
              <div key={type} className={`rounded-lg border px-3 py-2 min-w-[116px] ${
                type === "Food Panda" ? "border-pink-100 bg-pink-50/60" : "border-gray-100 bg-gray-50"
              }`}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeColor[type]}`}>{type}</span>
                  <span className="text-sm font-bold text-gray-800">{loading ? "—" : bt.count}</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">{loading ? "—" : fmt(bt.revenue)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            Could not reach backend: {error}.
          </div>
        )}

        {/* Stat cards. Five across only once there's room for it: two up on a
            phone (Cash lands on its own, which suits the one figure that gets
            checked against the drawer), three on a tablet. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4 mb-4 sm:mb-6">
          {[
            { label: "Total Sales",     value: s ? fmt(s.revenue)         : "—", sub: s ? `${s.orders} orders` : null,                            icon: "💰", color: "text-green-600",  bg: "bg-green-50"  },
            { label: "Food Panda",      value: s ? fmt(s.foodpanda?.revenue ?? 0) : "—", sub: s ? `${s.foodpanda?.orders ?? 0} orders` : null,     icon: "🛵", color: "text-pink-600",   bg: "bg-pink-50"   },
            { label: "Staff Food",      value: s ? fmt(s.staff_food?.total ?? 0) : "—", sub: s ? `${s.staff_food?.orders ?? 0} orders` : null,     icon: "🍽️", color: "text-amber-600",  bg: "bg-amber-50"  },
            { label: "Expenses", value: todayExpenses !== null ? fmt(todayExpenses) : "—", sub: null, icon: "💸", color: "text-purple-600", bg: "bg-purple-50" },
            { label: "Cash", value: cashInDrawer !== null ? fmt(cashInDrawer) : "—", sub: null, icon: "💵", color: cashInDrawer !== null && cashInDrawer < 0 ? "text-red-600" : "text-orange-600", bg: cashInDrawer !== null && cashInDrawer < 0 ? "bg-red-50" : "bg-orange-50" },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-lg border border-gray-100 shadow-soft px-3 py-2.5 min-w-0">
              <div className="text-xs text-gray-500 truncate">{card.label}</div>
              {/* truncate, not wrap: a figure broken across two lines changes
                  every card's height and the row stops scanning as a row. */}
              <div className={`text-lg font-bold leading-tight tabular-nums truncate ${loading ? "text-gray-200 animate-pulse" : card.color}`}>{loading ? "——" : card.value}</div>
              {card.sub && !loading && <div className="text-[11px] font-medium text-gray-400 truncate">{card.sub}</div>}
            </div>
          ))}
        </div>

        {/* Orders table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900">Orders</h2>
            {/* min-w-0 so the pill groups below may shrink and scroll instead of
                pushing past the card, which clips them (the card is
                overflow-hidden) and puts Food Panda out of reach on a phone. */}
            <div className="flex min-w-0 w-full sm:w-auto flex-wrap items-center gap-2 sm:gap-3">
              {/* Channel: Food Panda sits alongside the order types, since that
                  is how the counter reads this list. */}
              <div className="flex max-w-full gap-1 overflow-x-auto bg-gray-100 rounded-lg p-0.5">
                {(["all", "Dine-in", "Takeaway", "Delivery", "Food Panda"] as ChannelFilter[]).map((c) => (
                  <button key={c} onClick={() => setChannelFilter(c)}
                    className={`flex-shrink-0 whitespace-nowrap px-2.5 sm:px-3 py-1 rounded-md text-xs font-medium transition-all ${channelFilter === c ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                    {c === "all" ? "All types" : c}
                    {c !== "all" && !loading && <span className="ml-1 text-gray-400">{channelCounts[c]}</span>}
                  </button>
                ))}
              </div>

              <div className="flex max-w-full gap-1 overflow-x-auto bg-gray-100 rounded-lg p-0.5">
                {([["all","All"],["completed","Completed"],["cancelled","Cancelled"]] as [StatusFilter, string][]).map(([v,l]) => (
                  <button key={v} onClick={() => setStatusFilter(v)}
                    className={`flex-shrink-0 whitespace-nowrap px-2.5 sm:px-3 py-1 rounded-md text-xs font-medium transition-all ${statusFilter === v ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                    {l}
                  </button>
                ))}
              </div>
              <span className="text-sm text-gray-400">{loading ? "…" : `${displayed.length} orders`}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Order #</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Type</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Source</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Items</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Total</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Date & Time</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">Status</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => <LoadingRow key={i} cols={8}/>)
                  : displayed.length === 0
                  ? <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-400">
                      {channelFilter === "all"
                        ? `No orders for ${isToday ? "today" : fmtDate(selectedDate)}.`
                        : `No ${channelFilter} orders for ${isToday ? "today" : fmtDate(selectedDate)}.`}
                    </td></tr>
                  : displayed.map((order) => (
                    // Food Panda rows are tinted end to end so they're countable
                    // at a glance when reconciling the drawer against the app.
                    <tr key={order.id} className={`transition-colors ${
                      order.source === "foodpanda" ? "bg-pink-50 hover:bg-pink-100" : "hover:bg-gray-50"
                    }`}>
                      <td className="px-3 py-1.5 font-mono text-gray-700">{order.order_number}</td>
                      <td className="px-3 py-1.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeColor[channelOf(order)]}`}>
                          {channelOf(order)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${originColor[originOf(order)]}`}>
                          {originOf(order)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-600">{order.items?.length ?? 0}</td>
                      <td className="px-3 py-1.5 text-right font-semibold text-gray-800">{fmt(order.total)}</td>
                      <td className="px-3 py-1.5 text-right text-gray-500 whitespace-nowrap">
                        {fmtDate(order.created_at)} <span className="text-xs text-gray-400">{fmtTime(order.created_at)}</span>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${order.status === "completed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {deleteConfirmId === order.id ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="text-xs text-gray-500 mr-1">Delete?</span>
                            <button
                              onClick={() => handleDeleteFromRow(order.id)}
                              disabled={deletingId === order.id}
                              className="px-2 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              {deletingId === order.id ? "…" : "Yes"}
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-2 py-1 text-xs font-medium border border-gray-200 rounded text-gray-600 hover:border-gray-400"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                            {/* Bill slip (soft copy) */}
                            <button
                              onClick={() => setReceiptOrder(order)}
                              title="Bill Slip"
                              className="p-1 rounded-md text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </button>
                            {/* View */}
                            <button
                              onClick={() => openView(order)}
                              title="View"
                              className="p-1 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </button>
                            {/* Edit */}
                            <button
                              onClick={() => openEdit(order)}
                              title="Edit"
                              className="p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z" />
                              </svg>
                            </button>
                            {/* Delete */}
                            <button
                              onClick={() => setDeleteConfirmId(order.id)}
                              title="Delete"
                              className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Slide-over panel ── */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-end">
          {/* max-w, not a fixed width: anchored right, a 520px panel on a 375px
              phone hangs its left third off the screen with no way to reach it. */}
          <div className="bg-white h-full w-full max-w-[520px] shadow-2xl flex flex-col">

            {/* Panel header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-gray-900 text-base">{selected.order_number}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeColor[channelOf(selected)]}`}>
                    {channelOf(selected)}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${selected.status === "completed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {selected.status}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{fmtDate(selected.created_at)} · {fmtTime(selected.created_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                {/* Mode tabs */}
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setPanelMode("view")}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${panelMode === "view" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                  >View</button>
                  <button
                    onClick={() => { setPanelMode("edit"); setEditForm(orderToForm(selected)); setConfirmDelete(false); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${panelMode === "edit" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                  >Edit</button>
                </div>
                <button onClick={closePanel} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-1">✕</button>
              </div>
            </div>

            {/* ════════ VIEW MODE ════════ */}
            {panelMode === "view" && (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                  {/* Order info grid */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {[
                      { label: "Order Number", value: selected.order_number },
                      { label: "Order Type",   value: selected.order_type },
                      { label: "Source",       value: originOf(selected) },
                      { label: "Date",         value: fmtDate(selected.created_at) },
                      { label: "Time",         value: fmtTime(selected.created_at) },
                      { label: "Status",       value: selected.status === "completed" ? "Completed" : "Cancelled" },
                    ].map((row) => (
                      <div key={row.label}>
                        <div className="text-xs text-gray-400 mb-0.5">{row.label}</div>
                        <div className="font-medium text-gray-800">{row.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Items table */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Order Items</h3>
                    <div className="border border-gray-100 rounded-xl overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-left px-4 py-2.5 font-medium text-gray-500">Item</th>
                            <th className="text-right px-4 py-2.5 font-medium text-gray-500">Price</th>
                            <th className="text-center px-4 py-2.5 font-medium text-gray-500">Qty</th>
                            <th className="text-right px-4 py-2.5 font-medium text-gray-500">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {(selected.items ?? []).map((item) => (
                            <tr key={item.id}>
                              <td className="px-4 py-2.5 text-gray-700">
                                <div className="font-medium">{item.item_name}</div>
                                {item.size && <div className="text-gray-400">{item.size}</div>}
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-600">{fmt(item.unit_price)}</td>
                              <td className="px-4 py-2.5 text-center text-gray-600">{item.quantity}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmt(item.line_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Totals */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmt(selected.subtotal)}</span></div>
                    {selected.extra_topping > 0 && (
                      <div className="flex justify-between text-gray-600"><span>Extra Topping</span><span>{fmt(selected.extra_topping)}</span></div>
                    )}
                    {selected.delivery_charge > 0 && (
                      <div className="flex justify-between text-gray-600"><span>Delivery Charge</span><span>{fmt(selected.delivery_charge)}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-200 pt-2">
                      <span>Total</span><span>{fmt(selected.total)}</span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-1.5">Notes</h3>
                    <p className={`text-sm ${selected.notes ? "text-gray-700" : "text-gray-400 italic"}`}>
                      {selected.notes || "No notes for this order."}
                    </p>
                  </div>
                </div>

                {/* View mode actions */}
                <div className="px-6 py-4 border-t border-gray-100 space-y-2 flex-shrink-0">
                  {selected.status === "completed" ? (
                    <button onClick={() => handleStatusChange("cancelled")} disabled={actionLoading}
                      className="w-full py-2.5 text-sm font-medium bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-lg hover:bg-yellow-100 disabled:opacity-50">
                      {actionLoading ? "Updating…" : "Cancel Order"}
                    </button>
                  ) : (
                    <button onClick={() => handleStatusChange("completed")} disabled={actionLoading}
                      className="w-full py-2.5 text-sm font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50">
                      {actionLoading ? "Updating…" : "Restore Order"}
                    </button>
                  )}
                  {confirmDelete ? (
                    <div className="border border-red-200 rounded-lg p-3 bg-red-50">
                      <p className="text-xs text-red-700 mb-2 font-medium">Permanently delete this order? This cannot be undone.</p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmDelete(false)}
                          className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:border-gray-400">Keep</button>
                        <button onClick={handleDelete} disabled={actionLoading}
                          className="flex-1 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                          {actionLoading ? "Deleting…" : "Yes, Delete"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)}
                      className="w-full py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
                      Delete Order
                    </button>
                  )}
                </div>
              </>
            )}

            {/* ════════ EDIT MODE ════════ */}
            {panelMode === "edit" && editForm && (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                  {/* Order type + Status */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">Order Type</label>
                      <select
                        value={editForm.order_type}
                        onChange={(e) => setEditForm({ ...editForm, order_type: e.target.value as OrderType })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                      >
                        <option value="Dine-in">Dine-in</option>
                        <option value="Takeaway">Takeaway</option>
                        <option value="Delivery">Delivery</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">Status</label>
                      <select
                        value={editForm.status}
                        onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Status })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                      >
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>

                  {/* Items */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Order Items</h3>
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-left px-3 py-2.5 font-medium text-gray-500">Item</th>
                            <th className="text-right px-3 py-2.5 font-medium text-gray-500 w-24">Unit Price</th>
                            <th className="text-center px-3 py-2.5 font-medium text-gray-500 w-16">Qty</th>
                            <th className="text-right px-3 py-2.5 font-medium text-gray-500 w-24">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {editForm.items.map((item, idx) => {
                            const lineTotal = item.unit_price * item.quantity;
                            return (
                              <tr key={item.id}>
                                <td className="px-3 py-2">
                                  <div className="font-medium text-gray-700">{item.item_name}</div>
                                  {item.size && <div className="text-gray-400">{item.size}</div>}
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number" min={0}
                                    value={item.unit_price}
                                    onChange={(e) => setItemField(idx, "unit_price", Number(e.target.value))}
                                    className="w-full border border-gray-200 rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-brand-red"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number" min={1}
                                    value={item.quantity}
                                    onChange={(e) => setItemField(idx, "quantity", Number(e.target.value))}
                                    className="w-full border border-gray-200 rounded px-2 py-1 text-center text-xs focus:outline-none focus:ring-1 focus:ring-brand-red"
                                  />
                                </td>
                                <td className="px-3 py-2 text-right font-medium text-gray-800">{fmt(lineTotal)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Charges */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">Extra Topping (Rs)</label>
                      <input
                        type="number" min={0}
                        value={editForm.extra_topping}
                        onChange={(e) => setEditForm({ ...editForm, extra_topping: Number(e.target.value) })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">Delivery Charge (Rs)</label>
                      <input
                        type="number" min={0}
                        value={editForm.delivery_charge}
                        onChange={(e) => setEditForm({ ...editForm, delivery_charge: Number(e.target.value) })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                      />
                    </div>
                  </div>

                  {/* Live totals */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmt(editSubtotal)}</span></div>
                    {editForm.extra_topping > 0 && (
                      <div className="flex justify-between text-gray-600"><span>Extra Topping</span><span>{fmt(editForm.extra_topping)}</span></div>
                    )}
                    {editForm.delivery_charge > 0 && (
                      <div className="flex justify-between text-gray-600"><span>Delivery Charge</span><span>{fmt(editForm.delivery_charge)}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-200 pt-2">
                      <span>New Total</span><span>{fmt(editTotal)}</span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Notes</label>
                    <textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      rows={3}
                      placeholder="Add a note for this order…"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red resize-none"
                    />
                  </div>
                </div>

                {/* Edit mode footer */}
                <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
                  <button
                    onClick={() => { setPanelMode("view"); setConfirmDelete(false); }}
                    className="flex-1 py-2.5 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:border-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving}
                    className="flex-1 py-2.5 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

      {/* ── Bill slip soft copy ── */}
      {receiptOrder && menu && (
        <ReceiptPreviewModal
          order={receiptOrder}
          restaurant={menu.restaurant}
          onClose={() => setReceiptOrder(null)}
        />
      )}
    </div>
  );
}

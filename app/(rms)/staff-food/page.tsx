"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface StaffMember {
  id: number;
  name: string;
  role: string;
  salary: number;
  is_active: boolean;
}

interface FoodLogEntry {
  id: number;
  staff_id: number;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  consumed_at: string;
  notes: string | null;
  staff?: { id: number; name: string; role: string };
}

interface StaffSummaryRow {
  staff_id: number;
  staff_name: string;
  role: string;
  salary: number;
  total: number;
  entries: FoodLogEntry[];
}

interface MonthlySummary {
  month: string;
  total: number;
  by_staff: StaffSummaryRow[];
}

interface AddForm {
  staff_id: string;
  item_name: string;
  quantity: string;
  unit_price: string;
  consumed_at: string;
  notes: string;
  added_by: string;
}

const ROLE_COLORS: Record<string, string> = {
  Manager:  "bg-purple-100 text-purple-700",
  Chef:     "bg-orange-100 text-orange-700",
  Cashier:  "bg-blue-100 text-blue-700",
  Rider:    "bg-green-100 text-green-700",
  Waiter:   "bg-yellow-100 text-yellow-700",
  Helper:   "bg-gray-100 text-gray-600",
};

function fmt(n: number) {
  return "Rs " + n.toLocaleString("en-PK");
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

const emptyForm = (): AddForm => ({
  staff_id: "",
  item_name: "",
  quantity: "1",
  unit_price: "",
  consumed_at: todayStr(),
  notes: "",
  added_by: "",
});

type Tab = "add" | "report";

export default function StaffFoodPage() {
  const [tab, setTab] = useState<Tab>("add");

  // Only an admin may delete a food entry once it has been added.
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const logCols = isAdmin ? 7 : 6;

  // Add tab state
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [logs, setLogs] = useState<FoodLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [filterStaff, setFilterStaff] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Report tab state
  const [reportMonth, setReportMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [expandedStaff, setExpandedStaff] = useState<Set<number>>(new Set());

  const fetchStaff = useCallback(async () => {
    try {
      const data = await api.get<StaffMember[]>("/staff");
      setStaff(data ?? []);
    } catch {
      // non-critical
    }
  }, []);

  const fetchLogs = useCallback(async (staffId: string) => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams();
      if (staffId) params.set("staff_id", staffId);
      params.set("month", currentMonth());
      const data = await api.get<{ data: FoodLogEntry[] }>(`/staff-food?${params}`);
      setLogs(data.data ?? []);
    } catch {
      // ignore
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const fetchSummary = useCallback(async (month: string) => {
    setSummaryLoading(true);
    try {
      const data = await api.get<MonthlySummary>(`/staff-food/summary?month=${month}`);
      setSummary(data);
    } catch {
      // ignore
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  useEffect(() => {
    if (tab === "add") fetchLogs(filterStaff);
  }, [tab, filterStaff, fetchLogs]);

  useEffect(() => {
    if (tab === "report") fetchSummary(reportMonth);
  }, [tab, reportMonth, fetchSummary]);

  const computedTotal = useMemo(() => {
    const qty = parseInt(form.quantity) || 0;
    const price = parseInt(form.unit_price) || 0;
    return qty * price;
  }, [form.quantity, form.unit_price]);

  function openAdd() {
    setForm(emptyForm());
    setFormError("");
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.staff_id || !form.item_name.trim() || !form.quantity || !form.unit_price || !form.consumed_at) {
      setFormError("Staff, item name, quantity, price and date are required.");
      return;
    }
    const qty = parseInt(form.quantity);
    const price = parseInt(form.unit_price);
    if (isNaN(qty) || qty < 1) { setFormError("Quantity must be at least 1."); return; }
    if (isNaN(price) || price < 1) { setFormError("Unit price must be a positive number."); return; }

    setSaving(true);
    setFormError("");
    try {
      const created = await api.post<FoodLogEntry>("/staff-food", {
        staff_id:    parseInt(form.staff_id),
        item_name:   form.item_name.trim(),
        quantity:    qty,
        unit_price:  price,
        consumed_at: form.consumed_at,
        notes:       form.notes.trim() || null,
        added_by:    form.added_by.trim() || null,
      });
      setLogs((prev) => [created, ...prev]);
      setShowModal(false);
      if (tab === "report") fetchSummary(reportMonth);
    } catch {
      setFormError("Failed to save entry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.delete(`/staff-food/${id}`);
      setLogs((prev) => prev.filter((l) => l.id !== id));
      setDeleteId(null);
      if (tab === "report") fetchSummary(reportMonth);
    } catch {
      // ignore
    }
  }

  function toggleExpanded(staffId: number) {
    setExpandedStaff((prev) => {
      const next = new Set(prev);
      next.has(staffId) ? next.delete(staffId) : next.add(staffId);
      return next;
    });
  }

  const staffMap = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  /** New entries go against the working roster; the filter above still lists
   *  inactive staff, who may well have logs earlier in the month. */
  const activeStaff = useMemo(() => staff.filter((s) => s.is_active), [staff]);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Food Tracker</h1>
          <p className="text-sm text-gray-500 mt-0.5">Log staff meals and generate monthly salary deduction reports</p>
        </div>
        {tab === "add" && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-brand-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/>
            </svg>
            Add Food Entry
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-1 w-fit">
        <button
          onClick={() => setTab("add")}
          className={`px-5 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "add" ? "bg-white text-brand-red shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Food Entries
        </button>
        <button
          onClick={() => setTab("report")}
          className={`px-5 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "report" ? "bg-white text-brand-red shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Monthly Report
        </button>
      </div>

      {/* ── ADD / LIST TAB ── */}
      {tab === "add" && (
        <>
          {/* Filter */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 font-medium">Staff:</label>
            <select
              value={filterStaff}
              onChange={(e) => setFilterStaff(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
            >
              <option value="">All Staff</option>
              {staff.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Staff</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit Price</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: logCols }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: j === 2 ? "80%" : "60%" }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={logCols} className="px-4 py-12 text-center text-gray-400 text-sm">
                      No food entries found. Add one to get started.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const s = log.staff ?? staffMap[log.staff_id];
                    return (
                      <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-700">{log.consumed_at}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{s?.name ?? "—"}</span>
                            {s?.role && (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[s.role] ?? "bg-gray-100 text-gray-600"}`}>
                                {s.role}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {log.item_name}
                          {log.notes && <span className="block text-xs text-gray-400">{log.notes}</span>}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-700">{log.quantity}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{fmt(log.unit_price)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(log.total_amount)}</td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-right">
                            {deleteId === log.id ? (
                              <span className="inline-flex items-center gap-2">
                                <span className="text-xs text-gray-500">Delete?</span>
                                <button onClick={() => handleDelete(log.id)} className="text-xs text-red-600 font-medium hover:underline">Yes</button>
                                <button onClick={() => setDeleteId(null)} className="text-xs text-gray-500 hover:underline">No</button>
                              </span>
                            ) : (
                              <button onClick={() => setDeleteId(log.id)} className="text-xs text-red-500 font-medium hover:underline">
                                Delete
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── MONTHLY REPORT TAB ── */}
      {tab === "report" && (
        <>
          {/* Month picker */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 font-medium">Month:</label>
            <input
              type="month"
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
            />
          </div>

          {summaryLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : !summary || summary.by_staff.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-16 text-center text-gray-400 text-sm">
              No food entries found for {reportMonth}.
            </div>
          ) : (
            <>
              {/* Month total card */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-brand-red/30 ring-1 ring-brand-red/10 shadow-sm p-5">
                  <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total Food Deductions</div>
                  <div className="text-2xl font-bold text-brand-red">{fmt(summary.total)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{reportMonth}</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Staff with Entries</div>
                  <div className="text-2xl font-bold text-gray-900">{summary.by_staff.length}</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Avg per Staff</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {fmt(Math.round(summary.total / (summary.by_staff.length || 1)))}
                  </div>
                </div>
              </div>

              {/* Per-staff breakdown */}
              <div className="space-y-3">
                {summary.by_staff.map((row) => (
                  <div key={row.staff_id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    {/* Staff header row */}
                    <button
                      onClick={() => toggleExpanded(row.staff_id)}
                      className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                    >
                      {/* Chevron */}
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expandedStaff.has(row.staff_id) ? "rotate-90" : ""}`}
                      >
                        <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                      </svg>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{row.staff_name}</span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[row.role] ?? "bg-gray-100 text-gray-600"}`}>
                            {row.role}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {row.entries.length} {row.entries.length === 1 ? "entry" : "entries"} &middot; Salary: {fmt(row.salary)}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-bold text-brand-red text-lg">{fmt(row.total)}</div>
                        {row.salary > 0 && (
                          <div className="text-xs text-gray-400">
                            Net: {fmt(row.salary - row.total)}
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Expanded entries */}
                    {expandedStaff.has(row.staff_id) && (
                      <div className="border-t border-gray-100">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="px-5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                              <th className="px-5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Item</th>
                              <th className="px-5 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">Qty</th>
                              <th className="px-5 py-2 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Unit</th>
                              <th className="px-5 py-2 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {row.entries.map((entry) => (
                              <tr key={entry.id} className="hover:bg-gray-50/50">
                                <td className="px-5 py-2.5 text-gray-600">{entry.consumed_at}</td>
                                <td className="px-5 py-2.5 text-gray-700">
                                  {entry.item_name}
                                  {entry.notes && <span className="block text-xs text-gray-400">{entry.notes}</span>}
                                </td>
                                <td className="px-5 py-2.5 text-center text-gray-600">{entry.quantity}</td>
                                <td className="px-5 py-2.5 text-right text-gray-600">{fmt(entry.unit_price)}</td>
                                <td className="px-5 py-2.5 text-right font-medium text-gray-900">{fmt(entry.total_amount)}</td>
                              </tr>
                            ))}
                            <tr className="bg-red-50/50">
                              <td colSpan={4} className="px-5 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">
                                Total Deduction
                              </td>
                              <td className="px-5 py-2.5 text-right font-bold text-brand-red">{fmt(row.total)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── ADD ENTRY MODAL ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Add Food Entry</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {formError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{formError}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Staff Member *</label>
                  <select
                    value={form.staff_id}
                    onChange={(e) => setForm((f) => ({ ...f, staff_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  >
                    <option value="">Select staff...</option>
                    {activeStaff.map((s) => (
                      <option key={s.id} value={String(s.id)}>{s.name} ({s.role})</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Item Name *</label>
                  <input
                    type="text"
                    value={form.item_name}
                    onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                    placeholder="e.g. Chicken Burger, Fries..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Quantity *</label>
                  <input
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Unit Price (Rs) *</label>
                  <input
                    type="number"
                    min={1}
                    value={form.unit_price}
                    onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))}
                    placeholder="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>

                {computedTotal > 0 && (
                  <div className="col-span-2 bg-red-50 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-sm text-gray-600">Total Amount</span>
                    <span className="font-bold text-brand-red">{fmt(computedTotal)}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={form.consumed_at}
                    onChange={(e) => setForm((f) => ({ ...f, consumed_at: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Added By</label>
                  <input
                    type="text"
                    value={form.added_by}
                    onChange={(e) => setForm((f) => ({ ...f, added_by: e.target.value }))}
                    placeholder="Optional"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Optional note..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-brand-red text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? "Saving..." : "Add Entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

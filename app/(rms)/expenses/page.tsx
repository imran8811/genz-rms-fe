"use client";

import { useState, useEffect, useMemo } from "react";
import { api } from "@/lib/api";

const CATEGORIES = ["Rent", "Utilities", "Salary", "Maintenance", "Supplies", "Marketing", "Other"] as const;
const PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer"] as const;

type Category = (typeof CATEGORIES)[number];
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

interface Expense {
  id: number;
  date: string;
  category: Category;
  description: string;
  amount: number;
  payment_method: PaymentMethod;
  added_by: string | null;
}

interface Summary {
  month: string;
  total: number;
  today: number;
  by_category: { category: Category; total: number }[];
  by_day: { date: string; total: number }[];
}

interface ExpenseForm {
  date: string;
  category: Category;
  description: string;
  amount: string;
  payment_method: PaymentMethod;
  added_by: string;
}

const CATEGORY_COLORS: Record<Category, string> = {
  Rent:        "#E53935",
  Utilities:   "#2563eb",
  Salary:      "#16a34a",
  Maintenance: "#d97706",
  Supplies:    "#9333ea",
  Marketing:   "#db2777",
  Other:       "#475569",
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

const emptyForm = (): ExpenseForm => ({
  date: todayStr(),
  category: "Supplies",
  description: "",
  amount: "",
  payment_method: "Cash",
  added_by: "",
});

type ViewMode = "today" | "monthly";

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState("");

  const [viewMode, setViewMode] = useState<ViewMode>("today");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [filterCategory, setFilterCategory] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpenseForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [deleteId, setDeleteId] = useState<number | null>(null);

  async function fetchSummary(month: string) {
    setSummaryLoading(true);
    try {
      const data = await api.get<Summary>(`/expenses/summary?month=${month}`);
      setSummary(data);
    } catch {
      // summary is non-critical
    } finally {
      setSummaryLoading(false);
    }
  }

  async function fetchExpenses(mode: ViewMode, month: string, category: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (mode === "today") {
        params.set("date", todayStr());
      } else {
        params.set("month", month);
      }
      if (category) params.set("category", category);
      const data = await api.get<{ data: Expense[] }>(`/expenses?${params}`);
      setExpenses(data.data);
      setError("");
    } catch {
      setError("Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSummary(selectedMonth);
    fetchExpenses(viewMode, selectedMonth, filterCategory);
  }, [viewMode, selectedMonth, filterCategory]);

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError("");
    setShowModal(true);
  }

  function openEdit(exp: Expense) {
    setEditingId(exp.id);
    setForm({
      date: exp.date,
      category: exp.category,
      description: exp.description,
      amount: String(exp.amount),
      payment_method: exp.payment_method,
      added_by: exp.added_by ?? "",
    });
    setFormError("");
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.date || !form.description.trim() || !form.amount) {
      setFormError("Date, description, and amount are required.");
      return;
    }
    const amount = parseInt(form.amount);
    if (isNaN(amount) || amount < 1) {
      setFormError("Amount must be a positive number.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = { ...form, amount };
      if (editingId) {
        const updated = await api.patch<Expense>(`/expenses/${editingId}`, payload);
        setExpenses((prev) => prev.map((e) => (e.id === editingId ? updated : e)));
      } else {
        const created = await api.post<Expense>("/expenses", payload);
        setExpenses((prev) => [created, ...prev]);
      }
      setShowModal(false);
      fetchSummary(selectedMonth);
      fetchExpenses(viewMode, selectedMonth, filterCategory);
    } catch {
      setFormError("Failed to save expense.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.delete(`/expenses/${id}`);
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      setDeleteId(null);
      fetchSummary(selectedMonth);
      fetchExpenses(viewMode, selectedMonth, filterCategory);
    } catch {
      // ignore
    }
  }

  const maxCategory = useMemo(() => {
    if (!summary?.by_category.length) return 0;
    return Math.max(...summary.by_category.map((c) => c.total));
  }, [summary]);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track daily operational costs</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/>
          </svg>
          Add Expense
        </button>
      </div>

      {/* View toggle + Month picker */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-1">
          <button
            onClick={() => setViewMode("today")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              viewMode === "today"
                ? "bg-white text-amber-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setViewMode("monthly")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              viewMode === "monthly"
                ? "bg-white text-amber-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Monthly
          </button>
        </div>
        {viewMode === "monthly" && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 font-medium">Month:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        )}
        {viewMode === "today" && (
          <span className="text-sm text-gray-500">{new Date().toLocaleDateString("en-PK", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`bg-white rounded-xl border shadow-sm p-5 ${viewMode === "today" ? "border-amber-200 ring-1 ring-amber-100" : "border-gray-100"}`}>
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Today's Expenses</div>
          {summaryLoading ? (
            <div className="h-7 w-24 bg-gray-100 rounded animate-pulse" />
          ) : (
            <div className="text-2xl font-bold text-amber-600">{fmt(summary?.today ?? 0)}</div>
          )}
        </div>
        <div className={`bg-white rounded-xl border shadow-sm p-5 ${viewMode === "monthly" ? "border-amber-200 ring-1 ring-amber-100" : "border-gray-100"}`}>
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Monthly Total</div>
          {summaryLoading ? (
            <div className="h-7 w-32 bg-gray-100 rounded animate-pulse" />
          ) : (
            <div className="text-2xl font-bold text-gray-900">{fmt(summary?.total ?? 0)}</div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Categories</div>
          {summaryLoading ? (
            <div className="h-7 w-16 bg-gray-100 rounded animate-pulse" />
          ) : (
            <div className="text-2xl font-bold text-gray-900">{summary?.by_category.length ?? 0}</div>
          )}
        </div>
      </div>

      {/* Category breakdown */}
      {summary && summary.by_category.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Breakdown by Category</h2>
          <div className="space-y-3">
            {summary.by_category.map((row) => (
              <div key={row.category} className="flex items-center gap-3">
                <div className="w-24 text-xs text-gray-600 shrink-0">{row.category}</div>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: maxCategory ? `${(row.total / maxCategory) * 100}%` : "0%",
                      backgroundColor: CATEGORY_COLORS[row.category],
                    }}
                  />
                </div>
                <div className="text-xs font-medium text-gray-700 w-28 text-right shrink-0">
                  {fmt(row.total)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600 font-medium">Category:</label>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: j === 2 ? "80%" : "60%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">
                  {viewMode === "today" ? "No expenses recorded today." : "No expenses found for this month."}
                </td>
              </tr>
            ) : (
              expenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-700">{exp.date}</td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: CATEGORY_COLORS[exp.category] + "18",
                        color: CATEGORY_COLORS[exp.category],
                      }}
                    >
                      {exp.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{exp.description}</td>
                  <td className="px-4 py-3 text-gray-500">{exp.payment_method}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(exp.amount)}</td>
                  <td className="px-4 py-3 text-right">
                    {deleteId === exp.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-gray-500">Delete?</span>
                        <button
                          onClick={() => handleDelete(exp.id)}
                          className="text-xs text-red-600 font-medium hover:underline"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDeleteId(null)}
                          className="text-xs text-gray-500 hover:underline"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3">
                        <button
                          onClick={() => openEdit(exp)}
                          className="text-xs text-blue-600 font-medium hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteId(exp.id)}
                          className="text-xs text-red-500 font-medium hover:underline"
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                {editingId ? "Edit Expense" : "Add Expense"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {formError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category *</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What was this expense for?"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Amount (Rs) *</label>
                  <input
                    type="number"
                    min={1}
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Payment Method</label>
                  <select
                    value={form.payment_method}
                    onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value as PaymentMethod }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Added By</label>
                <input
                  type="text"
                  value={form.added_by}
                  onChange={(e) => setForm((f) => ({ ...f, added_by: e.target.value }))}
                  placeholder="Name (optional)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
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
                className="px-5 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving..." : editingId ? "Save Changes" : "Add Expense"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

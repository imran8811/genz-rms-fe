"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { RequireAdmin } from "@/lib/auth";
import Link from "next/link";

interface SalesSummary {
  revenue: number;
  orders: number;
  avg_value: number;
  /** Keyed by channel: Food Panda is its own bucket, not part of Takeaway. */
  by_type: Record<"Dine-in" | "Takeaway" | "Delivery" | "Food Panda", { count: number; revenue: number }>;
  foodpanda?: { orders: number; revenue: number };
  window_2_4?: { orders: number; revenue: number };
  window_4_6?: { orders: number; revenue: number };
}

interface ExpenseSummary {
  total: number;
  today: number;
  by_category: { category: string; total: number }[];
}

interface Purchase {
  id: number;
  total_amount: number;
}

interface StaffMember {
  id: number;
  name: string;
  salary: number;
  is_active: boolean;
}

interface StaffFoodSummary {
  month: string;
  total: number;
}

function fmt(n: number) {
  return "Rs " + Math.round(n).toLocaleString("en-PK");
}

// Estimated profit rates by channel. Food Panda takes a commission off the top,
// so its margin is far thinner than a sale we take ourselves. These are working
// estimates applied to revenue — not costed from recipes.
const FP_MARGIN = 0.15;
const DIRECT_MARGIN = 0.45;
const pct = (rate: number) => `${Math.round(rate * 100)}%`;

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function fmtMonth(ym: string) {
  return new Date(ym + "-01T00:00:00").toLocaleDateString("en-PK", { month: "long", year: "numeric" });
}

function KpiCard({
  label,
  value,
  sub,
  color,
  icon,
  loading,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: React.ReactNode;
  loading?: boolean;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-soft p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: color + "18", color }}
        >
          {icon}
        </div>
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-7 bg-gray-100 rounded-lg animate-pulse w-2/3" />
          <div className="h-3.5 bg-gray-100 rounded animate-pulse w-1/2" />
        </div>
      ) : (
        <div>
          <div className="text-2xl font-bold text-gray-900 leading-tight">{value}</div>
          {sub && (
            <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              {trend === "up" && (
                <svg viewBox="0 0 16 16" fill="#16a34a" className="w-3 h-3">
                  <path d="M8 4l4 4H9v4H7V8H4l4-4z"/>
                </svg>
              )}
              {trend === "down" && (
                <svg viewBox="0 0 16 16" fill="#E53935" className="w-3 h-3">
                  <path d="M8 12l-4-4h3V4h2v4h3l-4 4z"/>
                </svg>
              )}
              {sub}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BarRow({
  label,
  value,
  pct,
  color,
  sub,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <span className="text-sm font-medium text-gray-700">{label}</span>
          {sub && <span className="text-xs text-gray-400">{sub}</span>}
        </div>
        <span className="text-sm font-semibold text-gray-600">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

const EXPENSE_COLORS: Record<string, string> = {
  Rent: "#E53935",
  Utilities: "#2563eb",
  Salary: "#16a34a",
  Maintenance: "#d97706",
  Supplies: "#9333ea",
  Marketing: "#db2777",
  Other: "#475569",
};

const ORDER_TYPE_COLORS = {
  "Dine-in": "#2563eb",
  "Takeaway": "#d97706",
  "Delivery": "#ea580c",
  "Food Panda": "#db2777",
};

function DashboardContent() {
  const [monthlySales, setMonthlySales] = useState<SalesSummary | null>(null);
  const [expenses, setExpenses] = useState<ExpenseSummary | null>(null);
  const [monthlyPurchasesTotal, setMonthlyPurchasesTotal] = useState<number | null>(null);
  const [staffSalaryTotal, setStaffSalaryTotal] = useState<number | null>(null);
  const [staffFoodTotal, setStaffFoodTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth());

  const isCurrentMonth = selectedMonth >= currentMonth();
  const shiftMonth = (delta: number) => {
    const d = new Date(selectedMonth + "-01T00:00:00");
    d.setMonth(d.getMonth() + delta);
    const next = d.toISOString().slice(0, 7);
    if (next <= currentMonth()) setSelectedMonth(next);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    const month = selectedMonth;
    Promise.all([
      api.get<SalesSummary>(`/sales/summary?month=${month}`),
      api.get<ExpenseSummary>(`/expenses/summary?month=${month}`),
      api.get<Purchase[]>(`/purchases?month=${month}`),
      api.get<StaffMember[]>("/staff"),
      api.get<StaffFoodSummary>(`/staff-food/summary?month=${month}`),
    ])
      .then(([ms, exp, purchases, staff, food]) => {
        setMonthlySales(ms as SalesSummary);
        setExpenses(exp as ExpenseSummary);

        const list = Array.isArray(purchases) ? purchases : (purchases as { data?: Purchase[] })?.data ?? [];
        const purchaseTotal = list.reduce((s, p) => s + (Number(p.total_amount) || 0), 0);
        setMonthlyPurchasesTotal(purchaseTotal);

        const staffList = Array.isArray(staff) ? staff : (staff as { data?: StaffMember[] })?.data ?? [];
        const active = staffList.filter((s) => s.is_active);
        setStaffSalaryTotal(active.reduce((s, m) => s + (Number(m.salary) || 0), 0));

        setStaffFoodTotal(Number((food as StaffFoodSummary)?.total) || 0);
      })
      .catch(() => setError("Could not load dashboard data. Check API connection."))
      .finally(() => setLoading(false));
  }, [selectedMonth]);

  const netBalance =
    monthlySales && expenses && monthlyPurchasesTotal !== null
      ? Number(monthlySales.revenue) - monthlyPurchasesTotal - Number(expenses.total)
      : null;

  const balanceColor = netBalance === null ? "#2563eb" : netBalance >= 0 ? "#16a34a" : "#E53935";

  const fpOrders = monthlySales?.foodpanda?.orders ?? 0;
  const fpRevenue = Number(monthlySales?.foodpanda?.revenue ?? 0);
  const fpShare =
    monthlySales && Number(monthlySales.revenue) > 0
      ? (fpRevenue / Number(monthlySales.revenue)) * 100
      : 0;
  const fpAvg = fpOrders > 0 ? fpRevenue / fpOrders : 0;

  // Estimated profit: Food Panda revenue and everything else earn at different
  // rates, so split the month's sales by channel and apply each rate separately.
  const totalRevenue = Number(monthlySales?.revenue ?? 0);
  const directRevenue = totalRevenue - fpRevenue;
  const fpProfit = fpRevenue * FP_MARGIN;
  const directProfit = directRevenue * DIRECT_MARGIN;
  const estimatedProfit = fpProfit + directProfit;
  // Blended rate actually achieved — sits between the two as the mix shifts.
  const blendedMargin = totalRevenue > 0 ? (estimatedProfit / totalRevenue) * 100 : 0;

  // What's actually left to take home: the estimated profit less the month's
  // running costs. Purchasing is deliberately NOT subtracted here — the 15/45%
  // rates are gross margins, so food cost is already out of them; taking
  // purchases off again would charge for ingredients twice.
  const homeTakenCash =
    monthlySales && expenses ? estimatedProfit - Number(expenses.total) : null;
  const isLoss = homeTakenCash !== null && homeTakenCash < 0;

  const sortedExpenseCategories = expenses?.by_category
    ?.filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6) ?? [];

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="px-6 lg:px-8 py-6 space-y-6 max-w-6xl">
        {/* Header + month selector */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500">{isCurrentMonth ? "This month" : fmtMonth(selectedMonth)} overview</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => shiftMonth(-1)}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm">◀</button>
            <input type="month" value={selectedMonth} max={currentMonth()}
              onChange={(e) => setSelectedMonth(e.target.value || currentMonth())}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
            <button onClick={() => shiftMonth(1)} disabled={isCurrentMonth}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm disabled:opacity-40">▶</button>
            {!isCurrentMonth && (
              <button onClick={() => setSelectedMonth(currentMonth())}
                className="ml-1 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700">This Month</button>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
            {error}
          </div>
        )}

        {/* ── Monthly financial overview ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            {fmtMonth(selectedMonth)} &mdash; Financial Overview
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Sales"
              value={monthlySales ? fmt(monthlySales.revenue) : "—"}
              sub={monthlySales ? `${monthlySales.orders} orders placed` : undefined}
              color="#16a34a"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M3 3v18h18"/>
                  <path d="M7 16l4-4 4 4 4-4"/>
                </svg>
              }
            />
            <KpiCard
              label="Total Purchasing"
              value={monthlyPurchasesTotal !== null ? fmt(monthlyPurchasesTotal) : "—"}
              sub="Raw material & vendor costs"
              color="#ea580c"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 01-8 0"/>
                </svg>
              }
            />
            <KpiCard
              label="Total Expenses"
              value={expenses ? fmt(expenses.total) : "—"}
              sub="Rent, salaries, utilities & more"
              color="#d97706"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <rect x="2" y="5" width="20" height="14" rx="2"/>
                  <path d="M2 10h20"/>
                </svg>
              }
            />
            <KpiCard
              label="Balance in Hand"
              value={netBalance !== null ? fmt(netBalance) : "—"}
              sub="Sales − Purchasing − Expenses"
              color={balanceColor}
              loading={loading}
              trend={netBalance !== null ? (netBalance >= 0 ? "up" : "down") : undefined}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                </svg>
              }
            />
          </div>
        </section>

        {/* ── Food Panda ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="#db2777" strokeWidth={1.8} className="w-4 h-4">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
              Food Panda &mdash; {fmtMonth(selectedMonth)}
            </h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Food Panda Orders"
              value={loading ? "—" : fpOrders.toString()}
              sub="Orders via Food Panda"
              color="#db2777"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 01-8 0"/>
                </svg>
              }
            />
            <KpiCard
              label="Food Panda Sales"
              value={loading ? "—" : fmt(fpRevenue)}
              sub="Revenue via Food Panda"
              color="#db2777"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M3 3v18h18"/>
                  <path d="M7 16l4-4 4 4 4-4"/>
                </svg>
              }
            />
            <KpiCard
              label="Avg FP Order"
              value={loading ? "—" : fmt(fpAvg)}
              sub="Average Food Panda order"
              color="#ea580c"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <line x1="12" y1="1" x2="12" y2="23"/>
                  <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                </svg>
              }
            />
            <KpiCard
              label="Share of Sales"
              value={loading ? "—" : `${fpShare.toFixed(1)}%`}
              sub="Of total monthly revenue"
              color="#9333ea"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M21.21 15.89A10 10 0 118 2.83"/>
                  <path d="M22 12A10 10 0 0012 2v10z"/>
                </svg>
              }
            />
          </div>
        </section>

        {/* ── Estimated profit ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={1.8} className="w-4 h-4">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
            </svg>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
              Estimated Profit &mdash; {fmtMonth(selectedMonth)}
            </h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Food Panda Profit"
              value={loading ? "—" : fmt(fpProfit)}
              sub={loading ? undefined : `${pct(FP_MARGIN)} of ${fmt(fpRevenue)}`}
              color="#db2777"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 01-8 0"/>
                </svg>
              }
            />
            <KpiCard
              label="Direct Sales Profit"
              value={loading ? "—" : fmt(directProfit)}
              sub={loading ? undefined : `${pct(DIRECT_MARGIN)} of ${fmt(directRevenue)}`}
              color="#0d9488"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M3 3v18h18"/>
                  <path d="M7 14l4-4 3 3 5-6"/>
                </svg>
              }
            />
            <KpiCard
              label="Estimated Profit"
              value={loading ? "—" : fmt(estimatedProfit)}
              sub={loading ? undefined : `${blendedMargin.toFixed(1)}% blended margin`}
              color="#0284c7"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M3 3v18h18"/>
                  <path d="M7 14l4-4 3 3 5-6"/>
                </svg>
              }
            />
            <KpiCard
              label={isLoss ? "Loss" : "Home Taken Cash"}
              value={homeTakenCash === null ? "—" : fmt(homeTakenCash)}
              sub={
                homeTakenCash === null
                  ? undefined
                  : `${fmt(estimatedProfit)} profit − ${fmt(Number(expenses?.total ?? 0))} expenses`
              }
              color={isLoss ? "#E53935" : "#16a34a"}
              loading={loading}
              trend={isLoss ? "down" : "up"}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <line x1="12" y1="1" x2="12" y2="23"/>
                  <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                </svg>
              }
            />
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            Estimate only &mdash; {pct(FP_MARGIN)} on Food Panda sales and {pct(DIRECT_MARGIN)} on
            everything else, applied to revenue. These are gross margins, so ingredient
            cost is already deducted and purchasing is not subtracted again; only
            Total Expenses (rent, salaries, utilities) comes off.
          </p>
        </section>

        {/* ── Staff & operating costs ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Staff &amp; Operations
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Staff Salary"
              value={staffSalaryTotal !== null ? fmt(staffSalaryTotal) : "—"}
              sub="Monthly payroll commitment"
              color="#0891b2"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                </svg>
              }
            />
            <KpiCard
              label="Staff Food Cost"
              value={staffFoodTotal !== null ? fmt(staffFoodTotal) : "—"}
              sub="Staff meals this month"
              color="#9333ea"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 002-2V2M5 2v20M16 2v20M16 11c0-3 1-5 3-6V2"/>
                </svg>
              }
            />
            <KpiCard
              label="Orders 4PM–6PM"
              value={monthlySales ? (monthlySales.window_4_6?.orders ?? 0).toString() : "—"}
              sub={monthlySales ? `${fmt(Number(monthlySales.window_4_6?.revenue ?? 0))} total` : undefined}
              color="#2563eb"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              }
            />
            <KpiCard
              label="Orders 2PM–4PM"
              value={monthlySales ? (monthlySales.window_2_4?.orders ?? 0).toString() : "—"}
              sub={monthlySales ? `${fmt(Number(monthlySales.window_2_4?.revenue ?? 0))} total` : undefined}
              color="#16a34a"
              loading={loading}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              }
            />
          </div>
        </section>

        {/* ── Breakdowns ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Expense breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-soft p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-gray-800">Expenses by Category</h3>
              <Link href="/expenses" className="text-xs text-brand-red font-medium hover:underline">
                View all
              </Link>
            </div>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="h-4 bg-gray-100 rounded animate-pulse w-1/2" />
                    <div className="h-1.5 bg-gray-100 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            ) : sortedExpenseCategories.length > 0 ? (
              <div className="space-y-4">
                {sortedExpenseCategories.map((cat) => (
                  <BarRow
                    key={cat.category}
                    label={cat.category}
                    value={fmt(cat.total)}
                    pct={expenses!.total > 0 ? (cat.total / expenses!.total) * 100 : 0}
                    color={EXPENSE_COLORS[cat.category] ?? "#475569"}
                  />
                ))}
                <div className="pt-3 border-t border-gray-100 flex justify-between text-sm">
                  <span className="text-gray-500">Total Expenses</span>
                  <span className="font-bold text-gray-800">{fmt(expenses!.total)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">No expenses recorded this month</p>
            )}
          </div>

          {/* Order type breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-soft p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-gray-800">Sales by Order Type</h3>
              <Link href="/sales" className="text-xs text-brand-red font-medium hover:underline">
                View all
              </Link>
            </div>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="h-4 bg-gray-100 rounded animate-pulse w-1/2" />
                    <div className="h-1.5 bg-gray-100 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            ) : monthlySales ? (
              <div className="space-y-4">
                {(["Dine-in", "Takeaway", "Delivery", "Food Panda"] as const).map((type) => {
                  const d = monthlySales.by_type?.[type] ?? { count: 0, revenue: 0 };
                  const pct =
                    monthlySales.revenue > 0 ? (d.revenue / monthlySales.revenue) * 100 : 0;
                  return (
                    <BarRow
                      key={type}
                      label={type}
                      value={fmt(d.revenue)}
                      pct={pct}
                      color={ORDER_TYPE_COLORS[type]}
                      sub={`(${d.count} orders)`}
                    />
                  );
                })}
                <div className="pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-xs text-gray-400">Total Orders</div>
                    <div className="text-sm font-bold text-gray-800">{monthlySales.orders}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Total Revenue</div>
                    <div className="text-sm font-bold text-gray-800">{fmt(monthlySales.revenue)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Avg / Order</div>
                    <div className="text-sm font-bold text-gray-800">{fmt(monthlySales.avg_value)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">No sales data available</p>
            )}
          </div>
        </div>

        {/* ── Profitability insight ── */}
        {!loading && netBalance !== null && (
          <div
            className="rounded-2xl border p-5 flex items-center gap-4"
            style={{
              backgroundColor: netBalance >= 0 ? "#f0fdf4" : "#fff5f5",
              borderColor: netBalance >= 0 ? "#bbf7d0" : "#fecaca",
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: netBalance >= 0 ? "#16a34a20" : "#E5393520", color: netBalance >= 0 ? "#16a34a" : "#E53935" }}
            >
              {netBalance >= 0 ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              )}
            </div>
            <div>
              <p
                className="text-sm font-semibold"
                style={{ color: netBalance >= 0 ? "#15803d" : "#b91c1c" }}
              >
                {netBalance >= 0
                  ? `Profitable month so far — ${fmt(netBalance)} net balance`
                  : `Running at a loss — ${fmt(Math.abs(netBalance))} over budget`}
              </p>
              <p className="text-xs mt-0.5" style={{ color: netBalance >= 0 ? "#166534" : "#991b1b" }}>
                {netBalance >= 0
                  ? "Your sales are covering all costs this month. Keep it up!"
                  : "Expenses and purchases exceed sales revenue. Review your costs."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RequireAdmin>
      <DashboardContent />
    </RequireAdmin>
  );
}

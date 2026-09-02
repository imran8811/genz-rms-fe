"use client";

import { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";

type StockStatus = "OK" | "Low" | "Critical" | "Out";

interface InventoryItem {
  id: number;
  name: string;
  unit: string;
  current_stock: number;
  min_stock: number;
  cost_per_unit: number;
  status: StockStatus;
}

const statusStyle: Record<StockStatus, string> = {
  OK:       "bg-green-100 text-green-700",
  Low:      "bg-yellow-100 text-yellow-700",
  Critical: "bg-orange-100 text-orange-700",
  Out:      "bg-red-100 text-red-700",
};

function fmt(n: number) { return "Rs" + n.toLocaleString("en-PK"); }

interface AdjustForm {
  inventory_item_id: string;
  type: "in" | "out" | "adjustment";
  quantity: string;
  note: string;
}

const emptyAdjust: AdjustForm = { inventory_item_id: "", type: "in", quantity: "", note: "" };

function LoadingRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse"/></td>
      ))}
    </tr>
  );
}

export default function InventoryPage() {
  const [items, setItems]             = useState<InventoryItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // Adjust modal
  const [showAdjust, setShowAdjust]   = useState(false);
  const [adjustForm, setAdjustForm]   = useState<AdjustForm>(emptyAdjust);
  const [adjustSaving, setAdjustSaving] = useState(false);

  // Add item modal
  const [showAdd, setShowAdd]         = useState(false);
  const [addForm, setAddForm]         = useState({ name: "", unit: "kg", min_stock: "", cost_per_unit: "" });
  const [addSaving, setAddSaving]     = useState(false);

  const fetchItems = useCallback(() => {
    setLoading(true);
    api.get<InventoryItem[]>("/inventory")
      .then(setItems)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const filtered = items;
  const alerts   = items.filter((i) => i.status !== "OK");

  const openAdjustFor = (item: InventoryItem) => {
    setAdjustForm({ ...emptyAdjust, inventory_item_id: String(item.id) });
    setShowAdjust(true);
  };

  const handleAdjust = async () => {
    if (!adjustForm.inventory_item_id || !adjustForm.quantity) return;
    setAdjustSaving(true);
    try {
      await api.post("/inventory/adjust", {
        inventory_item_id: Number(adjustForm.inventory_item_id),
        type:     adjustForm.type,
        quantity: Number(adjustForm.quantity),
        note:     adjustForm.note || undefined,
      });
      setShowAdjust(false);
      setAdjustForm(emptyAdjust);
      fetchItems();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setAdjustSaving(false);
    }
  };

  const handleAddItem = async () => {
    if (!addForm.name) return;
    setAddSaving(true);
    try {
      await api.post("/inventory", {
        name:          addForm.name,
        unit:          addForm.unit,
        min_stock:     Number(addForm.min_stock) || 0,
        cost_per_unit: Number(addForm.cost_per_unit) || 0,
      });
      setShowAdd(false);
      setAddForm({ name: "", unit: "kg", min_stock: "", cost_per_unit: "" });
      fetchItems();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setAddSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500">Stock levels and movements</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm hover:border-gray-400 hover:text-gray-800 transition-colors"
          >
            + Add Item
          </button>
          <button
            onClick={() => { setAdjustForm(emptyAdjust); setShowAdjust(true); }}
            className="flex items-center gap-2 bg-brand-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-red-dark transition-colors"
          >
            Stock Adjustment
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            Could not reach backend: {error}
          </div>
        )}

        {/* Alert banner */}
        {!loading && alerts.length > 0 && (
          <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
            <svg viewBox="0 0 20 20" fill="#d97706" className="w-5 h-5 flex-shrink-0">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
            <span className="text-sm font-medium text-amber-800">
              {alerts.length} item{alerts.length > 1 ? "s" : ""} need attention: {alerts.map((a) => a.name).join(", ")}
            </span>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { label: "Total Items",    value: items.length, color: "text-blue-600", bg: "bg-blue-50", icon: "📦" },
            { label: "Low / Critical", value: items.filter((i) => ["Low","Critical"].includes(i.status)).length, color: "text-yellow-600", bg: "bg-yellow-50", icon: "⚠️" },
            { label: "Out of Stock",   value: items.filter((i) => i.status === "Out").length, color: "text-red-600", bg: "bg-red-50", icon: "🚫" },
            { label: "Stock Value",    value: fmt(items.reduce((a, i) => a + i.current_stock * i.cost_per_unit, 0)), color: "text-green-600", bg: "bg-green-50", icon: "💰" },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-100 shadow-soft p-5">
              <div className={`w-10 h-10 ${c.bg} rounded-xl flex items-center justify-center text-xl mb-3`}>{c.icon}</div>
              <div className={`text-2xl font-bold ${loading ? "text-gray-200 animate-pulse" : c.color}`}>
                {loading ? "——" : c.value}
              </div>
              <div className="text-sm text-gray-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Item</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Stock</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Min</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Cost/Unit</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Value</th>
                <th className="text-center px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-center px-5 py-3 font-medium text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading
                ? Array.from({ length: 6 }).map((_, i) => <LoadingRow key={i} cols={7}/>)
                : filtered.length === 0
                ? <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-400">No inventory items. Add your first item.</td></tr>
                : filtered.map((item) => (
                  <tr key={item.id} className={`hover:bg-gray-50 ${item.status === "Out" ? "bg-red-50/30" : item.status === "Critical" ? "bg-orange-50/30" : ""}`}>
                    <td className="px-5 py-3.5 font-medium text-gray-800">{item.name}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-800">{item.current_stock} {item.unit}</td>
                    <td className="px-5 py-3.5 text-right text-gray-500">{item.min_stock} {item.unit}</td>
                    <td className="px-5 py-3.5 text-right text-gray-600">{fmt(item.cost_per_unit)}</td>
                    <td className="px-5 py-3.5 text-right font-medium text-gray-700">{fmt(Number(item.current_stock) * item.cost_per_unit)}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusStyle[item.status]}`}>{item.status}</span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <button onClick={() => openAdjustFor(item)} className="text-xs text-brand-red hover:text-brand-red-dark font-medium">Adjust</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjust Modal */}
      {showAdjust && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Stock Adjustment</h2>
              <button onClick={() => setShowAdjust(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item *</label>
                <select
                  value={adjustForm.inventory_item_id}
                  onChange={(e) => setAdjustForm({ ...adjustForm, inventory_item_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                >
                  <option value="">Select item…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.current_stock} {i.unit})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={adjustForm.type}
                  onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value as AdjustForm["type"] })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                >
                  <option value="in">Stock In (Add)</option>
                  <option value="out">Stock Out (Remove)</option>
                  <option value="adjustment">Manual Correction</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={adjustForm.quantity}
                  onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
                <input
                  type="text"
                  value={adjustForm.note}
                  onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  placeholder="Reason for adjustment…"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setShowAdjust(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                onClick={handleAdjust}
                disabled={!adjustForm.inventory_item_id || !adjustForm.quantity || adjustSaving}
                className="px-4 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50"
              >
                {adjustSaving ? "Saving…" : "Save Adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Add Inventory Item</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {[
                { label: "Name *",       key: "name",          type: "text",   placeholder: "e.g. Chicken (Whole)" },
                { label: "Unit",         key: "unit",          type: "text",   placeholder: "kg, pcs, ltr…" },
                { label: "Min Stock",    key: "min_stock",     type: "number", placeholder: "0" },
                { label: "Cost/Unit (Rs)", key: "cost_per_unit", type: "number", placeholder: "0" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                  <input
                    type={f.type}
                    value={(addForm as Record<string, string>)[f.key]}
                    onChange={(e) => setAddForm({ ...addForm, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                onClick={handleAddItem}
                disabled={!addForm.name || addSaving}
                className="px-4 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50"
              >
                {addSaving ? "Saving…" : "Add Item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

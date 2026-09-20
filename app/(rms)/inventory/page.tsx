"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MenuOption } from "@/lib/costing";

type StockStatus = "OK" | "Low" | "Critical" | "Out" | "Untracked";

interface InventoryItem {
  id: number;
  name: string;
  unit: string;
  current_stock: number;
  min_stock: number;
  cost_per_unit: number;
  status: StockStatus;
  /** Only tracked items carry a balance — see the backend's StockService. */
  track_stock: boolean;
  menu_item_id: number | null;
  menu_item_name: string | null;
  /** The size this item is sold as ("1.5Ltr"); null for single-price items. */
  variant: string | null;
  is_deal_default: boolean;
}

interface Movement {
  id: number;
  type: "in" | "out" | "adjustment";
  quantity: number;
  stock_after: number;
  reference: string | null;
  note: string | null;
  occurred_at: string | null;
  created_at: string;
}

const statusStyle: Record<StockStatus, string> = {
  OK:        "bg-green-100 text-green-700",
  Low:       "bg-yellow-100 text-yellow-700",
  Critical:  "bg-orange-100 text-orange-700",
  Out:       "bg-red-100 text-red-700",
  Untracked: "bg-gray-100 text-gray-500",
};

function num(n: number) {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString("en-PK", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
function fmt(n: number) { return "Rs " + num(n); }

function fmtWhen(m: Movement) {
  const d = new Date(m.occurred_at ?? m.created_at);
  return d.toLocaleDateString("en-PK", { day: "2-digit", month: "short" });
}

interface AdjustForm {
  inventory_item_id: string;
  type: "in" | "out" | "adjustment";
  quantity: string;
  note: string;
}
const emptyAdjust: AdjustForm = { inventory_item_id: "", type: "in", quantity: "", note: "" };

interface ItemForm {
  id: number | null;
  name: string;
  unit: string;
  min_stock: string;
  cost_per_unit: string;
  track_stock: boolean;
  menu_item_id: string;
  variant: string;
  is_deal_default: boolean;
}
const emptyItem: ItemForm = {
  id: null, name: "", unit: "pc", min_stock: "", cost_per_unit: "",
  track_stock: true, menu_item_id: "", variant: "", is_deal_default: false,
};

function LoadingRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse"/></td>
      ))}
    </tr>
  );
}

interface SetupBalance {
  sold_as: string;
  ingredient: string;
  bought: number;
  sold: number;
  on_hand: number;
  status: StockStatus;
}

export default function InventoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [items, setItems]         = useState<InventoryItem[]>([]);
  const [menuOptions, setMenuOptions] = useState<MenuOption[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  // The catalogue is ~90 raw ingredients and a handful of resale goods. Stock is
  // only ever about the latter, so that is what the page opens on.
  const [showUntracked, setShowUntracked] = useState(false);

  const [showAdjust, setShowAdjust]     = useState(false);
  const [adjustForm, setAdjustForm]     = useState<AdjustForm>(emptyAdjust);
  const [adjustSaving, setAdjustSaving] = useState(false);

  const [showItem, setShowItem]   = useState(false);
  const [itemForm, setItemForm]   = useState<ItemForm>(emptyItem);
  const [itemSaving, setItemSaving] = useState(false);

  const [settingUp, setSettingUp]   = useState(false);
  const [setupResult, setSetupResult] = useState<SetupBalance[] | null>(null);

  const [historyFor, setHistoryFor]   = useState<InventoryItem | null>(null);
  const [movements, setMovements]     = useState<Movement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const fetchItems = useCallback(() => {
    setLoading(true);
    api.get<InventoryItem[]>("/inventory")
      .then(setItems)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  useEffect(() => {
    api.get<MenuOption[]>("/costing/menu-options").then(setMenuOptions).catch(() => setMenuOptions([]));
  }, []);

  const tracked = useMemo(() => items.filter((i) => i.track_stock), [items]);
  const visible = showUntracked ? items : tracked;
  const alerts  = useMemo(
    () => tracked.filter((i) => i.status !== "OK" && i.status !== "Untracked"),
    [tracked],
  );

  /** Sizes offered for the selected menu item — a sized drink is one SKU per size. */
  const variantOptions = useMemo(() => {
    const option = menuOptions.find((m) => String(m.id) === itemForm.menu_item_id);
    return option?.prices ? Object.keys(option.prices) : [];
  }, [menuOptions, itemForm.menu_item_id]);

  const openAdjustFor = (item: InventoryItem) => {
    setAdjustForm({ ...emptyAdjust, inventory_item_id: String(item.id) });
    setShowAdjust(true);
  };

  const openNewItem  = () => { setItemForm(emptyItem); setShowItem(true); };
  const openEditItem = (i: InventoryItem) => {
    setItemForm({
      id: i.id,
      name: i.name,
      unit: i.unit,
      min_stock: String(i.min_stock ?? ""),
      cost_per_unit: String(i.cost_per_unit ?? ""),
      track_stock: i.track_stock,
      menu_item_id: i.menu_item_id ? String(i.menu_item_id) : "",
      variant: i.variant ?? "",
      is_deal_default: i.is_deal_default,
    });
    setShowItem(true);
  };

  const openHistory = (item: InventoryItem) => {
    setHistoryFor(item);
    setMovementsLoading(true);
    api.get<{ data: Movement[] }>(`/inventory/movements?inventory_item_id=${item.id}`)
      .then((res) => setMovements(res.data ?? []))
      .catch(() => setMovements([]))
      .finally(() => setMovementsLoading(false));
  };

  const handleAdjust = async () => {
    if (!adjustForm.inventory_item_id || adjustForm.quantity === "") return;
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

  const handleSaveItem = async () => {
    if (!itemForm.name.trim()) return;
    setItemSaving(true);
    try {
      const payload = {
        name:            itemForm.name.trim(),
        unit:            itemForm.unit || "pc",
        min_stock:       Number(itemForm.min_stock) || 0,
        cost_per_unit:   Math.round(Number(itemForm.cost_per_unit) || 0),
        track_stock:     itemForm.track_stock,
        menu_item_id:    itemForm.track_stock && itemForm.menu_item_id ? Number(itemForm.menu_item_id) : null,
        variant:         itemForm.track_stock ? (itemForm.variant || null) : null,
        is_deal_default: itemForm.track_stock && itemForm.is_deal_default,
      };
      if (itemForm.id) await api.put(`/inventory/${itemForm.id}`, payload);
      else              await api.post("/inventory", payload);
      setShowItem(false);
      fetchItems();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setItemSaving(false);
    }
  };

  /**
   * One-click setup for cold drinks: pairs each flavour+size with its ingredient
   * and derives the balances. The host runs no shell commands, so this is how
   * stock gets switched on at all.
   */
  const handleSetupDrinks = async () => {
    setSettingUp(true);
    try {
      const res = await api.post<{ balances: SetupBalance[]; replayed: { deliveries: number; bills: number } }>(
        "/inventory/setup-category", { category: "cold-drinks", deal_default: "drink-next-cola" },
      );
      setSetupResult(res.balances);
      fetchItems();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSettingUp(false);
    }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const res = await api.post<{ purchases: number; orders: number; opening_date: string }>(
        "/inventory/rebuild", {},
      );
      fetchItems();
      alert(
        `Stock re-derived from ${res.opening_date} onwards:\n` +
        `${res.purchases} deliveries in, ${res.orders} bills out.`,
      );
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setRebuilding(false);
    }
  };

  const stockValue = tracked.reduce((a, i) => a + i.current_stock * i.cost_per_unit, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500">
            Bought in from Purchasing, sold out at the till
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            title="Re-derive every balance from the purchases and bills on file"
            className="flex items-center gap-2 border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm hover:border-gray-400 hover:text-gray-800 transition-colors disabled:opacity-50"
          >
            {rebuilding ? "Recalculating…" : "↻ Recalculate"}
          </button>
          <button
            onClick={openNewItem}
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

        {/* Nothing is counted yet — say what to do about it rather than showing
            a table of zeroes, which is what the module used to do. */}
        {!loading && tracked.length === 0 && (
          <div className="mb-5 p-5 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-sm font-medium text-blue-900 mb-1">Nothing is under stock control yet.</p>
            <p className="text-sm text-blue-800">
              Stock is kept for the things you buy and sell whole — cold drinks, water,
              anything that arrives in a bottle and leaves in one. Ingredients used in
              recipes stay out of this.
            </p>
            {isAdmin && (
              <>
                {/* Cold drinks are 14 flavour+size shelves; pairing each with the
                    right ingredient by hand is 14 chances to mispair one. */}
                <button
                  onClick={handleSetupDrinks}
                  disabled={settingUp}
                  className="mt-3 bg-brand-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-red-dark disabled:opacity-50"
                >
                  {settingUp ? "Setting up…" : "Set up cold drinks"}
                </button>
                <p className="mt-2 text-xs text-blue-700">
                  Links every cold drink to its menu item and size, then works out each
                  balance from the purchases and bills already on file.
                </p>
              </>
            )}
          </div>
        )}

        {/* What the setup just derived, bought and sold shown beside the balance
            so the figure can be checked rather than taken on trust. */}
        {setupResult && (
          <div className="mb-5 rounded-xl border border-green-200 bg-green-50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3">
              <p className="text-sm font-medium text-green-900">
                Cold drinks are now under stock control.
              </p>
              <button onClick={() => setSetupResult(null)} className="text-green-700 hover:text-green-900 text-sm">✕</button>
            </div>
            <table className="w-full text-sm bg-white">
              <thead>
                <tr className="bg-gray-50 border-y border-gray-100">
                  <th className="text-left px-5 py-2 font-medium text-gray-500">Sold as</th>
                  <th className="text-right px-5 py-2 font-medium text-gray-500">Bought</th>
                  <th className="text-right px-5 py-2 font-medium text-gray-500">Sold</th>
                  <th className="text-right px-5 py-2 font-medium text-gray-500">On hand</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {setupResult.map((r) => (
                  <tr key={r.sold_as}>
                    <td className="px-5 py-2 text-gray-800">{r.sold_as}</td>
                    <td className="px-5 py-2 text-right text-green-700">{num(r.bought)}</td>
                    <td className="px-5 py-2 text-right text-red-600">{num(r.sold)}</td>
                    <td className="px-5 py-2 text-right font-semibold text-gray-900">{num(r.on_hand)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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

        {/* Summary cards — tracked items only, or the untracked ~90 would drown them. */}
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { label: "Tracked Items",  value: tracked.length, color: "text-blue-600", bg: "bg-blue-50", icon: "📦" },
            { label: "Low / Critical", value: tracked.filter((i) => ["Low","Critical"].includes(i.status)).length, color: "text-yellow-600", bg: "bg-yellow-50", icon: "⚠️" },
            { label: "Out of Stock",   value: tracked.filter((i) => i.status === "Out").length, color: "text-red-600", bg: "bg-red-50", icon: "🚫" },
            { label: "Stock Value",    value: fmt(stockValue), color: "text-green-600", bg: "bg-green-50", icon: "💰" },
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

        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-500">
            {showUntracked
              ? `All ${items.length} catalogue items`
              : `${tracked.length} item${tracked.length === 1 ? "" : "s"} under stock control`}
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showUntracked}
              onChange={(e) => setShowUntracked(e.target.checked)}
              className="rounded border-gray-300 text-brand-red focus:ring-brand-red"
            />
            Show recipe ingredients ({items.length - tracked.length})
          </label>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Item</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Sold as</th>
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
                ? Array.from({ length: 6 }).map((_, i) => <LoadingRow key={i} cols={8}/>)
                : visible.length === 0
                ? <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-400">No inventory items. Add your first item.</td></tr>
                : visible.map((item) => (
                  <tr key={item.id} className={`hover:bg-gray-50 ${item.status === "Out" ? "bg-red-50/30" : item.status === "Critical" ? "bg-orange-50/30" : ""}`}>
                    <td className="px-5 py-3.5 font-medium text-gray-800">{item.name}</td>
                    <td className="px-5 py-3.5 text-gray-500">
                      {item.menu_item_name ? (
                        <span>
                          {item.menu_item_name}
                          {item.variant && <span className="text-gray-400"> · {item.variant}</span>}
                          {item.is_deal_default && (
                            <span
                              title="Drinks handed out inside deals of this size come off this item"
                              className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600"
                            >
                              deal default
                            </span>
                          )}
                        </span>
                      ) : item.track_stock ? (
                        <span className="text-amber-600" title="Sales cannot be deducted until this is linked to a menu item">
                          not linked
                        </span>
                      ) : (
                        <span className="text-gray-300">recipe ingredient</span>
                      )}
                    </td>
                    {/* An untracked item has no balance to be wrong about. */}
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-800">
                      {item.track_stock
                        ? <span className={item.current_stock < 0 ? "text-red-600" : ""}>{num(item.current_stock)} {item.unit}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right text-gray-500">
                      {item.track_stock ? `${num(item.min_stock)} ${item.unit}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right text-gray-600">{fmt(item.cost_per_unit)}</td>
                    <td className="px-5 py-3.5 text-right font-medium text-gray-700">
                      {item.track_stock ? fmt(item.current_stock * item.cost_per_unit) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusStyle[item.status]}`}>{item.status}</span>
                    </td>
                    <td className="px-5 py-3.5 text-center whitespace-nowrap">
                      <button onClick={() => openEditItem(item)} className="text-xs text-gray-500 hover:text-gray-800 font-medium">Edit</button>
                      {item.track_stock && (
                        <>
                          <span className="text-gray-200 mx-1.5">|</span>
                          <button onClick={() => openHistory(item)} className="text-xs text-gray-500 hover:text-gray-800 font-medium">History</button>
                          <span className="text-gray-200 mx-1.5">|</span>
                          <button onClick={() => openAdjustFor(item)} className="text-xs text-brand-red hover:text-brand-red-dark font-medium">Adjust</button>
                        </>
                      )}
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
                  {tracked.map((i) => <option key={i.id} value={i.id}>{i.name} ({num(i.current_stock)} {i.unit})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={adjustForm.type}
                  onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value as AdjustForm["type"] })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                >
                  <option value="in">Stock In (delivery with no purchase entry)</option>
                  <option value="out">Stock Out (wastage, breakage)</option>
                  <option value="adjustment">Stocktake (counted on the shelf)</option>
                </select>
                {/* The one that behaves differently, and silently getting it
                    wrong would put a balance out by the whole count. */}
                <p className="mt-1.5 text-xs text-gray-500">
                  {adjustForm.type === "adjustment"
                    ? "Sets the balance to what you counted — it replaces the figure rather than moving it."
                    : "Moves the balance by this much."}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
                <input
                  type="number"
                  min="0"
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
                disabled={!adjustForm.inventory_item_id || adjustForm.quantity === "" || adjustSaving}
                className="px-4 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50"
              >
                {adjustSaving ? "Saving…" : "Save Adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Item Modal */}
      {showItem && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{itemForm.id ? "Edit Item" : "Add Inventory Item"}</h2>
              <button onClick={() => setShowItem(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="e.g. Next Cola 1.5Ltr"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <input
                    type="text"
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                    placeholder="pc"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min Stock</label>
                  <input
                    type="number"
                    value={itemForm.min_stock}
                    onChange={(e) => setItemForm({ ...itemForm, min_stock: e.target.value })}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost/Unit</label>
                  <input
                    type="number"
                    value={itemForm.cost_per_unit}
                    onChange={(e) => setItemForm({ ...itemForm, cost_per_unit: e.target.value })}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                  />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={itemForm.track_stock}
                    onChange={(e) => setItemForm({ ...itemForm, track_stock: e.target.checked })}
                    className="mt-0.5 rounded border-gray-300 text-brand-red focus:ring-brand-red"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-800">Track stock</span>
                    <span className="block text-xs text-gray-500">
                      For things bought and sold whole — drinks, water. Leave off for
                      ingredients used in recipes: they are measured in grams and nobody
                      counts them off a shelf.
                    </span>
                  </span>
                </label>
              </div>

              {itemForm.track_stock && (
                <div className="space-y-4 rounded-xl bg-gray-50 p-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sold as (menu item)</label>
                    <select
                      value={itemForm.menu_item_id}
                      onChange={(e) => setItemForm({ ...itemForm, menu_item_id: e.target.value, variant: "" })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-red"
                    >
                      <option value="">Not sold directly…</option>
                      {menuOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <p className="mt-1.5 text-xs text-gray-500">
                      Selling this on the till is what takes one off the shelf. Names are not
                      matched — an item called &ldquo;coke 345ml&rdquo; will never find
                      &ldquo;Coca&nbsp;Cola / 350ml&rdquo; on its own.
                    </p>
                  </div>

                  {variantOptions.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Size *</label>
                      <select
                        value={itemForm.variant}
                        onChange={(e) => setItemForm({ ...itemForm, variant: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-red"
                      >
                        <option value="">Select size…</option>
                        {variantOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <p className="mt-1.5 text-xs text-gray-500">
                        Each size is its own shelf — a 350ml bottle and a 1.5Ltr bottle are
                        different things, so they need one inventory item each.
                      </p>
                    </div>
                  )}

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={itemForm.is_deal_default}
                      onChange={(e) => setItemForm({ ...itemForm, is_deal_default: e.target.checked })}
                      className="mt-0.5 rounded border-gray-300 text-brand-red focus:ring-brand-red"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-800">Default drink for deals of this size</span>
                      <span className="block text-xs text-gray-500">
                        A deal records &ldquo;2x Drink 1.5Ltr&rdquo; and never the flavour, so
                        those bottles come off this item. The count stays right; which flavour
                        went out does not. Only one item per size.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setShowItem(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                onClick={handleSaveItem}
                disabled={!itemForm.name.trim() || itemSaving}
                className="px-4 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50"
              >
                {itemSaving ? "Saving…" : itemForm.id ? "Save Changes" : "Add Item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Movements — where a balance came from, which is the only way to argue with it */}
      {historyFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">{historyFor.name}</h2>
                <p className="text-xs text-gray-500">
                  Now {num(historyFor.current_stock)} {historyFor.unit}
                </p>
              </div>
              <button onClick={() => setHistoryFor(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {movementsLoading ? (
                <p className="px-6 py-10 text-center text-sm text-gray-400">Loading…</p>
              ) : movements.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-gray-400">
                  No movements yet — no deliveries recorded and nothing sold.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-50">
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="px-6 py-3 text-gray-400 whitespace-nowrap">{fmtWhen(m)}</td>
                        <td className="px-2 py-3">
                          <div className="text-gray-700">{m.note ?? m.reference ?? m.type}</div>
                          {m.note && m.reference && <div className="text-xs text-gray-400">{m.reference}</div>}
                        </td>
                        <td className={`px-2 py-3 text-right font-semibold whitespace-nowrap ${
                          m.type === "in" ? "text-green-600" : m.type === "out" ? "text-red-600" : "text-blue-600"
                        }`}>
                          {m.type === "in" ? "+" : m.type === "out" ? "−" : "="}{num(m.quantity)}
                        </td>
                        <td className="px-6 py-3 text-right text-gray-500 whitespace-nowrap">{num(m.stock_after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

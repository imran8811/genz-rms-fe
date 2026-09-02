"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import type { Ingredient } from "@/lib/costing";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveTab = "purchases" | "vendors" | "items";

interface Purchase {
  id: number;
  date: string;
  item_name: string;
  inventory_item_id: number | null;
  vendor_name: string;
  rate: number;
  quantity: number;
  unit: string;
  /** Quantity received in the ingredient's base unit — 2 bottles → 1900 g. */
  base_qty: number | null;
  base_unit: string | null;
  /** What this purchase implies for costing: rate ÷ pack size. */
  cost_per_base_unit: number | null;
  total_amount: number;
}

// Base units for catalogue items — match the costing module's ingredient units.
const ITEM_UNITS = ["g", "kg", "ml", "Ltrs", "pc"];

// Units a purchase can be recorded in. Measurement units convert globally
// (Rs 80/kg → Rs 0.08/g); everything else is a pack unit and is converted with
// the ingredient's predefined pack size (Rs 1200/bottle ÷ 950 g → Rs 1.26/g).
const MEASUREMENT_UNITS = ["g", "kg", "ml", "Ltrs", "pc"];
const PACK_UNITS = ["bottle", "packet", "shashay", "pcs", "carton", "tin", "bag"];
const PURCHASE_UNITS = [...MEASUREMENT_UNITS, ...PACK_UNITS];

/** Mirrors CostingService::ALIASES — spellings that mean the same base unit. */
const UNIT_ALIASES: Record<string, string> = {
  gram: "g", grams: "g", gm: "g", gms: "g", kgs: "kg",
  ltr: "l", ltrs: "l", litre: "l", liter: "l", litres: "l",
  piece: "pc", pieces: "pc", pcs: "pc",
};
const normUnit = (u: string) => {
  const k = u.trim().toLowerCase();
  return UNIT_ALIASES[k] ?? k;
};
const UNIT_FACTORS: Record<string, { base: string; factor: number }> = {
  g: { base: "g", factor: 1 },   kg: { base: "g", factor: 1000 },
  ml: { base: "ml", factor: 1 }, l:  { base: "ml", factor: 1000 },
  pc: { base: "pc", factor: 1 },
};

/**
 * Cost of one base unit implied by buying one `unit` at `rate` — the same rule
 * the backend applies, mirrored here purely so the form can preview it.
 * Returns null when it can't be resolved (pack unit, no pack size).
 */
function costPerBaseUnit(rate: number, unit: string, item?: Ingredient): number | null {
  if (!item || !rate) return null;
  const from = UNIT_FACTORS[normUnit(unit)];
  const to   = UNIT_FACTORS[normUnit(item.base_unit)];
  if (from && to && from.base === to.base) return rate / (from.factor / to.factor);
  return item.pack_size ? rate / item.pack_size : null;
}

interface Vendor {
  id: number;
  name: string;
  phone: string | null;
  is_active: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Round to 2 decimals, and only show them when there is a fraction to show —
 * "1,200", "1.26", "0.50". Whole numbers stay clean instead of trailing ".00".
 */
function num(n: number) {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString("en-PK", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
function fmt(n: number) { return "Rs " + num(n); }
function todayStr()        { return new Date().toISOString().split("T")[0]; }
function currentMonthStr() { return new Date().toISOString().slice(0, 7); }
function fmtDate(d: string) {
  return new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-PK", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function LoadingRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
      ))}
    </tr>
  );
}

const INITIAL_PURCHASE_ROWS = 5;

interface PurchaseRow {
  date: string;
  item_name: string;
  vendor_id: string;
  rate: string;
  quantity: string;
  /** What the rate is quoted against — defaults to the item's buying unit. */
  unit: string;
}
const emptyRow = (): PurchaseRow => ({ date: todayStr(), item_name: "", vendor_id: "", rate: "", quantity: "", unit: "" });
const initialRows = () => Array.from({ length: INITIAL_PURCHASE_ROWS }, emptyRow);
const emptyVendorForm = { id: null as number | null, name: "", phone: "" };
const emptyItemForm = { id: null as number | null, name: "", supplier: "", base_unit: "g", pack_unit: "bottle", pack_size: "", pack_price: "" };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PurchasingPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("purchases");

  // Purchases
  const [purchases, setPurchases]   = useState<Purchase[]>([]);
  const [purchLoading, setPurchLoading] = useState(true);
  const [month, setMonth]           = useState(currentMonthStr());
  const [deleteId, setDeleteId]     = useState<number | null>(null);

  // Vendors
  const [vendors, setVendors]         = useState<Vendor[]>([]);
  const [vendorLoading, setVendorLoading] = useState(true);

  // Ingredient catalogue — the single source of items. Powers the Items tab and
  // the Item Name picker on the purchase form.
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientsLoading, setIngredientsLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  // Add Purchase modal — supports adding many entries in one submit.
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");

  // Add / Edit Vendor modal
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [vendorForm, setVendorForm] = useState({ ...emptyVendorForm });
  const [vendorSaving, setVendorSaving] = useState(false);
  const [deleteVendorId, setDeleteVendorId] = useState<number | null>(null);

  // Add / Edit Item modal
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemForm, setItemForm] = useState({ ...emptyItemForm });
  const [itemSaving, setItemSaving] = useState(false);
  const [deleteItemId, setDeleteItemId] = useState<number | null>(null);

  // ── Fetchers ──────────────────────────────────────────────────────────────

  const fetchPurchases = useCallback(() => {
    setPurchLoading(true);
    api.get<Purchase[]>(`/purchases?month=${month}`)
      .then(setPurchases)
      .catch((e: Error) => setError(e.message))
      .finally(() => setPurchLoading(false));
  }, [month]);

  const fetchVendors = useCallback(() => {
    setVendorLoading(true);
    api.get<Vendor[]>("/vendors")
      .then(setVendors)
      .catch((e: Error) => setError(e.message))
      .finally(() => setVendorLoading(false));
  }, []);

  const fetchIngredients = useCallback(() => {
    setIngredientsLoading(true);
    api.get<Ingredient[]>("/costing/ingredients")
      .then(setIngredients)
      .catch(() => {})
      .finally(() => setIngredientsLoading(false));
  }, []);

  useEffect(() => { fetchPurchases(); }, [fetchPurchases]);
  useEffect(() => { fetchVendors(); },  [fetchVendors]);
  useEffect(() => { fetchIngredients(); }, [fetchIngredients]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const total = useMemo(
    () => purchases.reduce((s, p) => s + Number(p.total_amount), 0),
    [purchases],
  );

  const rowTotal   = (r: PurchaseRow) => (parseFloat(r.rate) || 0) * (parseFloat(r.quantity) || 0);
  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0);
  const rowFilled  = (r: PurchaseRow) => !!(r.item_name.trim() || r.vendor_id || r.rate || r.quantity);
  const rowValid   = (r: PurchaseRow) => !!r.date && !!r.item_name.trim() && !!r.vendor_id && Number(r.rate) > 0 && Number(r.quantity) > 0;
  const filledRows = rows.filter(rowFilled);

  const ingredientFor = useCallback(
    (name: string) => ingredients.find((i) => i.name === name),
    [ingredients],
  );

  /**
   * The costing figure this row implies, e.g. "Rs 1,200 / bottle ÷ 950 g = Rs 1.2632 / g".
   * Quantity is intentionally absent — buying 2 bottles instead of 1 changes the
   * bill, not the cost of a gram.
   */
  const rowCostHint = (r: PurchaseRow): { text: string; ok: boolean } | null => {
    const item = ingredientFor(r.item_name);
    if (!item || !Number(r.rate)) return null;
    const per = costPerBaseUnit(Number(r.rate), r.unit || item.pack_unit || item.base_unit, item);
    if (per == null) {
      return { ok: false, text: "no pack size — set it on the Items tab" };
    }
    return {
      ok: true,
      text: `= Rs ${num(per)} / ${item.base_unit}`,
    };
  };

  const activeVendors = vendors.filter((v) => v.is_active);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openPurchaseModal = () => {
    setEditingId(null);
    setRows(initialRows());
    setPurchaseError("");
    setShowPurchaseModal(true);
  };
  const openEditPurchase = (p: Purchase) => {
    const vendor = vendors.find((v) => v.name === p.vendor_name);
    setEditingId(p.id);
    setRows([{
      date: p.date.slice(0, 10), item_name: p.item_name,
      vendor_id: vendor ? String(vendor.id) : "",
      rate: String(p.rate), quantity: String(p.quantity), unit: p.unit ?? "",
    }]);
    setPurchaseError("");
    setShowPurchaseModal(true);
  };

  const setRow = (idx: number, field: keyof PurchaseRow, value: string) =>
    setRows((rs) => rs.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, [field]: value };
      // Picking an item adopts how that item is bought, so the rate is read
      // against the right unit without the buyer having to think about it.
      if (field === "item_name") next.unit = ingredientFor(value)?.pack_unit || ingredientFor(value)?.base_unit || "";
      return next;
    }));
  const addRow    = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (idx: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, i) => i !== idx) : rs));
  const openVendorModal   = () => { setVendorForm({ ...emptyVendorForm }); setShowVendorModal(true); };
  const openEditVendor    = (v: Vendor) => {
    setVendorForm({ id: v.id, name: v.name, phone: v.phone ?? "" });
    setShowVendorModal(true);
  };
  const openItemModal = () => { setItemForm({ ...emptyItemForm }); setShowItemModal(true); };
  const openEditItem = (i: Ingredient) => {
    setItemForm({
      id:         i.id,
      name:       i.name,
      supplier:   i.supplier ?? "",
      base_unit:  i.base_unit || "g",
      pack_unit:  i.pack_unit || i.base_unit || "bottle",
      pack_size:  i.pack_size != null ? String(i.pack_size) : "",
      pack_price: i.pack_price != null ? String(i.pack_price) : "",
    });
    setShowItemModal(true);
  };

  const handleSaveItem = async () => {
    if (!itemForm.name.trim() || !Number(itemForm.pack_size)) return;
    setItemSaving(true);
    try {
      // Same endpoint the costing module reads — so the item and its derived
      // per-unit cost show up there automatically.
      const payload = {
        name:       itemForm.name.trim(),
        supplier:   itemForm.supplier.trim() || null,
        base_unit:  itemForm.base_unit,
        // How the item is bought — a purchase's rate is read against this.
        pack_unit:  itemForm.pack_unit || itemForm.base_unit,
        pack_size:  Number(itemForm.pack_size),
        pack_price: Number(itemForm.pack_price) || 0,
      };
      if (itemForm.id) await api.put(`/costing/ingredients/${itemForm.id}`, payload);
      else await api.post("/costing/ingredients", payload);
      setShowItemModal(false);
      fetchIngredients();
    } catch (e) { alert((e as Error).message); }
    finally { setItemSaving(false); }
  };

  const handleDeleteItem = async (id: number) => {
    try {
      await api.delete(`/costing/ingredients/${id}`);
      setIngredients((prev) => prev.filter((i) => i.id !== id));
      setDeleteItemId(null);
    } catch (e) { alert((e as Error).message); }
  };

  const canSaveItem = !!itemForm.name.trim() && !!Number(itemForm.pack_size) && !itemSaving;

  const handleSavePurchase = async () => {
    const toSave = rows.filter(rowFilled);
    if (toSave.length === 0) { setPurchaseError("Add at least one entry."); return; }
    if (toSave.some((r) => !rowValid(r))) {
      setPurchaseError("Each filled row needs a date, item, vendor, rate and quantity.");
      return;
    }
    setPurchaseSaving(true);
    setPurchaseError("");

    const payloadFor = (r: PurchaseRow) => {
      const v = vendors.find((x) => x.id === Number(r.vendor_id))!;
      const item = ingredientFor(r.item_name);
      return {
        date:        r.date,
        item_name:   r.item_name.trim(),
        // The FK is what lets the backend find the pack size; the name is kept
        // for free-text entries that aren't in the catalogue yet.
        inventory_item_id: item?.id ?? null,
        vendor_name: v.name,
        rate:        parseFloat(r.rate),
        quantity:    parseFloat(r.quantity),
        // The unit the rate is quoted against — per bottle, per kg, per packet.
        unit:        r.unit || item?.pack_unit || item?.base_unit || "pcs",
      };
    };

    try {
      if (editingId) {
        await api.put(`/purchases/${editingId}`, payloadFor(toSave[0]));
      } else {
        // Save sequentially so the backend re-prices each item deterministically.
        for (const r of toSave) {
          await api.post("/purchases", payloadFor(r));
        }
      }
      setShowPurchaseModal(false);
      fetchPurchases();
      // The backend re-prices the matching item from the latest purchase —
      // refresh the catalogue so the Items tab shows the new price.
      fetchIngredients();
    } catch (e) {
      setPurchaseError((e as Error).message);
      // Some rows may have already saved — refresh so the table reflects them.
      fetchPurchases();
    } finally {
      setPurchaseSaving(false);
    }
  };

  const handleSaveVendor = async () => {
    if (!vendorForm.name.trim()) return;
    setVendorSaving(true);
    try {
      const payload = {
        name:  vendorForm.name.trim(),
        phone: vendorForm.phone.trim() || null,
      };
      if (vendorForm.id) await api.put(`/vendors/${vendorForm.id}`, payload);
      else await api.post("/vendors", payload);
      setShowVendorModal(false);
      fetchVendors();
    } catch (e) { alert((e as Error).message); }
    finally { setVendorSaving(false); }
  };

  const handleDeleteVendor = async (id: number) => {
    try {
      await api.delete(`/vendors/${id}`);
      setVendors((prev) => prev.filter((v) => v.id !== id));
      setDeleteVendorId(null);
    } catch (e) { alert((e as Error).message); }
  };

  const handleDeletePurchase = async (id: number) => {
    try {
      await api.delete(`/purchases/${id}`);
      setPurchases((prev) => prev.filter((p) => p.id !== id));
      setDeleteId(null);
      // Item price may have fallen back to the previous latest purchase.
      fetchIngredients();
    } catch (e) { alert((e as Error).message); }
  };

  const canSavePurchase =
    !purchaseSaving && filledRows.length > 0 && filledRows.every(rowValid);

  const addAction =
    activeTab === "purchases" ? openPurchaseModal : activeTab === "vendors" ? openVendorModal : openItemModal;
  const addLabel =
    activeTab === "purchases" ? "Add Purchasing" : activeTab === "vendors" ? "Add Vendor" : "Add Item";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Purchasing</h1>
          <p className="text-sm text-gray-500">
            {activeTab === "purchases"
              ? (purchLoading ? "Loading…" : `${purchases.length} entr${purchases.length !== 1 ? "ies" : "y"} · ${fmt(total)}`)
              : activeTab === "vendors"
              ? `${vendors.length} vendor${vendors.length !== 1 ? "s" : ""}`
              : (ingredientsLoading ? "Loading…" : `${ingredients.length} item${ingredients.length !== 1 ? "s" : ""}`)}
          </p>
        </div>
        <button
          onClick={addAction}
          className="flex items-center gap-2 bg-brand-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-red-dark transition-colors">
          + {addLabel}
        </button>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-6 flex gap-1 flex-shrink-0">
        {(["purchases", "vendors", "items"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-sm font-medium border-b-2 capitalize transition-colors ${
              activeTab === tab ? "border-brand-red text-brand-red" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}>
            {tab === "purchases" ? "Purchases" : tab === "vendors" ? "Vendors" : "Items"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
            {error}
            <button onClick={() => setError(null)} className="ml-auto underline">Dismiss</button>
          </div>
        )}

        {/* ── Purchases Tab ─────────────────────────────────────────────── */}
        {activeTab === "purchases" && (
          <>
            {/* Filter + summary */}
            <div className="flex items-center gap-4 mb-5">
              <label className="text-sm font-medium text-gray-600">Month:</label>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              <div className="ml-auto flex gap-3">
                <div className="bg-white rounded-xl border border-gray-100 shadow-soft px-5 py-3 min-w-[90px] text-center">
                  <div className="text-xs text-gray-400 mb-0.5">Entries</div>
                  <div className="text-lg font-bold text-gray-900">{purchLoading ? "—" : purchases.length}</div>
                </div>
                <div className="bg-white rounded-xl border border-red-200/60 ring-1 ring-brand-red/10 shadow-soft px-5 py-3 min-w-[130px] text-center">
                  <div className="text-xs text-gray-400 mb-0.5">Total Spent</div>
                  <div className="text-lg font-bold text-brand-red">{purchLoading ? "—" : fmt(total)}</div>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Date</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Item</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Vendor</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Rate</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Qty / Unit</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Total</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {purchLoading
                    ? Array.from({ length: 5 }).map((_, i) => <LoadingRow key={i} cols={7} />)
                    : purchases.length === 0
                    ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                          No purchases for {month}. Click <strong>Add Purchasing</strong> to record your first entry.
                        </td>
                      </tr>
                    )
                    : purchases.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3.5 text-gray-600 whitespace-nowrap">{fmtDate(p.date)}</td>
                        <td className="px-5 py-3.5 font-medium text-gray-800">{p.item_name}</td>
                        <td className="px-5 py-3.5 text-gray-600">{p.vendor_name}</td>
                        <td className="px-5 py-3.5 text-right text-gray-700">{fmt(Number(p.rate))}</td>
                        <td className="px-5 py-3.5 text-right text-gray-700">
                          {num(Number(p.quantity))}
                          <span className="ml-1 text-xs text-gray-400">{p.unit}</span>
                          {/* What costing actually received — 2 bottles → 1,900 g. */}
                          {p.base_qty != null && p.base_unit && (
                            <div className="text-xs text-gray-400">
                              {num(Number(p.base_qty))} {p.base_unit}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right font-semibold text-gray-900">{fmt(Number(p.total_amount))}</td>
                        <td className="px-5 py-3.5 text-center">
                          {deleteId === p.id ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-xs text-gray-500">Delete?</span>
                              <button onClick={() => handleDeletePurchase(p.id)} className="text-xs text-red-600 font-medium hover:underline">Yes</button>
                              <button onClick={() => setDeleteId(null)} className="text-xs text-gray-500 hover:underline">No</button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-3">
                              <button onClick={() => openEditPurchase(p)} className="text-xs text-indigo-600 font-medium hover:underline">Edit</button>
                              <button onClick={() => setDeleteId(p.id)} className="text-xs text-red-500 font-medium hover:underline">Delete</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
                {!purchLoading && purchases.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-200">
                      <td colSpan={5} className="px-5 py-3 font-semibold text-gray-700">
                        Total ({purchases.length} {purchases.length !== 1 ? "items" : "item"})
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900 text-base">{fmt(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}

        {/* ── Vendors Tab ───────────────────────────────────────────────── */}
        {activeTab === "vendors" && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Vendor Name</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Phone</th>
                  <th className="text-center px-5 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-center px-5 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {vendorLoading
                  ? Array.from({ length: 4 }).map((_, i) => <LoadingRow key={i} cols={4} />)
                  : vendors.length === 0
                  ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-12 text-center text-gray-400">
                        No vendors yet. Click <strong>Add Vendor</strong> to add your first.
                      </td>
                    </tr>
                  )
                  : vendors.map((v) => (
                    <tr key={v.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3.5 font-medium text-gray-800">{v.name}</td>
                      <td className="px-5 py-3.5 text-gray-600">{v.phone ?? "—"}</td>
                      <td className="px-5 py-3.5 text-center">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${v.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {v.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {deleteVendorId === v.id ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-xs text-gray-500">Delete?</span>
                            <button onClick={() => handleDeleteVendor(v.id)} className="text-xs text-red-600 font-medium hover:underline">Yes</button>
                            <button onClick={() => setDeleteVendorId(null)} className="text-xs text-gray-500 hover:underline">No</button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-3">
                            <button onClick={() => openEditVendor(v)} className="text-xs text-indigo-600 font-medium hover:underline">Edit</button>
                            <button onClick={() => setDeleteVendorId(v.id)} className="text-xs text-red-500 font-medium hover:underline">Delete</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Items Tab ─────────────────────────────────────────────────── */}
        {activeTab === "items" && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Item</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Supplier</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Pack Size</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Pack Price</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Price / Unit</th>
                  <th className="text-center px-5 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {ingredientsLoading
                  ? Array.from({ length: 5 }).map((_, i) => <LoadingRow key={i} cols={6} />)
                  : ingredients.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                        No items yet. Click <strong>Add Item</strong> to add your first.
                      </td>
                    </tr>
                  )
                  : ingredients.map((i) => (
                    <tr key={i.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3.5 font-medium text-gray-800">{i.name}</td>
                      <td className="px-5 py-3.5 text-gray-600">{i.supplier ?? "—"}</td>
                      <td className="px-5 py-3.5 text-right text-gray-700 whitespace-nowrap">
                        {/* pack_size is in base units; pack_unit is what you buy — "950 g / bottle". */}
                        {i.pack_size != null
                          ? `${num(Number(i.pack_size))} ${i.base_unit}${i.pack_unit && i.pack_unit !== i.base_unit ? ` / ${i.pack_unit}` : ""}`
                          : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-gray-900">
                        {i.pack_price != null ? num(Number(i.pack_price)) : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right text-gray-700 whitespace-nowrap">
                        {(() => {
                          const per =
                            i.unit_cost ??
                            (i.pack_price != null && i.pack_size
                              ? Number(i.pack_price) / Number(i.pack_size)
                              : null);
                          return per != null ? `${num(Number(per))} / ${i.base_unit}` : "—";
                        })()}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {deleteItemId === i.id ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-xs text-gray-500">Delete?</span>
                            <button onClick={() => handleDeleteItem(i.id)} className="text-xs text-red-600 font-medium hover:underline">Yes</button>
                            <button onClick={() => setDeleteItemId(null)} className="text-xs text-gray-500 hover:underline">No</button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-3">
                            <button onClick={() => openEditItem(i)} className="text-xs text-indigo-600 font-medium hover:underline">Edit</button>
                            <button onClick={() => setDeleteItemId(i.id)} className="text-xs text-red-500 font-medium hover:underline">Delete</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add Purchasing Modal (multi-entry) ─────────────────────────────── */}
      {showPurchaseModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="font-semibold text-gray-900">{editingId ? "Edit Purchasing" : "Add Purchasing"}</h2>
                {!editingId && (
                  <p className="text-xs text-gray-500 mt-0.5">Fill in one or more rows and save them all at once.</p>
                )}
              </div>
              <button onClick={() => setShowPurchaseModal(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>

            <div className="p-6 overflow-y-auto">
              {/* Quick vendor add */}
              <div className="flex justify-end mb-3">
                <button type="button" onClick={openVendorModal}
                  className="text-xs text-brand-red hover:underline font-medium">
                  + New vendor
                </button>
              </div>

              {activeVendors.length === 0 && (
                <div className="mb-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                  No vendors yet — add one with “+ New vendor” before recording purchases.
                </div>
              )}

              {purchaseError && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {purchaseError}
                </div>
              )}

              {/* Entry rows */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500">
                      <th className="pb-2 px-2 w-40">Date *</th>
                      <th className="pb-2 px-2">Item *</th>
                      <th className="pb-2 px-2">Vendor *</th>
                      <th className="pb-2 px-2 text-right w-28">Rate *</th>
                      <th className="pb-2 px-2 w-28">Per *</th>
                      <th className="pb-2 px-2 text-right w-24">Qty *</th>
                      <th className="pb-2 px-2 text-right w-28">Total</th>
                      <th className="w-8 pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr key={idx} className="align-middle">
                        <td className="py-1.5 px-2">
                          <input type="date" value={r.date} onChange={(e) => setRow(idx, "date", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
                        </td>
                        <td className="py-1.5 px-2">
                          <select value={r.item_name} onChange={(e) => setRow(idx, "item_name", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                            <option value="">— Select item —</option>
                            {r.item_name && !ingredients.some((i) => i.name === r.item_name) && (
                              <option value={r.item_name}>{r.item_name}</option>
                            )}
                            {ingredients.map((i) => (
                              <option key={i.id} value={i.name}>{i.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <select value={r.vendor_id} onChange={(e) => setRow(idx, "vendor_id", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                            <option value="">— Select —</option>
                            {activeVendors.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <input type="number" min="0" step="0.01" value={r.rate} placeholder="0"
                            onChange={(e) => setRow(idx, "rate", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-red" />
                          {(() => {
                            const hint = rowCostHint(r);
                            if (!hint) return null;
                            return (
                              <div className={`mt-1 text-[11px] leading-tight ${hint.ok ? "text-gray-500" : "text-amber-600"}`}>
                                {hint.text}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="py-1.5 px-2">
                          <select value={r.unit} onChange={(e) => setRow(idx, "unit", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                            <option value="">— unit —</option>
                            {r.unit && !PURCHASE_UNITS.includes(r.unit) && (
                              <option value={r.unit}>{r.unit}</option>
                            )}
                            {PURCHASE_UNITS.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <input type="number" min="0" step="0.001" value={r.quantity} placeholder="0"
                            onChange={(e) => setRow(idx, "quantity", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-red" />
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold text-gray-800 whitespace-nowrap align-top">
                          <div className="py-2">{rowTotal(r) > 0 ? fmt(rowTotal(r)) : "—"}</div>
                        </td>
                        <td className="py-1.5 text-center">
                          {!editingId && rows.length > 1 && (
                            <button type="button" onClick={() => removeRow(idx)} title="Remove row"
                              className="text-gray-300 hover:text-red-500">✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!editingId && (
                <div className="mt-3 flex items-center justify-between">
                  <button type="button" onClick={addRow}
                    className="text-sm font-medium text-brand-red hover:underline">
                    + Add row
                  </button>
                  <div className="text-xs text-gray-500">{filledRows.length} of {rows.length} filled</div>
                </div>
              )}

              {grandTotal > 0 && (
                <div className="mt-4 bg-red-50 rounded-lg px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-gray-600">{editingId ? "Total Amount" : "Grand Total"}</span>
                  <span className="font-bold text-brand-red text-base">{fmt(grandTotal)}</span>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end flex-shrink-0">
              <button onClick={() => setShowPurchaseModal(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleSavePurchase} disabled={!canSavePurchase}
                className="px-5 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50 transition-colors">
                {purchaseSaving ? "Saving…" : editingId ? "Save Changes" : `Add Purchasing${filledRows.length > 0 ? ` (${filledRows.length})` : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Vendor Modal ──────────────────────────────────────────────── */}
      {showVendorModal && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{vendorForm.id ? "Edit Vendor" : "Add Vendor"}</h2>
              <button onClick={() => setShowVendorModal(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name *</label>
                <input type="text" value={vendorForm.name}
                  onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
                  placeholder="e.g. Al-Noor Mart"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="text" value={vendorForm.phone}
                  onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })}
                  placeholder="0300-0000000"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setShowVendorModal(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleSaveVendor} disabled={!vendorForm.name.trim() || vendorSaving}
                className="px-5 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50 transition-colors">
                {vendorSaving ? "Saving…" : vendorForm.id ? "Save Changes" : "Save Vendor"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Item Modal ────────────────────────────────────────────────── */}
      {showItemModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{itemForm.id ? "Edit Item" : "Add Item"}</h2>
              <button onClick={() => setShowItemModal(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
                <input type="text" value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="e.g. Mozzarella Cheese"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                <select value={itemForm.supplier}
                  onChange={(e) => setItemForm({ ...itemForm, supplier: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                  <option value="">— Select vendor —</option>
                  {itemForm.supplier && !vendors.some((v) => v.name === itemForm.supplier) && (
                    <option value={itemForm.supplier}>{itemForm.supplier}</option>
                  )}
                  {activeVendors.map((v) => (
                    <option key={v.id} value={v.name}>{v.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Recipe Unit *</label>
                  <select value={itemForm.base_unit}
                    onChange={(e) => setItemForm({ ...itemForm, base_unit: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                    {ITEM_UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bought As *</label>
                  <select value={itemForm.pack_unit}
                    onChange={(e) => setItemForm({ ...itemForm, pack_unit: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red">
                    {PURCHASE_UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pack Size *</label>
                  <input type="number" min="0" step="0.001" value={itemForm.pack_size}
                    onChange={(e) => setItemForm({ ...itemForm, pack_size: e.target.value })}
                    placeholder="950"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pack Price (Rs) *</label>
                  <input type="number" min="0" step="0.01" value={itemForm.pack_price}
                    onChange={(e) => setItemForm({ ...itemForm, pack_price: e.target.value })}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red" />
                </div>
              </div>

              {/* Spell the bridge out — this line is what keeps costing in grams. */}
              {Number(itemForm.pack_size) > 0 && (
                <p className="text-xs text-gray-500 -mt-1">
                  1 {itemForm.pack_unit} = {num(Number(itemForm.pack_size))} {itemForm.base_unit}
                  {Number(itemForm.pack_price) > 0 && (
                    <>
                      {" → "}
                      <span className="font-medium text-gray-700">
                        Rs {num(Number(itemForm.pack_price) / Number(itemForm.pack_size))} / {itemForm.base_unit}
                      </span>
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setShowItemModal(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleSaveItem} disabled={!canSaveItem}
                className="px-5 py-2 text-sm font-medium bg-brand-red text-white rounded-lg hover:bg-brand-red-dark disabled:opacity-50 transition-colors">
                {itemSaving ? "Saving…" : itemForm.id ? "Save Changes" : "Save Item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

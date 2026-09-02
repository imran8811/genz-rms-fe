"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, RequireAuth } from "@/lib/auth";
import { useMenu } from "@/lib/menuStore";
import { cartReducer, cartTotal, initialCart } from "@/lib/cartReducer";
import { api } from "@/lib/api";
import { rememberLocalOrder } from "@/lib/localOrders";
import type { MenuCategory, MenuItem } from "@/lib/types";
import CategoryTabs from "@/components/CategoryTabs";
import ItemGrid from "@/components/ItemGrid";
import BillPanel from "@/components/BillPanel";
import ItemPickerModal from "@/components/ItemPickerModal";
import DealPickerModal from "@/components/DealPickerModal";
import Receipt from "@/components/Receipt";
import CounterAlerts from "@/components/CounterAlerts";

type PickerState =
  | { kind: "none" }
  | { kind: "item"; category: MenuCategory; item: MenuItem }
  | { kind: "deal"; item: MenuItem };

interface StaffLite {
  id: number;
  name: string;
  role: string;
}

function BillingContent() {
  const menu = useMenu();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [cart, dispatch] = useReducer(cartReducer, initialCart);
  const [billNumber, setBillNumber] = useState(3005);

  const loadNextBillNumber = useCallback(async () => {
    try {
      const res = await api.get<{ next: number }>("/orders/next-number");
      if (typeof res?.next === "number") setBillNumber(res.next);
    } catch (e) {
      console.warn("Could not load next bill number:", e);
    }
  }, []);

  useEffect(() => {
    loadNextBillNumber();
  }, [loadNextBillNumber]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState>({ kind: "none" });
  const [deliveryCharge, setDeliveryCharge] = useState<number>(100);
  const [extraTopping, setExtraTopping] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");

  // Optionally charge this order's items to a staff member's food account.
  const [staffFood, setStaffFood] = useState<boolean>(false);
  const [staffFoodId, setStaffFoodId] = useState<string>("");
  const [staffList, setStaffList] = useState<StaffLite[]>([]);

  useEffect(() => {
    api.get<StaffLite[]>("/staff?active=1").then(setStaffList).catch(() => {});
  }, []);

  const activeCategory = useMemo<MenuCategory | null>(() => {
    if (!menu) return null;
    if (activeCategoryId) return menu.categories.find((c) => c.id === activeCategoryId) ?? null;
    return menu.categories.find((c) => !c.comingSoon && c.items.length > 0) ?? null;
  }, [menu, activeCategoryId]);

  if (!menu) {
    return (
      <main className="flex h-screen items-center justify-center text-gray-500">
        Loading menu…
      </main>
    );
  }

  const handlePickItem = (category: MenuCategory, item: MenuItem) => {
    if (item.pizzaSelection) {
      setPicker({ kind: "deal", item });
    } else {
      setPicker({ kind: "item", category, item });
    }
  };

  const saveOrder = async () => {
    if (cart.lines.length === 0) return;
    if (cart.isFoodpanda === null) return; // Food Panda choice is required
    const subtotal = cartTotal(cart);
    const deliveryAmount = cart.orderType === "Delivery" ? deliveryCharge : 0;
    const total = subtotal + extraTopping + deliveryAmount;

    await api
      .post<{ id: number }>("/orders", {
        order_type: cart.orderType,
        source: cart.isFoodpanda === true ? "foodpanda" : "pos",
        subtotal,
        delivery_charge: deliveryAmount,
        extra_topping: extraTopping,
        total,
        status: "completed",
        notes: notes.trim() || null,
        items: cart.lines.map((l) => ({
          item_name: l.name,
          size: l.size ?? null,
          unit_price: l.unitPrice,
          quantity: l.quantity,
          line_total: l.unitPrice * l.quantity,
          deal_selections: l.dealSelections ?? null,
        })),
      })
      // Remember it so the kitchen board doesn't alarm this terminal about an
      // order that was just rung up on it.
      .then((order) => rememberLocalOrder(order?.id))
      .catch((e) => console.warn("Order save failed:", e));

    // Charge the same items to a staff member's food account so they show up
    // in the Staff module's Food tab (and its salary deductions).
    if (staffFood && staffFoodId) {
      const consumedAt = new Date().toISOString().slice(0, 10);
      await Promise.all(
        cart.lines.map((l) => {
          const unitPrice = Math.round(l.unitPrice);
          const quantity  = Math.round(l.quantity);
          if (unitPrice < 1 || quantity < 1) return Promise.resolve();
          return api
            .post("/staff-food", {
              staff_id:    Number(staffFoodId),
              item_name:   l.size ? `${l.name} (${l.size})` : l.name,
              quantity,
              unit_price:  unitPrice,
              consumed_at: consumedAt,
              notes:       `POS Bill #${billNumber}`,
              added_by:    user?.name ?? null,
            })
            .catch((e) => console.warn("Staff food log failed:", e));
        }),
      );
    }

    await loadNextBillNumber();
    dispatch({ type: "CLEAR" });
    setNotes("");
    setStaffFood(false);
    setStaffFoodId("");
  };

  const handlePrint = async () => {
    if (cart.lines.length === 0) return;
    window.print();
    await saveOrder();
  };

  const handleSave = async () => {
    await saveOrder();
  };

  return (
    <>
      <main className="flex h-screen flex-col overflow-hidden bg-gray-50 print:hidden">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-baseline gap-3">
            <Link href="/billing" className="flex items-baseline gap-2 hover:opacity-80 transition-opacity">
              <span className="text-xl font-bold tracking-tight text-brand-red">GEN Z</span>
              <span className="text-sm font-medium text-gray-500">FOODS</span>
            </Link>
            <span className="text-xs text-gray-300 ml-1">/ POS</span>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-4">
              {user?.role === "admin" && (
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-gray-600 transition-colors hover:text-brand-red"
                >
                  Dashboard
                </Link>
              )}
              <Link
                href="/orders"
                className="text-sm font-medium text-gray-600 transition-colors hover:text-brand-red"
              >
                Orders
              </Link>
              <Link
                href="/sales"
                className="text-sm font-medium text-gray-600 transition-colors hover:text-brand-red"
              >
                Sales
              </Link>
              <Link
                href="/purchasing"
                className="text-sm font-medium text-gray-600 transition-colors hover:text-brand-red"
              >
                Purchasing
              </Link>
              <Link
                href="/expenses"
                className="text-sm font-medium text-gray-600 transition-colors hover:text-brand-red"
              >
                Expenses
              </Link>
              <Link
                href="/staff"
                className="text-sm font-medium text-gray-600 transition-colors hover:text-brand-red"
              >
                Staff
              </Link>
            </nav>
            <button
              onClick={async () => {
                await logout();
                router.replace("/");
              }}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign out
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <CategoryTabs
            categories={menu.categories}
            activeId={activeCategory?.id ?? null}
            onSelect={setActiveCategoryId}
          />
          <ItemGrid category={activeCategory} onPick={handlePickItem} />
          <BillPanel
            cart={cart}
            dispatch={dispatch}
            billNumber={billNumber}
            onPrint={handlePrint}
            onSave={handleSave}
            deliveryCharge={deliveryCharge}
            onDeliveryChargeChange={setDeliveryCharge}
            extraTopping={extraTopping}
            onExtraToppingChange={setExtraTopping}
            notes={notes}
            onNotesChange={setNotes}
            staffFood={staffFood}
            onStaffFoodToggle={setStaffFood}
            staffFoodId={staffFoodId}
            onStaffFoodChange={setStaffFoodId}
            staffList={staffList}
          />
        </div>
      </main>

      {picker.kind === "item" && (
        <ItemPickerModal
          category={picker.category}
          item={picker.item}
          isFoodpanda={cart.isFoodpanda}
          onFoodpandaChange={(value) => dispatch({ type: "SET_FOODPANDA", isFoodpanda: value })}
          onClose={() => setPicker({ kind: "none" })}
          onAdd={(line) => {
            dispatch({ type: "ADD", line });
            setPicker({ kind: "none" });
          }}
        />
      )}

      {picker.kind === "deal" && (
        <DealPickerModal
          deal={picker.item}
          menu={menu}
          onClose={() => setPicker({ kind: "none" })}
          onAdd={(line) => {
            dispatch({ type: "ADD", line });
            setPicker({ kind: "none" });
          }}
        />
      )}

      <Receipt
        restaurant={menu.restaurant}
        cart={cart}
        billNumber={billNumber}
        deliveryCharge={deliveryCharge}
        extraTopping={extraTopping}
        notes={notes}
      />
    </>
  );
}

export default function BillingPage() {
  return (
    <RequireAuth>
      <BillingContent />
      {/* Kitchen → front desk (ready toast) and website → counter (chime + card),
          sharing one top-right column. */}
      <CounterAlerts />
    </RequireAuth>
  );
}

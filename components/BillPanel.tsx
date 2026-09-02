"use client";

import type { Dispatch } from "react";
import type { CartAction, CartState, OrderType } from "@/lib/types";
import { cartTotal } from "@/lib/cartReducer";
import { formatPKR } from "@/lib/currency";

interface StaffLite {
  id: number;
  name: string;
  role: string;
}

interface Props {
  cart: CartState;
  dispatch: Dispatch<CartAction>;
  billNumber: number;
  onPrint: () => void;
  onSave: () => void;
  deliveryCharge: number;
  onDeliveryChargeChange: (value: number) => void;
  extraTopping: number;
  onExtraToppingChange: (value: number) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  staffFood: boolean;
  onStaffFoodToggle: (value: boolean) => void;
  staffFoodId: string;
  onStaffFoodChange: (value: string) => void;
  staffList: StaffLite[];
}

const ORDER_TYPES: OrderType[] = ["Delivery", "Dine-in", "Takeaway"];

export default function BillPanel({ cart, dispatch, billNumber, onPrint, onSave, deliveryCharge, onDeliveryChargeChange, extraTopping, onExtraToppingChange, notes, onNotesChange, staffFood, onStaffFoodToggle, staffFoodId, onStaffFoodChange, staffList }: Props) {
  const isFoodpanda = cart.isFoodpanda;
  const subtotal = cartTotal(cart);
  const isDelivery = cart.orderType === "Delivery";
  const hasPizza = cart.lines.some((l) => l.categoryId === "pizza");
  const total = subtotal + (hasPizza ? extraTopping : 0) + (isDelivery ? deliveryCharge : 0);
  const needsFoodpandaAnswer = cart.lines.length > 0 && isFoodpanda === null;
  const needsStaffSelection = staffFood && !staffFoodId;
  const canSubmit = cart.lines.length > 0 && isFoodpanda !== null && !needsStaffSelection;

  // Selecting a staff member drops their name into the instructions box so it
  // prints on the slip ("Instructions: Staff Food: <name>").
  const handleStaffSelect = (id: string) => {
    onStaffFoodChange(id);
    const staff = staffList.find((s) => String(s.id) === id);
    onNotesChange(staff ? `Staff Food: ${staff.name}` : "");
  };
  const handleStaffToggle = (checked: boolean) => {
    onStaffFoodToggle(checked);
    if (!checked) {
      onStaffFoodChange("");
      if (notes.startsWith("Staff Food:")) onNotesChange("");
    }
  };

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Current Bill
          </h2>
          <span className="text-xs font-mono text-gray-400">
            #{billNumber}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">
          {ORDER_TYPES.map((type) => {
            const active = cart.orderType === type;
            const locked = isFoodpanda === true; // Food Panda forces Takeaway
            return (
              <button
                key={type}
                type="button"
                disabled={locked}
                onClick={() => dispatch({ type: "SET_ORDER_TYPE", orderType: type })}
                className={[
                  "min-h-[40px] rounded-md px-2 py-1.5 text-xs font-semibold transition",
                  active
                    ? "bg-white text-brand-red shadow-sm"
                    : "text-gray-600 active:bg-gray-200",
                  locked && !active ? "opacity-40 cursor-not-allowed" : "",
                ].join(" ")}
              >
                {type}
              </button>
            );
          })}
        </div>
        {isFoodpanda === true && (
          <p className="mt-1 text-[11px] text-gray-400">
            Food Panda orders are set to Takeaway.
          </p>
        )}
        <div
          className={[
            "mt-2 rounded-md border p-2",
            needsFoodpandaAnswer ? "border-amber-300 bg-amber-50" : "border-transparent",
          ].join(" ")}
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" fill="none" stroke={isFoodpanda ? "#db2777" : "#6b7280"} strokeWidth={1.8} className="h-3.5 w-3.5">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            <span className="text-xs font-semibold text-gray-600">Food Panda order?</span>
            <span className="text-brand-red">*</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => dispatch({ type: "SET_FOODPANDA", isFoodpanda: true })}
              className={[
                "min-h-[34px] rounded-md border text-xs font-bold transition",
                isFoodpanda === true
                  ? "border-pink-500 bg-pink-500 text-white"
                  : "border-gray-200 text-gray-600 active:bg-gray-100",
              ].join(" ")}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "SET_FOODPANDA", isFoodpanda: false })}
              className={[
                "min-h-[34px] rounded-md border text-xs font-bold transition",
                isFoodpanda === false
                  ? "border-gray-700 bg-gray-700 text-white"
                  : "border-gray-200 text-gray-600 active:bg-gray-100",
              ].join(" ")}
            >
              No
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {cart.lines.length === 0 ? (
          <div className="mt-10 text-center text-sm text-gray-400">
            Add items from the menu
          </div>
        ) : (
          <ul className="space-y-2">
            {cart.lines.map((line) => (
              <li
                key={line.lineId}
                className="rounded-lg border border-gray-100 bg-gray-50 p-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="text-sm font-semibold leading-tight text-gray-900">
                      {line.name}
                      {line.size && (
                        <span className="ml-1 text-xs font-medium text-gray-500">
                          ({line.size})
                        </span>
                      )}
                    </div>
                    {line.dealSelections && line.dealSelections.length > 0 && (
                      <ul className="mt-1 text-[11px] text-gray-500">
                        {line.dealSelections.map((name, i) => (
                          <li key={i}>↳ {name}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "REMOVE", lineId: line.lineId })}
                    className="rounded p-1 text-gray-300 hover:text-brand-red"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "DEC", lineId: line.lineId })}
                      className="h-8 w-8 rounded-md border border-gray-200 bg-white text-base font-bold text-gray-700 active:bg-gray-100"
                    >
                      −
                    </button>
                    <span className="min-w-[1.5rem] text-center text-sm font-bold tabular-nums">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "INC", lineId: line.lineId })}
                      className="h-8 w-8 rounded-md border border-gray-200 bg-white text-base font-bold text-gray-700 active:bg-gray-100"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-sm font-bold text-gray-900">
                    {formatPKR(line.unitPrice * line.quantity)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-gray-200 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm text-gray-500">Subtotal</span>
          <span className="text-sm tabular-nums text-gray-700">{formatPKR(subtotal)}</span>
        </div>
        {hasPizza && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm text-gray-500 shrink-0">Extra Topping</span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-400">Rs.</span>
              <input
                type="number"
                min={0}
                value={extraTopping}
                onChange={(e) => onExtraToppingChange(Math.max(0, Number(e.target.value)))}
                className="w-20 rounded-md border border-gray-300 px-2 py-0.5 text-right text-sm font-semibold tabular-nums focus:border-brand-red focus:outline-none"
              />
            </div>
          </div>
        )}
        {isDelivery && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm text-gray-500 shrink-0">Delivery</span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-400">Rs.</span>
              <input
                type="number"
                min={0}
                value={deliveryCharge}
                onChange={(e) => onDeliveryChargeChange(Math.max(0, Number(e.target.value)))}
                className="w-20 rounded-md border border-gray-300 px-2 py-0.5 text-right text-sm font-semibold tabular-nums focus:border-brand-red focus:outline-none"
              />
            </div>
          </div>
        )}
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-gray-600">TOTAL</span>
          <span className="text-2xl font-extrabold text-gray-900 tabular-nums">
            {formatPKR(total)}
          </span>
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Order Notes / Instructions
          </label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={2}
            placeholder="e.g. no onions, extra spicy, ring the bell…"
            className="w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-red focus:outline-none"
          />
        </div>
        {/* Staff food — charge these items to a staff member's account */}
        <div className="mb-3 rounded-md border border-gray-200 p-2.5">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={staffFood}
              onChange={(e) => handleStaffToggle(e.target.checked)}
              className="h-4 w-4 accent-brand-red"
            />
            <span className="text-sm font-semibold text-gray-700">Staff Food</span>
          </label>
          {staffFood && (
            <select
              value={staffFoodId}
              onChange={(e) => handleStaffSelect(e.target.value)}
              className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-red focus:outline-none"
            >
              <option value="">— Select staff —</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role})
                </option>
              ))}
            </select>
          )}
          {staffFood && (
            <p className="mt-1.5 text-[11px] text-gray-400">
              On Print/Save, these items are added to the staff member&apos;s Food tab.
            </p>
          )}
        </div>
        {needsFoodpandaAnswer && (
          <p className="mb-2 text-center text-xs font-medium text-amber-700">
            Select Yes or No for Food Panda to continue.
          </p>
        )}
        {needsStaffSelection && (
          <p className="mb-2 text-center text-xs font-medium text-amber-700">
            Select a staff member for Staff Food to continue.
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onSave}
            className="h-12 flex-1 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 active:bg-gray-100 disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onPrint}
            className="h-12 flex-[2] rounded-xl bg-brand-red text-base font-bold text-white shadow-soft active:bg-brand-red-dark disabled:bg-gray-300"
          >
            Print Bill
          </button>
        </div>
      </div>
    </aside>
  );
}

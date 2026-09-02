"use client";

import type { CartState, Restaurant } from "@/lib/types";
import { cartTotal } from "@/lib/cartReducer";
import { formatPKR } from "@/lib/currency";

interface Props {
  restaurant: Restaurant;
  cart: CartState;
  billNumber: number;
  deliveryCharge: number;
  extraTopping: number;
  notes?: string;
}

function formatNow(): string {
  const d = new Date();
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date}  ${time}`;
}

export default function Receipt({ restaurant, cart, billNumber, deliveryCharge, extraTopping, notes }: Props) {
  const subtotal = cartTotal(cart);
  const isDelivery = cart.orderType === "Delivery";
  // A Food Panda bill is a Takeaway underneath, but printing "Takeaway" tells
  // whoever picks up the slip nothing about where the order came from.
  const orderLabel = cart.isFoodpanda ? "Food Panda" : cart.orderType;
  const hasPizza = cart.lines.some((l) => l.categoryId === "pizza");
  const deliveryAmount = isDelivery ? deliveryCharge : 0;
  const toppingAmount = hasPizza ? extraTopping : 0;
  const total = subtotal + toppingAmount + deliveryAmount;

  function ReceiptBody() {
    return (
      <div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "16pt", fontWeight: 800, letterSpacing: "1px" }}>
            {restaurant.name.toUpperCase()}
          </div>
          <div style={{ fontSize: "9pt" }}>{restaurant.address}</div>
          <div style={{ fontSize: "9pt" }}>{restaurant.phone}</div>
        </div>

        <div style={{ margin: "6px 0", borderTop: "1px dashed #000" }} />

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10pt" }}>
          <span>Bill #{billNumber}</span>
          <span>{formatNow()}</span>
        </div>
        <div style={{ fontSize: "10pt" }}>Order: {orderLabel}</div>

        <div style={{ margin: "6px 0", borderTop: "1px dashed #000" }} />

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt" }}>
          <tbody>
            {cart.lines.map((line) => (
              <tr key={line.lineId}>
                <td style={{ verticalAlign: "top", paddingBottom: "2px" }}>
                  <div>
                    {line.name}
                    {line.size ? ` (${line.size})` : ""}
                    <span style={{ fontWeight: 700 }}> × {line.quantity}</span>
                  </div>
                  {line.dealSelections && line.dealSelections.length > 0 && (
                    <div style={{ paddingLeft: "10px", fontSize: "9pt" }}>
                      {line.dealSelections.map((n, i) => (
                        <div key={i}>↳ {n}</div>
                      ))}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                    paddingLeft: "6px",
                  }}
                >
                  {formatPKR(line.unitPrice * line.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {notes && notes.trim() && (
          <>
            <div style={{ margin: "6px 0", borderTop: "1px dashed #000" }} />
            <div style={{ fontSize: "10pt" }}>
              <span style={{ fontWeight: 700 }}>Instructions: </span>
              {notes.trim()}
            </div>
          </>
        )}

        <div style={{ margin: "6px 0", borderTop: "1px dashed #000" }} />

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10pt", marginBottom: "4px" }}>
          <span>Subtotal</span>
          <span>{formatPKR(subtotal)}</span>
        </div>
        {hasPizza && toppingAmount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10pt", marginBottom: "4px" }}>
            <span>Extra Topping</span>
            <span>{formatPKR(toppingAmount)}</span>
          </div>
        )}
        {isDelivery && deliveryAmount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10pt", marginBottom: "4px" }}>
            <span>Delivery Charges</span>
            <span>{formatPKR(deliveryAmount)}</span>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "13pt",
            fontWeight: 800,
          }}
        >
          <span>TOTAL</span>
          <span>{formatPKR(total)}</span>
        </div>

        <div style={{ margin: "6px 0", borderTop: "1px dashed #000" }} />

        <div style={{ textAlign: "center", fontSize: "10pt" }}>
          Thank you, visit again!
        </div>
        <div style={{ textAlign: "center", fontSize: "9pt", marginTop: "2px" }}>
          {restaurant.timing}
        </div>
      </div>
    );
  }

  return (
    // Single slip: the kitchen works off the live orders board now, so the old
    // second ("Restaurant Copy") print is no longer needed.
    <div id="receipt" className="hidden print:block">
      <ReceiptBody />
    </div>
  );
}

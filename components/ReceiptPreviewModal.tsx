"use client";

import { useState } from "react";
import type { Restaurant } from "@/lib/types";
import { formatPKR } from "@/lib/currency";

interface ReceiptItem {
  id: number;
  item_name: string;
  size: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
}

interface ReceiptOrder {
  order_number: string;
  order_type: string;
  /** "foodpanda" prints as Food Panda — see `orderLabel()`. */
  source?: string;
  subtotal: number;
  delivery_charge: number;
  extra_topping: number;
  total: number;
  notes: string | null;
  created_at: string;
  items: ReceiptItem[];
}

interface Props {
  order: ReceiptOrder;
  restaurant: Restaurant;
  onClose: () => void;
}

function fmtStamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date}  ${time}`;
}

const dashed = { margin: "6px 0", borderTop: "1px dashed #000" } as const;

/**
 * What the bill calls the order. A Food Panda order is a Takeaway underneath,
 * but printing "Takeaway" tells whoever reads the slip nothing about where it
 * came from. Used by both the shared image and the on-screen slip below.
 */
function orderLabel(order: ReceiptOrder): string {
  return order.source === "foodpanda" ? "Food Panda" : order.order_type;
}

// ── Slip → PNG image ─────────────────────────────────────────────────────────
// Renders the bill slip onto a canvas (mirrors <Receipt/> / the on-screen slip)
// so it can be shared as an image. No external dependency — drawn by hand on a
// 2× canvas for crisp thermal-receipt output.

const MONO = '"Courier New", "Courier", monospace';

function renderReceiptToBlob(order: ReceiptOrder, restaurant: Restaurant): Promise<Blob | null> {
  const scale = 2;
  const W = 384;
  const padX = 24;
  const padTop = 30;
  const padBottom = 34;
  const contentW = W - padX * 2;
  const paper = "#fffdf8";

  const font = (size: number, bold = false) => `${bold ? "bold " : ""}${size}px ${MONO}`;

  // Measurement context used for word-wrapping before we know the final height.
  const meas = document.createElement("canvas").getContext("2d")!;

  type Op =
    | { t: "text"; text: string; x: number; y: number; font: string; align: CanvasTextAlign }
    | { t: "rule"; y: number };
  const ops: Op[] = [];
  let y = padTop;

  const wrap = (text: string, f: string, maxW: number): string[] => {
    meas.font = f;
    const words = text.split(" ");
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (meas.measureText(test).width > maxW && cur) {
        out.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };

  const center = (text: string, size: number, bold = false) => {
    const f = font(size, bold);
    for (const ln of wrap(text, f, contentW)) {
      ops.push({ t: "text", text: ln, x: W / 2, y, font: f, align: "center" });
      y += size + 5;
    }
  };
  const left = (text: string, size: number, bold = false) => {
    const f = font(size, bold);
    for (const ln of wrap(text, f, contentW)) {
      ops.push({ t: "text", text: ln, x: padX, y, font: f, align: "left" });
      y += size + 5;
    }
  };
  const row = (l: string, r: string, size: number, bold = false) => {
    const f = font(size, bold);
    meas.font = f;
    const rW = meas.measureText(r).width;
    const lLines = wrap(l, f, contentW - rW - 12);
    lLines.forEach((ln, i) => {
      ops.push({ t: "text", text: ln, x: padX, y, font: f, align: "left" });
      if (i === 0) ops.push({ t: "text", text: r, x: W - padX, y, font: f, align: "right" });
      y += size + 5;
    });
  };
  const rule = () => {
    y += 6;
    ops.push({ t: "rule", y });
    y += 8;
  };

  // Header
  center(restaurant.name.toUpperCase(), 20, true);
  if (restaurant.address) center(restaurant.address, 12);
  if (restaurant.phone) center(restaurant.phone, 12);
  rule();

  // Meta
  row(`Bill #${order.order_number}`, fmtStamp(order.created_at), 12);
  left(`Order: ${orderLabel(order)}`, 12);
  rule();

  // Items
  order.items.forEach((i) => {
    const name = `${i.item_name}${i.size ? ` (${i.size})` : ""} x ${i.quantity}`;
    row(name, formatPKR(i.line_total), 13);
  });
  rule();

  // Notes
  if (order.notes && order.notes.trim()) {
    left(`Instructions: ${order.notes.trim()}`, 12);
    rule();
  }

  // Totals
  row("Subtotal", formatPKR(order.subtotal), 13);
  if (order.extra_topping > 0) row("Extra Topping", formatPKR(order.extra_topping), 13);
  if (order.delivery_charge > 0) row("Delivery Charges", formatPKR(order.delivery_charge), 13);
  row("TOTAL", formatPKR(order.total), 17, true);
  rule();

  center("Thank you, visit again!", 13);
  if (restaurant.timing) center(restaurant.timing, 12);

  const H = y + padBottom;

  // Real canvas
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "top";
  for (const op of ops) {
    if (op.t === "text") {
      ctx.fillStyle = "#141414";
      ctx.font = op.font;
      ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y);
    } else {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padX, op.y);
      ctx.lineTo(W - padX, op.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/**
 * A read-only "soft copy" of the printed bill slip, styled to look like a photo
 * of the thermal receipt (torn paper edges, warm paper tint, monospace print).
 * Mirrors the exact content of the printed slip in <Receipt/>. Can be shared as
 * an image (Web Share API) for customers who ask for a digital copy.
 */
export default function ReceiptPreviewModal({ order, restaurant, onClose }: Props) {
  const showTopping  = order.extra_topping > 0;
  const showDelivery = order.delivery_charge > 0;

  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState("");

  const shareSlip = async () => {
    setSharing(true);
    setShareNote("");
    try {
      const blob = await renderReceiptToBlob(order, restaurant);
      if (!blob) throw new Error("render-failed");
      const file = new File([blob], `bill-${order.order_number}.png`, { type: "image/png" });

      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data?: ShareData) => Promise<void>;
      };

      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: `Bill #${order.order_number}` });
      } else {
        // Desktop / unsupported: download the image so it can be attached
        // manually (e.g. dragged into WhatsApp Web).
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        setShareNote("Slip image downloaded — attach it in WhatsApp.");
      }
    } catch (e) {
      // User dismissing the native share sheet throws AbortError — ignore it.
      if ((e as Error)?.name !== "AbortError") {
        setShareNote("Could not share the slip. Please try again.");
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <div className="receipt-photo">
          <div className="receipt-paper w-[320px] max-w-[86vw] px-5 py-6 text-[13px] leading-snug">
            {/* Header */}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "1px" }}>
                {restaurant.name.toUpperCase()}
              </div>
              {restaurant.address && <div style={{ fontSize: "12px" }}>{restaurant.address}</div>}
              {restaurant.phone && <div style={{ fontSize: "12px" }}>{restaurant.phone}</div>}
            </div>

            <div style={dashed} />

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Bill #{order.order_number}</span>
              <span>{fmtStamp(order.created_at)}</span>
            </div>
            <div>Order: {orderLabel(order)}</div>

            <div style={dashed} />

            {/* Items */}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {order.items.map((line) => (
                  <tr key={line.id}>
                    <td style={{ verticalAlign: "top", paddingBottom: "2px" }}>
                      {line.item_name}
                      {line.size ? ` (${line.size})` : ""}
                      <span style={{ fontWeight: 700 }}> × {line.quantity}</span>
                    </td>
                    <td style={{ textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap", paddingLeft: "6px" }}>
                      {formatPKR(line.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Notes / instructions */}
            {order.notes && order.notes.trim() && (
              <>
                <div style={dashed} />
                <div>
                  <span style={{ fontWeight: 700 }}>Instructions: </span>
                  {order.notes.trim()}
                </div>
              </>
            )}

            <div style={dashed} />

            {/* Totals */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span>Subtotal</span>
              <span>{formatPKR(order.subtotal)}</span>
            </div>
            {showTopping && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span>Extra Topping</span>
                <span>{formatPKR(order.extra_topping)}</span>
              </div>
            )}
            {showDelivery && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span>Delivery Charges</span>
                <span>{formatPKR(order.delivery_charge)}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: 800 }}>
              <span>TOTAL</span>
              <span>{formatPKR(order.total)}</span>
            </div>

            <div style={dashed} />

            <div style={{ textAlign: "center" }}>Thank you, visit again!</div>
            {restaurant.timing && (
              <div style={{ textAlign: "center", fontSize: "12px", marginTop: "2px" }}>{restaurant.timing}</div>
            )}
          </div>
        </div>

        {/* Share slip as image */}
        <div className="mt-6 flex w-[320px] max-w-[86vw] flex-col items-center">
          <button
            type="button"
            onClick={shareSlip}
            disabled={sharing}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#1ebe5a] disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            {sharing ? "Preparing slip…" : "Share slip as image"}
          </button>
          {shareNote && <p className="mt-2 text-center text-xs text-white/90">{shareNote}</p>}
        </div>
      </div>
    </div>
  );
}

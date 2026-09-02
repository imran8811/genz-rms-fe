// Client-side costing types + preview math. Mirrors the backend CostingService
// so the editor can show a live cost/profit/margin while the user types. The
// server remains the source of truth on save.

export type ComponentType = "ingredient" | "sub_recipe" | "overhead";
export type SellSource = "menu" | "manual";

export interface Ingredient {
  id: number;
  name: string;
  supplier?: string | null;
  base_unit: string;
  unit_cost: number;
  pack_size?: number | null;
  pack_unit?: string | null;
  pack_price?: number | null;
}

export interface MenuOption {
  id: number;
  /** Stable identity shared with the genz-admin feed — match on this, not name. */
  slug: string | null;
  name: string;
  price_type: string;
  price: number | null;
  prices: Record<string, number | null> | null;
}

export interface EditableLine {
  _key: string; // local-only stable key
  id?: number;
  component_type: ComponentType;
  inventory_item_id: number | null;
  sub_recipe_id: number | null;
  overhead_key: string | null;
  label: string;
  qty: number | null;
  unit: string | null;
  flat_cost: number | null;
  waste_pct: number | null;
  // computed, server-authoritative when present
  unit_cost?: number | null;
  line_cost?: number | null;
  note?: string | null;
}

const FACTORS: Record<string, { base: string; factor: number }> = {
  kg: { base: "g", factor: 1000 },
  g: { base: "g", factor: 1 },
  l: { base: "ml", factor: 1000 },
  ltrs: { base: "ml", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  pc: { base: "pc", factor: 1 },
  pcs: { base: "pc", factor: 1 },
};

export function convert(qty: number, from: string | null, to: string | null): number | null {
  const f = (from ?? "").trim().toLowerCase();
  const t = (to ?? "").trim().toLowerCase();
  if (!f || !t || f === t) return qty;
  if (!FACTORS[f] || !FACTORS[t]) return qty;
  if (FACTORS[f].base !== FACTORS[t].base) return null;
  return (qty * FACTORS[f].factor) / FACTORS[t].factor;
}

/** A referenced recipe's cost, used to preview sub-recipe / component lines. */
export interface SubRecipeCost {
  unit_cost: number | null; // per yield unit; null for a whole product recipe
  yield_unit: string | null;
  total_cost?: number | null; // full-recipe cost, used when there's no yield
}

/** Preview cost of a single line using the ingredient catalogue. */
export function previewLineCost(
  line: EditableLine,
  ingredientsById: Map<number, Ingredient>,
  subRecipesById?: Map<number, SubRecipeCost>,
): number {
  if (line.component_type === "overhead") {
    return round2(line.flat_cost ?? 0);
  }
  if (line.component_type === "ingredient" && line.inventory_item_id) {
    const ing = ingredientsById.get(line.inventory_item_id);
    // Ingredient not in the loaded catalogue (e.g. an inactive inventory item
    // that the `/costing/ingredients` feed omits, or the feed hasn't loaded yet).
    // Fall back to the server-computed line cost so an existing recipe never
    // renders as Rs0 — we only lose live recompute for this one line.
    if (!ing) return round2(line.line_cost ?? 0);
    const converted = convert(line.qty ?? 0, line.unit, ing.base_unit);
    const qty = converted ?? line.qty ?? 0;
    const waste = 1 + (line.waste_pct ?? 0) / 100;
    return round2(ing.unit_cost * qty * waste);
  }
  if (line.component_type === "sub_recipe" && line.sub_recipe_id) {
    const sub = subRecipesById?.get(line.sub_recipe_id);
    if (!sub) return round2(line.line_cost ?? 0);
    const waste = 1 + (line.waste_pct ?? 0) / 100;
    // A whole finished recipe used as a component (e.g. a pizza in a deal) has no
    // per-yield-unit cost — cost the full recipe × the count.
    if (sub.unit_cost === null || sub.unit_cost === undefined) {
      if (sub.total_cost === null || sub.total_cost === undefined) {
        return round2(line.line_cost ?? 0);
      }
      const count = line.qty ?? 1;
      return round2(sub.total_cost * count * waste);
    }
    const converted = convert(line.qty ?? 0, line.unit, sub.yield_unit);
    const qty = converted ?? line.qty ?? 0;
    return round2(sub.unit_cost * qty * waste);
  }
  // Nothing selected yet — fall back to any server value.
  return round2(line.line_cost ?? 0);
}

export function previewTotals(
  lines: EditableLine[],
  ingredientsById: Map<number, Ingredient>,
  sellPrice: number | null,
  subRecipesById?: Map<number, SubRecipeCost>,
) {
  const total = round2(
    lines.reduce((s, l) => s + previewLineCost(l, ingredientsById, subRecipesById), 0),
  );
  const profit = sellPrice !== null ? round2(sellPrice - total) : null;
  const margin = sellPrice && sellPrice > 0 ? round1((profit! / sellPrice) * 100) : null;
  return { total, profit, margin };
}

/** Resolve a menu item's sell price for a given variant. */
export function menuSellPrice(menu: MenuOption | undefined, variant: string | null): number | null {
  if (!menu) return null;
  if (menu.price_type === "sized" && variant && menu.prices) {
    const p = menu.prices[variant];
    return p ?? null;
  }
  if (menu.price_type !== "sized" && menu.price !== null) return menu.price;
  return null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}

# Costing Module — Design Doc

**Status:** Proposed (design only — no code yet)
**Source:** `costing sheet.ods` (sheets: `cost`, `sauces`, `pizza`, `burger`, `pasta`, `wraps`, `paratha roll`)
**Author:** generated from sheet analysis, 2026-06-20

---

## 1. Goal

Turn the manual costing spreadsheet into a module of the RMS so that:

- Every menu item's **cost of goods (COGS)** is *computed* from current ingredient prices — never typed by hand.
- Changing one ingredient price re-prices every recipe that uses it.
- Each item shows **cost → sell price → profit → margin %**, and can suggest a price for a target margin.
- Supports **sizes/variants** (pizza S/M/L, pasta Half/Full) and **sub-recipes** (cheese blends, sauces).

This doc defines the **data model, formulas, API, and UI** before any code is written.

---

## 2. What the spreadsheet actually does (today)

A two-layer model:

| Layer | Sheet(s) | Meaning |
|---|---|---|
| 1. Ingredients | `cost` | Raw materials with a derived unit cost |
| 1.5 Sub-recipes | `sauces`, cheese blocks in `cost` | A recipe whose *output* is itself an ingredient |
| 2. Products | `pizza`, `burger`, `pasta`, `paratha roll`, `wraps` | Menu items = Σ(ingredient lines) + overheads → price & margin |

### Formulas

1. **Ingredient unit cost** = `pack price ÷ pack size`
   IRC Cheese 4438 ÷ 2500 g = **1.78/g**; Burger Bun 35 ÷ 1 pc = **35/pc**.
2. **Blended ingredient** = `Σ(component grams × component cost/g) ÷ Σ(grams)`
   Pizza cheese blend = **1.44/g**, regular = **1.24/g**.
3. **Sub-recipe (sauce)** = a product recipe whose total ÷ batch yield = a per-unit cost reused elsewhere
   Chipotle 2 kg batch total 3981 → **~1.99/g**.
4. **Recipe line cost** = `qty × component unit cost`.
5. **Overheads** = flat per-item lines: Gas, Electricity, Packaging (box, butter paper, food bag, tissue, tape).
6. **Rollup** = `Total = Σ lines` → `Profit = Sell − Total` → `Margin % = Profit ÷ Sell`.
   e.g. Gen Z Special Medium: cost 443, sold 800, profit 357 → **45%**.
7. **Variants** scale quantities by size: pizza S/M/L, pasta Half/Full.

### Problems we will NOT carry over

| Problem in sheet | Example | Fix in module |
|---|---|---|
| `#DIV/0!` (missing pack data) | Mozrella, Green Olive, Niblets | Required fields + validation |
| Hardcoded line cost ≠ qty×rate | Burger Chipotle: rate `0.00`, cost `40` | All line costs **derived**, never stored |
| Mixed units in one column | `Cost/gram` holds per-g *and* per-pc | Explicit `unit` per ingredient + conversion |
| Same ingredient, different rate | Pasta sauce 0.5/g vs 1.9/g | Single source of truth = the ingredient/sub-recipe |
| Duplicate mirrored blocks | Pizza table repeated to the right | One record per recipe |
| Incomplete sheets | `wraps` empty template; pizza `Small` blank | N/A — modelled cleanly |
| No labour / yield / waste | only flat gas+electricity | Optional yield % and overhead model |

---

## 3. Fit with the existing system

The backend (`genz-rms-apis`, Laravel) **already has the two anchor tables** — we extend, not duplicate:

- **`inventory_items`** = the ingredient master (`name`, `unit`, `cost_per_unit`, `category`, …). This *is* the `cost` sheet.
- **`menu_items`** = products with `price` / `prices` (size→price JSON). This is the "Sold" price.

So costing is the **bridge** between `inventory_items` (cost in) and `menu_items` (price out).

### ⚠ Blocker to resolve first: cost precision

`inventory_items.cost_per_unit` is **`unsignedInteger`** (whole numbers). The sheet needs fractional per-gram costs (1.78/g, 0.48/g). Options:

| Option | What | Trade-off |
|---|---|---|
| **A (recommended)** | Store **pack price + pack size**, derive `cost_per_base_unit` on read | Most faithful to the sheet; no rounding; one extra migration |
| B | Change `cost_per_unit` to `decimal(12,4)` | Simple, but loses the pack context the sheet has |
| C | Keep integer, store cost in **paisa per base unit** (×100) | No schema type change but error-prone, fragile |

**Recommendation: Option A** — add `pack_size`, `pack_unit`, `pack_price` to `inventory_items`; treat `cost_per_unit` as a derived/cached value. This matches how the sheet thinks (buy a 2500 g pack for 4438) and avoids rounding.

---

## 4. Proposed data model

Five concepts. New tables in **bold**; existing reused tables in _italics_.

```
_inventory_items_ ──< recipe_lines >── recipes ──(optional 1:1)── _menu_items_
       (ingredient)          │            │
                             └── (a line may point at a recipe = sub-recipe)
```

### 4.1 _inventory_items_ (extend)

Add pack-based costing (Option A):

| Column | Type | Note |
|---|---|---|
| `pack_size` | decimal(10,3) | e.g. 2500 |
| `pack_unit` | string(10) | `g` / `ml` / `pc` |
| `pack_price` | decimal(12,2) | e.g. 4438.00 |
| `base_unit` | string(10) | unit recipes consume in (`g`,`ml`,`pc`) |
| *(derived)* `cost_per_base_unit` | decimal(12,4) | `pack_price ÷ pack_size`, cached |

### 4.2 **recipes**

One per menu item **variant** (size). A pizza in S/M/L = 3 recipes, or 1 recipe with 3 variant columns — see §4.5.

| Column | Type | Note |
|---|---|---|
| `id` | id | |
| `name` | string | "Gen Z Special — Medium" |
| `kind` | enum | `product` \| `sub_recipe` (sauce/blend) |
| `menu_item_id` | FK nullable | links a `product` recipe to a menu item |
| `variant` | string nullable | "Medium", "Full" … |
| `yield_qty` | decimal nullable | sub-recipe batch yield (e.g. 2000) |
| `yield_unit` | string nullable | `g` for a sauce batch |
| `notes` | text nullable | |
| `is_active` | bool | |

### 4.3 **recipe_lines**

| Column | Type | Note |
|---|---|---|
| `id` | id | |
| `recipe_id` | FK → recipes | |
| `component_type` | enum | `ingredient` \| `sub_recipe` \| `overhead` |
| `inventory_item_id` | FK nullable | when `ingredient` |
| `sub_recipe_id` | FK nullable | when `sub_recipe` (→ recipes.id, kind=sub_recipe) |
| `overhead_key` | string nullable | when `overhead`: `gas`,`electricity`,`labour` |
| `label` | string | display name |
| `qty` | decimal(10,3) | |
| `unit` | string(10) | must be convertible to component's base unit |
| `waste_pct` | decimal(5,2) default 0 | optional yield loss |

**Line cost is always derived, never stored** (see §5).

### 4.4 Overheads

Flat per-item costs (gas, electricity, optional labour). Store defaults in the existing `settings` table (`costing.overhead.gas = 10`, etc.) so they're editable in one place and referenced by `overhead_key`.

### 4.5 Variants — decision needed

Two valid shapes (pick in review):

- **(a) One recipe per variant** — simplest, mirrors the model 1:1, some duplication across sizes.
- **(b) One recipe + per-variant quantities** (`recipe_line_variants` table) — DRY, but more complex UI.

**Recommendation: start with (a)**; revisit if size duplication becomes painful.

---

## 5. The costing engine (pure functions)

All computed; nothing persisted except cached `cost_per_base_unit`.

```
ingredientUnitCost(item)      = item.pack_price / item.pack_size           // → cost per pack_unit
subRecipeUnitCost(recipe)     = recipeTotalCost(recipe) / recipe.yield_qty  // → cost per yield_unit

lineCost(line):
  base = component unit cost (ingredient | sub_recipe | overhead flat)
  qty  = convert(line.qty, line.unit -> component.base_unit)
  return base * qty * (1 + line.waste_pct/100)

recipeTotalCost(recipe)       = Σ lineCost(line)
profit(recipe)                = sellPrice(recipe) - recipeTotalCost(recipe)
marginPct(recipe)             = profit / sellPrice * 100
suggestedPrice(recipe, m%)    = recipeTotalCost(recipe) / (1 - m%/100)
```

- `sellPrice(recipe)` = `menu_items.prices[variant]` (or `.price`).
- **Unit conversion** is a small table: `kg↔g`, `l↔ml`, `pc` is atomic. Reject incompatible units at save time.
- **Sub-recipe recursion** must be **acyclic** — validate no cycles when saving a line.

---

## 6. API (Laravel, REST — matches existing `lib/api.ts`)

```
GET    /api/inventory-items                 # already exists (extend payload w/ pack_* + derived cost)
GET    /api/recipes?kind=product|sub_recipe
POST   /api/recipes
GET    /api/recipes/{id}                     # includes lines + computed costing block
PUT    /api/recipes/{id}
DELETE /api/recipes/{id}
POST   /api/recipes/{id}/lines
PUT    /api/recipe-lines/{id}
DELETE /api/recipe-lines/{id}
GET    /api/costing/summary                  # all products: cost, price, margin% (table view)
```

`GET /api/recipes/{id}` response (costing block computed server-side so FE never recomputes prices):

```json
{
  "id": 12, "name": "Gen Z Special — Medium", "kind": "product",
  "menu_item_id": 5, "variant": "Medium",
  "lines": [
    { "id": 1, "label": "Dough", "component_type": "ingredient",
      "inventory_item_id": 7, "qty": 300, "unit": "g",
      "unit_cost": 0.1233, "line_cost": 37.0 }
  ],
  "costing": { "total_cost": 443.0, "sell_price": 800, "profit": 357.0, "margin_pct": 44.6 }
}
```

---

## 7. Frontend (Next.js App Router — matches existing modules)

New route following the `app/(rms)/<module>/page.tsx` pattern (like `inventory/page.tsx`): `"use client"`, `@/lib/api`, local TS interfaces, `Rs` formatting, modal-based editing, `Sidebar` entry.

```
app/(rms)/costing/
  page.tsx                # summary table: item | size | cost | price | margin% (color-coded)
  [recipeId]/page.tsx     # recipe editor: line items, live total, profit, margin
components/
  RecipeLineRow.tsx
  MarginBadge.tsx         # green / yellow / red by margin band
lib/
  costing.ts             # TS types + client-side fallback formulas (mirror §5)
```

Margin colour bands (proposed, tune later): ≥50% green, 30–49% yellow, <30% red.

---

## 8. Migration / seeding

1. Migration: add `pack_size`, `pack_unit`, `pack_price`, `base_unit` to `inventory_items`; backfill from current `cost_per_unit` where possible.
2. Migrations: `create_recipes_table`, `create_recipe_lines_table`.
3. Seeder: import the `cost` sheet rows → `inventory_items`; import each product sheet → `recipes` + `recipe_lines`. Flag the known bad rows (§2) for manual review rather than importing wrong numbers.

---

## 9. Open decisions (for review)

1. **Cost precision** — confirm **Option A** (pack-based) vs B/C (§3).
2. **Variants** — **(a)** recipe-per-variant vs **(b)** per-variant quantities (§4.5).
3. **Scope of v1** — COGS only (like the sheet), or include **labour** + **target-margin pricing** now?
4. **Overhead source** — flat values in `settings`, or per-recipe override allowed?
5. **Where prices live** — keep using `menu_items.prices`, or a dedicated pricing table?

---

## 10. Suggested build order (once design approved)

1. Resolve §9.1 + §9.2.
2. Backend: extend `inventory_items`, add `recipes` + `recipe_lines`, costing service, endpoints.
3. Seed from the `.ods`.
4. Frontend: summary table → recipe editor.
5. Reconciliation report: computed totals vs sheet's hardcoded totals (catch the §2 drifts).
```

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { RequireAdmin } from "@/lib/auth";
import { useMenu } from "@/lib/menuStore";
import type { MenuCategory, MenuItem } from "@/lib/types";
import IngredientsPanel from "@/components/IngredientsPanel";
import {
  type EditableLine,
  type Ingredient,
  type MenuOption,
  menuSellPrice,
  previewLineCost,
  previewTotals,
} from "@/lib/costing";

interface CostingRow {
  id: number;
  kind: "product" | "sub_recipe";
  name: string;
  category: string | null;
  variant: string | null;
  menu_item_id: number | null;
  menu_item_slug: string | null;
  yield_qty: number | null;
  yield_unit: string | null;
  unit_cost: number | null;
  total_cost: number;
  sell_price: number | null;
  sell_source: "menu" | "manual";
  profit: number | null;
  margin_pct: number | null;
  has_issues: boolean;
}

interface CostingBlock {
  total_cost: number;
  sell_price: number | null;
  sell_source: "menu" | "manual";
  profit: number | null;
  margin_pct: number | null;
  markup_pct: number | null;
}

type DetailLine = EditableLine & {
  id: number;
  unit_cost: number | null;
  line_cost: number | null;
  note: string | null;
  /** Resolved from the FK — what this line actually costs, whatever `label` says. */
  component_name: string | null;
};

interface RecipeDetail {
  id: number;
  kind: "product" | "sub_recipe";
  name: string;
  category: string | null;
  menu_item_id: number | null;
  menu_item_name: string | null;
  variant: string | null;
  sell_price: number | null;
  yield_qty: number | null;
  yield_unit: string | null;
  lines: DetailLine[];
  costing: CostingBlock;
}

interface EditableRecipe {
  id: number | null;
  kind: "product" | "sub_recipe";
  name: string;
  category: string;
  variant: string;
  menu_item_id: number | null;
  sell_price: number | null;
  yield_qty: number | null;
  yield_unit: string;
  lines: EditableLine[];
}

/** A card in the category grid: a menu item (with any matched recipes) or an
 *  orphan recipe that couldn't be linked back to a menu item. */
type GridCard =
  | { kind: "item"; item: MenuItem; recipes: CostingRow[] }
  | { kind: "orphan"; recipe: CostingRow };

const titleCase = (s: string): string => s.replace(/\b\w/g, (m) => m.toUpperCase());

/** The label a component auto-fills into a line. */
const autoLabel = (c?: { name: string; variant?: string | null } | null): string =>
  c ? c.name + (c.variant ? ` — ${c.variant}` : "") : "";

/**
 * Label to keep when a line is re-pointed at a different component.
 *
 * A label that still matches the component it was auto-filled from was never
 * customised, so it follows the new selection. Anything the user actually typed
 * is theirs and survives. Without this a swapped line keeps naming the old
 * component while costing the new one.
 */
const keepLabel = (current: string, previousAuto: string, nextAuto: string): string =>
  !current || current === previousAuto ? nextAuto : current;
const sameCat = (a: string | null, b: string | null): boolean =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

const UNITS = ["g", "kg", "ml", "l", "pc"];

// Pizzas (and pizza deals) are always costed per these sizes, regardless of how
// the menu feed prices them.
const PIZZA_SIZES = ["Small", "Medium", "Large"];

// Product families a deal can be built from. A deal recipe whose category names
// a family — "Pizza Deals", "Burger Deals", "Beef Burger Deals" — can pull that
// family's finished recipes in as lines, costed as whole recipes × count.
// "Pizza + Burger Deals" names both, so its picker offers both.
const DEAL_FAMILIES = [
  { key: "pizza", label: "Pizza" },
  { key: "burger", label: "Burger" },
];

const VIEW_LABELS: Record<"recipes" | "misc" | "ingredients", string> = {
  recipes: "Recipes",
  misc: "Sub-recipes",
  ingredients: "Ingredients",
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "Rs" + n.toLocaleString("en-PK", { maximumFractionDigits: 1 });
}

function marginStyle(m: number | null): string {
  if (m === null) return "bg-gray-100 text-gray-500";
  if (m >= 50) return "bg-green-100 text-green-700";
  if (m >= 30) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

let keyCounter = 0;
const newKey = () => `l${++keyCounter}`;

function blankLine(type: EditableLine["component_type"]): EditableLine {
  return {
    _key: newKey(),
    component_type: type,
    inventory_item_id: null,
    sub_recipe_id: null,
    overhead_key: type === "overhead" ? "" : null,
    label: "",
    qty: type === "overhead" ? null : 0,
    unit: type === "overhead" ? null : "g",
    flat_cost: type === "overhead" ? 0 : null,
    waste_pct: 0,
  };
}

export default function CostingPage() {
  return (
    <RequireAdmin>
      <CostingContent />
    </RequireAdmin>
  );
}

function CostingContent() {
  const menu = useMenu();
  const [rows, setRows] = useState<CostingRow[]>([]);
  const [miscRows, setMiscRows] = useState<CostingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [menuOptions, setMenuOptions] = useState<MenuOption[]>([]);

  const [view, setView] = useState<"recipes" | "misc" | "ingredients">("recipes");

  const [editing, setEditing] = useState<EditableRecipe | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Read-only ingredient breakdown for a clicked card.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RecipeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const ingredientsById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  );

  // Recipes a product/sub-recipe can pull in as a line — sub-recipes (dough,
  // sauces) priced per yield unit, and whole product recipes (a pizza inside a
  // deal) costed as a full recipe. Keyed by id for live cost preview.
  const subRecipesById = useMemo(
    () =>
      new Map(
        [...miscRows, ...rows].map((r) => [
          r.id,
          { unit_cost: r.unit_cost, yield_unit: r.yield_unit, total_cost: r.total_cost },
        ]),
      ),
    [miscRows, rows],
  );

  // Products (menu recipes) feed the Recipes tab; sub-recipes feed the Misc tab.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [products, subs] = await Promise.all([
        api.get<CostingRow[]>("/costing/summary?kind=product"),
        api.get<CostingRow[]>("/costing/summary?kind=sub_recipe"),
      ]);
      setRows(products);
      setMiscRows(subs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load costing");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIngredients = useCallback(() => {
    api
      .get<Ingredient[]>("/costing/ingredients")
      .then(setIngredients)
      .catch((e) => console.warn("Could not load ingredient catalogue:", e));
  }, []);

  useEffect(() => {
    load();
    loadIngredients();
    api.get<MenuOption[]>("/costing/menu-options").then(setMenuOptions).catch(() => {});
  }, [load, loadIngredients]);

  const openEdit = useCallback(async (id: number) => {
    setEditLoading(true);
    setEditing({
      id,
      kind: "product",
      name: "",
      category: "",
      variant: "",
      menu_item_id: null,
      sell_price: null,
      yield_qty: null,
      yield_unit: "g",
      lines: [],
    });
    try {
      const d = await api.get<RecipeDetail>(`/recipes/${id}`);
      setEditing({
        id: d.id,
        kind: d.kind,
        name: d.name,
        category: d.category ?? "",
        variant: d.variant ?? "",
        menu_item_id: d.menu_item_id,
        sell_price: d.sell_price,
        yield_qty: d.yield_qty,
        yield_unit: d.yield_unit ?? "g",
        lines: d.lines.map((l) => ({ ...l, _key: newKey() })),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recipe");
      setEditing(null);
    } finally {
      setEditLoading(false);
    }
  }, []);

  const openNew = useCallback((prefill?: Partial<EditableRecipe>) => {
    setEditing({
      id: null,
      kind: "product",
      name: "",
      category: "",
      variant: "",
      menu_item_id: null,
      sell_price: null,
      yield_qty: null,
      yield_unit: "g",
      lines: [],
      ...prefill,
    });
  }, []);

  /**
   * Start a new recipe pre-linked to a menu item that has no recipe yet.
   *
   * Match on slug, never name. The grid is drawn from the live genz-admin feed
   * while these options come from the RMS's synced mirror; deal names ("Deal 10")
   * get renumbered between menu revisions, so a name match can silently pin the
   * recipe to a different item than the card it was started from.
   */
  const addRecipeForItem = useCallback(
    (item: MenuItem, categoryName: string) => {
      const linked = menuOptions.find((m) => m.slug === item.id);
      openNew({
        name: item.name,
        category: categoryName.toLowerCase(),
        menu_item_id: linked?.id ?? null,
      });
    },
    [menuOptions, openNew],
  );

  /** Start a new misc/prep sub-recipe (dough, sauces, cheese, …). */
  const openNewMisc = useCallback(() => {
    openNew({ kind: "sub_recipe", category: "misc", yield_qty: 1000, yield_unit: "g" });
  }, [openNew]);

  const closeEdit = useCallback(() => {
    setEditing(null);
    setEditLoading(false);
  }, []);

  const openDetail = useCallback(async (id: number) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await api.get<RecipeDetail>(`/recipes/${id}`);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recipe");
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
    setDetail(null);
    setDetailLoading(false);
  }, []);

  const editFromDetail = useCallback(
    (id: number) => {
      closeDetail();
      openEdit(id);
    },
    [closeDetail, openEdit],
  );

  const linkedMenu = useMemo(
    () => menuOptions.find((m) => m.id === editing?.menu_item_id),
    [menuOptions, editing?.menu_item_id],
  );
  const menuPrice = useMemo(
    () => (editing ? menuSellPrice(linkedMenu, editing.variant || null) : null),
    [linkedMenu, editing],
  );
  const effectiveSell = menuPrice ?? editing?.sell_price ?? null;

  // Sizes offered in the variant picker: the linked menu item's own sizes (keys
  // of its price map), falling back to the menu category's declared sizes.
  const variantOptions = useMemo<string[]>(() => {
    if (!editing || editing.kind === "sub_recipe") return [];
    // Pizzas and pizza deals are always costed per Small / Medium / Large.
    if (editing.category.trim().toLowerCase().includes("pizza")) {
      return PIZZA_SIZES;
    }
    if (linkedMenu?.price_type === "sized" && linkedMenu.prices) {
      return Object.keys(linkedMenu.prices);
    }
    const cat = menu?.categories.find(
      (c) => c.name.trim().toLowerCase() === editing.category.trim().toLowerCase(),
    );
    return cat?.type === "sized" ? cat.sizes ?? [] : [];
  }, [editing, linkedMenu, menu]);

  const totals = useMemo(
    () =>
      editing
        ? previewTotals(editing.lines, ingredientsById, effectiveSell, subRecipesById)
        : null,
    [editing, ingredientsById, effectiveSell, subRecipesById],
  );

  // Sub-recipes a product/sub-recipe can reference — a recipe can't include itself.
  const subRecipeOptions = useMemo(
    () => miscRows.filter((r) => r.id !== editing?.id),
    [miscRows, editing?.id],
  );

  // Which families this recipe is a deal for — "Deal 3" → pizza, "Beef Burger
  // Deals" → burger, "Pizza + Burger Deals" → both. Empty for non-deals.
  const dealFamilies = useMemo(() => {
    if (!editing || editing.kind !== "product") return [];
    const cat = editing.category.toLowerCase();
    if (!cat.includes("deal")) return [];

    return DEAL_FAMILIES.filter((f) => cat.includes(f.key));
  }, [editing?.kind, editing?.category]);

  // The finished product recipes (their per-size variants) a deal can be
  // composed of — everything in those families that isn't itself a deal.
  const dealComponentOptions = useMemo(() => {
    if (dealFamilies.length === 0) return [];

    return rows.filter((r) => {
      const cat = (r.category ?? "").toLowerCase();
      return (
        r.id !== editing?.id &&
        !cat.includes("deal") &&
        dealFamilies.some((f) => cat.includes(f.key))
      );
    });
  }, [rows, editing?.id, dealFamilies]);

  // What the component picker lists for the recipe being edited.
  const componentOptions = [...dealComponentOptions, ...subRecipeOptions];

  // One button adds one component line; the picker decides what goes in it. The
  // label has to name everything that picker offers, or a deal looks like it
  // can't take sub-recipes — "+ Burger / Sub-recipe", "+ Sub-recipe" off a deal.
  const addComponentLabel =
    "+ " + [...dealFamilies.map((f) => f.label), "Sub-recipe"].join(" / ");

  const patch = (p: Partial<EditableRecipe>) => setEditing((e) => (e ? { ...e, ...p } : e));
  const patchLine = (key: string, p: Partial<EditableLine>) =>
    setEditing((e) =>
      e ? { ...e, lines: e.lines.map((l) => (l._key === key ? { ...l, ...p } : l)) } : e,
    );
  const removeLine = (key: string) =>
    setEditing((e) => (e ? { ...e, lines: e.lines.filter((l) => l._key !== key) } : e));
  const addLine = (type: EditableLine["component_type"]) =>
    setEditing((e) => (e ? { ...e, lines: [...e.lines, blankLine(type)] } : e));

  const save = useCallback(async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError("Recipe name is required");
      return;
    }
    setSaving(true);
    setError(null);
    const isSub = editing.kind === "sub_recipe";
    const payload = {
      kind: editing.kind,
      name: editing.name.trim(),
      category: editing.category.trim() || null,
      variant: isSub ? null : editing.variant.trim() || null,
      menu_item_id: isSub ? null : editing.menu_item_id,
      sell_price: isSub ? null : editing.sell_price,
      yield_qty: isSub ? Number(editing.yield_qty) || null : null,
      yield_unit: isSub ? editing.yield_unit : null,
      lines: editing.lines.map((l) => ({
        component_type: l.component_type,
        inventory_item_id: l.component_type === "ingredient" ? l.inventory_item_id : null,
        sub_recipe_id: l.component_type === "sub_recipe" ? l.sub_recipe_id : null,
        overhead_key: l.component_type === "overhead" ? l.overhead_key || l.label : null,
        label: l.label || ingredientsById.get(l.inventory_item_id ?? -1)?.name || "Item",
        qty: l.component_type === "overhead" ? null : Number(l.qty) || 0,
        unit: l.component_type === "overhead" ? null : l.unit,
        flat_cost: l.component_type === "overhead" ? Number(l.flat_cost) || 0 : null,
        waste_pct: Number(l.waste_pct) || 0,
      })),
    };
    try {
      if (editing.id) {
        await api.put(`/recipes/${editing.id}`, payload);
      } else {
        await api.post("/recipes", payload);
      }
      closeEdit();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save recipe");
    } finally {
      setSaving(false);
    }
  }, [editing, ingredientsById, closeEdit, load]);

  const remove = useCallback(async () => {
    if (!editing?.id) return;
    if (!confirm(`Delete "${editing.name}"?`)) return;
    setSaving(true);
    try {
      await api.delete(`/recipes/${editing.id}`);
      closeEdit();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  }, [editing, closeEdit, load]);

  // ---- Menu-driven grid model -------------------------------------------
  // The layout is driven by the full menu (all categories + items), with recipe
  // costing overlaid onto the items it belongs to.
  const menuCategories = useMemo(() => menu?.categories ?? [], [menu]);
  const menuLoading = menu === null;

  // Recipes grouped by the menu item they cost (matched by slug).
  const rowsBySlug = useMemo(() => {
    const m = new Map<string, CostingRow[]>();
    rows.forEach((r) => {
      if (!r.menu_item_slug) return;
      const arr = m.get(r.menu_item_slug) ?? [];
      arr.push(r);
      m.set(r.menu_item_slug, arr);
    });
    return m;
  }, [rows]);

  const menuSlugs = useMemo(() => {
    const s = new Set<string>();
    menuCategories.forEach((c) => c.items.forEach((i) => s.add(i.id)));
    return s;
  }, [menuCategories]);

  // Recipes whose menu link can't be resolved in the current menu — shown as
  // standalone cards so no recipe is ever hidden.
  const orphanRows = useMemo(
    () => rows.filter((r) => !r.menu_item_slug || !menuSlugs.has(r.menu_item_slug)),
    [rows, menuSlugs],
  );

  // Sidebar categories: every menu category, plus any recipe-only category.
  const categories = useMemo(() => {
    const list: { name: string; comingSoon: boolean }[] = [];
    const seen = new Set<string>();
    menuCategories.forEach((c) => {
      seen.add(c.name.toLowerCase());
      list.push({ name: c.name, comingSoon: !!c.comingSoon });
    });
    orphanRows.forEach((r) => {
      const label = titleCase(r.category ?? "Uncategorized");
      if (!seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        list.push({ name: label, comingSoon: false });
      }
    });
    return list;
  }, [menuCategories, orphanRows]);

  // Default the rail to the first category once data arrives (or if the current
  // selection no longer exists).
  useEffect(() => {
    if (categories.length === 0) return;
    if (activeCategory === null || !categories.some((c) => c.name === activeCategory)) {
      setActiveCategory(categories[0].name);
    }
  }, [categories, activeCategory]);

  // Cards for the selected category: one per menu item (with any matched
  // recipes), followed by orphan recipes that belong to this category.
  const cards = useMemo<GridCard[]>(() => {
    const out: GridCard[] = [];
    const menuCat = menuCategories.find((c) => c.name === activeCategory);
    if (menuCat) {
      menuCat.items.forEach((item) =>
        out.push({ kind: "item", item, recipes: rowsBySlug.get(item.id) ?? [] }),
      );
    }
    orphanRows
      .filter((r) => sameCat(r.category, activeCategory))
      .forEach((r) => out.push({ kind: "orphan", recipe: r }));
    return out;
  }, [menuCategories, activeCategory, rowsBySlug, orphanRows]);

  const cardCountByCat = useMemo(() => {
    const m = new Map<string, number>();
    categories.forEach((c) => m.set(c.name, 0));
    menuCategories.forEach((c) => m.set(c.name, (m.get(c.name) ?? 0) + c.items.length));
    orphanRows.forEach((r) => {
      const label =
        categories.find((c) => sameCat(r.category, c.name))?.name ??
        titleCase(r.category ?? "Uncategorized");
      m.set(label, (m.get(label) ?? 0) + 1);
    });
    return m;
  }, [categories, menuCategories, orphanRows]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 pt-5">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Costing</h1>
            <p className="text-sm text-gray-500">
              Cost, profit &amp; margin per menu item — computed live from ingredient prices.
            </p>
          </div>
          {view === "recipes" && (
            <button
              onClick={() => openNew()}
              className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              + New recipe
            </button>
          )}
          {view === "misc" && (
            <button
              onClick={openNewMisc}
              className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              + New sub-recipe
            </button>
          )}
        </div>

        {/* View tabs */}
        <div className="flex gap-1">
          {(["recipes", "misc", "ingredients"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                view === v
                  ? "border-brand-red text-brand-red"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {view === "ingredients" ? (
        <div className="flex-1 overflow-y-auto p-6">
          <IngredientsPanel />
        </div>
      ) : view === "misc" ? (
        <section className="flex-1 overflow-y-auto bg-gray-50 p-5">
          {error && !editing && detailId === null && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <p className="mb-4 text-sm text-gray-500">
            Prep / sub-recipes used inside menu items — dough, sauces, cheese blends, etc. Each has a
            batch yield, so its per-unit cost feeds the recipes that use it.
          </p>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-32 rounded-xl border border-gray-200 bg-white animate-pulse" />
              ))}
            </div>
          ) : miscRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
              No sub-recipes yet. Click “New sub-recipe” to add one.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {miscRows.map((r) => (
                <MiscCard key={r.id} row={r} onClick={() => openDetail(r.id)} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Category rail — all menu categories */}
          <nav className="w-48 shrink-0 overflow-y-auto border-r border-gray-200 bg-white py-2">
            {menuLoading && categories.length === 0 ? (
              <div className="space-y-1 px-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-11 rounded-lg bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : categories.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-400">No menu categories.</p>
            ) : (
              <ul className="space-y-1 px-2">
                {categories.map((c) => {
                  const isActive = c.name === activeCategory;
                  return (
                    <li key={c.name}>
                      <button
                        onClick={() => setActiveCategory(c.name)}
                        className={[
                          "flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm font-medium capitalize transition min-h-[44px]",
                          isActive
                            ? "bg-brand-red text-white shadow-soft"
                            : "text-gray-700 hover:bg-gray-100 active:bg-gray-200",
                        ].join(" ")}
                      >
                        <span className="leading-tight">{c.name}</span>
                        <span
                          className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {cardCountByCat.get(c.name) ?? 0}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>

          {/* Cards — all items in the selected category */}
          <section className="flex-1 overflow-y-auto bg-gray-50 p-5">
            {error && !editing && detailId === null && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading || menuLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-36 rounded-xl border border-gray-200 bg-white animate-pulse" />
                ))}
              </div>
            ) : cards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
                No menu items in this category.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map((card) =>
                  card.kind === "item" ? (
                    <MenuItemCard
                      key={`item-${card.item.id}`}
                      item={card.item}
                      recipes={card.recipes}
                      onOpenRecipe={openDetail}
                      onAddRecipe={() => addRecipeForItem(card.item, activeCategory ?? "")}
                    />
                  ) : (
                    <RecipeCard
                      key={`recipe-${card.recipe.id}`}
                      row={card.recipe}
                      orphan
                      onClick={() => openDetail(card.recipe.id)}
                    />
                  ),
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Read-only ingredient breakdown */}
      {detailId !== null && (
        <DetailPanel
          detail={detail}
          loading={detailLoading}
          onClose={closeDetail}
          onEdit={editFromDetail}
        />
      )}

      {editing && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={closeEdit} />
          <div className="relative w-full max-w-lg h-full bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-gray-900">
                {editing.kind === "sub_recipe"
                  ? editing.id
                    ? "Edit item"
                    : "New item"
                  : editing.id
                    ? "Edit recipe"
                    : "New recipe"}
              </h2>
              <button onClick={closeEdit} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
                ×
              </button>
            </div>

            {editLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-5 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="p-6 space-y-5">
                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}

                {/* Header fields */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name" className="col-span-2">
                    <input
                      value={editing.name}
                      onChange={(e) => patch({ name: e.target.value })}
                      className="input"
                      placeholder="Gen Z Special — Medium"
                    />
                  </Field>
                  <Field label="Category">
                    <input
                      value={editing.category}
                      onChange={(e) => patch({ category: e.target.value })}
                      className="input"
                      placeholder={editing.kind === "sub_recipe" ? "misc" : "pizza"}
                    />
                  </Field>
                  {editing.kind !== "sub_recipe" && (
                    <Field label="Variant / size">
                      {variantOptions.length > 0 ? (
                        <select
                          value={editing.variant}
                          onChange={(e) => patch({ variant: e.target.value })}
                          className="input"
                        >
                          <option value="">— None —</option>
                          {editing.variant && !variantOptions.includes(editing.variant) && (
                            <option value={editing.variant}>{editing.variant}</option>
                          )}
                          {variantOptions.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={editing.variant}
                          onChange={(e) => patch({ variant: e.target.value })}
                          className="input"
                          placeholder="Medium"
                        />
                      )}
                    </Field>
                  )}
                </div>

                {editing.kind === "sub_recipe" ? (
                  /* Batch yield — per-unit cost = total cost ÷ yield */
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Batch yield">
                        <input
                          type="number"
                          value={editing.yield_qty ?? ""}
                          onChange={(e) =>
                            patch({ yield_qty: e.target.value ? Number(e.target.value) : null })
                          }
                          className="input"
                          placeholder="1000"
                        />
                      </Field>
                      <Field label="Yield unit">
                        <select
                          value={editing.yield_unit}
                          onChange={(e) => patch({ yield_unit: e.target.value })}
                          className="input"
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      A batch of this item yields{" "}
                      <b>
                        {editing.yield_qty ?? "—"} {editing.yield_unit}
                      </b>
                      . Its per-unit cost is used wherever this item is a sub-recipe.
                    </p>
                  </div>
                ) : (
                  /* Sell price / menu link */
                  <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                    <Field label="Linked menu item (live sell price)">
                      <select
                        value={editing.menu_item_id ?? ""}
                        onChange={(e) =>
                          patch({ menu_item_id: e.target.value ? Number(e.target.value) : null })
                        }
                        className="input"
                      >
                        <option value="">— Not linked (manual price) —</option>
                        {menuOptions.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {menuPrice !== null ? (
                      <p className="text-xs text-gray-500">
                        Sell price from menu: <b>{fmt(menuPrice)}</b>
                        {editing.variant ? ` (${editing.variant})` : ""}
                      </p>
                    ) : (
                      <Field label="Manual sell price">
                        <input
                          type="number"
                          value={editing.sell_price ?? ""}
                          onChange={(e) =>
                            patch({ sell_price: e.target.value ? Number(e.target.value) : null })
                          }
                          className="input"
                          placeholder="800"
                        />
                      </Field>
                    )}
                    {editing.menu_item_id && menuPrice === null && (
                      <p className="text-xs text-amber-600">
                        Linked menu item has no price for “{editing.variant || "—"}”. Using manual price.
                      </p>
                    )}
                  </div>
                )}

                {/* Lines */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Ingredients, sub-recipes & overheads
                    </h3>
                    <div className="flex gap-2">
                      <button onClick={() => addLine("ingredient")} className="btn-sm">
                        + Ingredient
                      </button>
                      <button onClick={() => addLine("sub_recipe")} className="btn-sm">
                        {addComponentLabel}
                      </button>
                      <button onClick={() => addLine("overhead")} className="btn-sm">
                        + Overhead
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {editing.lines.length === 0 && (
                      <p className="text-sm text-gray-400 py-3 text-center">No lines yet.</p>
                    )}
                    {editing.lines.map((l) => (
                      <LineEditor
                        key={l._key}
                        line={l}
                        ingredients={ingredients}
                        subRecipes={componentOptions}
                        lineCost={previewLineCost(l, ingredientsById, subRecipesById)}
                        onChange={(p) => patchLine(l._key, p)}
                        onRemove={() => removeLine(l._key)}
                      />
                    ))}
                  </div>
                </div>

                {/* Live totals */}
                {totals && editing.kind === "sub_recipe" ? (
                  <div className="rounded-lg bg-gray-50 p-4 space-y-1.5 text-sm">
                    <SumRow label="Batch cost" value={fmt(totals.total)} />
                    <SumRow
                      label="Yield"
                      value={
                        editing.yield_qty ? `${editing.yield_qty} ${editing.yield_unit}` : "—"
                      }
                    />
                    <SumRow
                      label={`Cost per ${editing.yield_unit}`}
                      value={
                        editing.yield_qty && editing.yield_qty > 0
                          ? "Rs" +
                            (totals.total / editing.yield_qty).toLocaleString("en-PK", {
                              maximumFractionDigits: 2,
                            })
                          : "—"
                      }
                      valueClass="text-gray-900 font-semibold"
                    />
                  </div>
                ) : (
                  totals && (
                    <div className="rounded-lg bg-gray-50 p-4 space-y-1.5 text-sm">
                      <SumRow label="Total cost" value={fmt(totals.total)} />
                      <SumRow label="Sell price" value={fmt(effectiveSell)} />
                      <SumRow
                        label="Profit"
                        value={fmt(totals.profit)}
                        valueClass="text-green-700 font-semibold"
                      />
                      <SumRow
                        label="Margin"
                        value={totals.margin === null ? "—" : totals.margin.toFixed(1) + "%"}
                      />
                    </div>
                  )
                )}

                {/* Actions */}
                <div className="flex items-center justify-between pt-2">
                  {editing.id ? (
                    <button
                      onClick={remove}
                      disabled={saving}
                      className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <button onClick={closeEdit} className="btn-secondary" disabled={saving}>
                      Cancel
                    </button>
                    <button onClick={save} className="btn-primary" disabled={saving}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 0.5rem 0.625rem;
          font-size: 0.875rem;
        }
        :global(.input:focus) {
          outline: none;
          border-color: #e53935;
        }
        :global(.btn-sm) {
          font-size: 0.75rem;
          font-weight: 600;
          color: #e53935;
          padding: 0.25rem 0.5rem;
          border-radius: 0.375rem;
          border: 1px solid #fecaca;
        }
        :global(.btn-primary) {
          background: #e53935;
          color: white;
          font-weight: 600;
          font-size: 0.875rem;
          padding: 0.5rem 1.25rem;
          border-radius: 0.5rem;
        }
        :global(.btn-secondary) {
          background: #f3f4f6;
          color: #374151;
          font-weight: 500;
          font-size: 0.875rem;
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
        }
      `}</style>
    </div>
  );
}

/** The 2×2 cost/sell/profit/margin block shared by recipe & item cards. */
function CostStats({ row }: { row: CostingRow }) {
  return (
    <div className="grid grid-cols-2 gap-y-2 text-xs">
      <div>
        <div className="text-gray-400">Cost</div>
        <div className="font-semibold tabular-nums text-gray-800">{fmt(row.total_cost)}</div>
      </div>
      <div>
        <div className="text-gray-400">Sell</div>
        <div className="font-semibold tabular-nums text-gray-800">
          {fmt(row.sell_price)}
          {row.sell_source === "menu" && (
            <span className="ml-1 text-[9px] uppercase text-gray-400">menu</span>
          )}
        </div>
      </div>
      <div>
        <div className="text-gray-400">Profit</div>
        <div className="font-bold tabular-nums text-green-700">{fmt(row.profit)}</div>
      </div>
      <div>
        <div className="text-gray-400">Margin</div>
        <div>
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${marginStyle(
              row.margin_pct,
            )}`}
          >
            {row.margin_pct === null ? "—" : row.margin_pct.toFixed(0) + "%"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** A standalone recipe card (used for recipes not linked to a menu item). */
function RecipeCard({
  row,
  orphan = false,
  onClick,
}: {
  row: CostingRow;
  orphan?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-red/40 hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-tight text-gray-900">{row.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          {orphan && (
            <span
              title="This recipe isn't linked to a menu item"
              className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-gray-500"
            >
              unlinked
            </span>
          )}
          {row.has_issues && (
            <span title="A line has a costing issue" className="text-amber-500">
              ⚠
            </span>
          )}
        </div>
      </div>
      <div className="mt-3">
        <CostStats row={row} />
      </div>
    </button>
  );
}

/** A menu-item card: shows costing where a recipe exists, or an "add recipe"
 *  affordance where it doesn't. Sized items may map to several recipes. */
function MenuItemCard({
  item,
  recipes,
  onOpenRecipe,
  onAddRecipe,
}: {
  item: MenuItem;
  recipes: CostingRow[];
  onOpenRecipe: (id: number) => void;
  onAddRecipe: () => void;
}) {
  const hasIssue = recipes.some((r) => r.has_issues);
  // Pizzas price per size; pizza deals carry a pizzaSelection instead of a price map.
  const sized =
    (!!item.prices && Object.keys(item.prices).length > 0) || !!item.pizzaSelection;
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-tight text-gray-900">{item.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          {item.signature && (
            <span className="rounded bg-brand-yellow px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-ink">
              Signature
            </span>
          )}
          {item.special && !item.signature && (
            <span className="rounded bg-brand-red/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-red">
              Special
            </span>
          )}
          {hasIssue && (
            <span title="A line has a costing issue" className="text-amber-500">
              ⚠
            </span>
          )}
        </div>
      </div>

      {recipes.length === 0 ? (
        <div className="mt-3 flex flex-1 flex-col items-start justify-between gap-3">
          <span className="text-xs text-gray-400">No recipe yet</span>
          <button
            onClick={onAddRecipe}
            className="rounded-lg border border-dashed border-brand-red/40 px-3 py-1.5 text-xs font-semibold text-brand-red transition hover:bg-brand-red/5"
          >
            + Add recipe
          </button>
        </div>
      ) : recipes.length === 1 ? (
        <div className="mt-3 space-y-2">
          <button onClick={() => onOpenRecipe(recipes[0].id)} className="w-full text-left">
            <CostStats row={recipes[0]} />
          </button>
          {sized && (
            <button
              onClick={onAddRecipe}
              className="text-xs font-semibold text-brand-red transition hover:underline"
            >
              + Add size
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          {recipes.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpenRecipe(r.id)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-100 px-2.5 py-1.5 text-xs transition hover:bg-gray-50"
            >
              <span className="font-medium capitalize text-gray-700">{r.variant ?? "Base"}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-gray-500">{fmt(r.profit)}</span>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${marginStyle(
                    r.margin_pct,
                  )}`}
                >
                  {r.margin_pct === null ? "—" : r.margin_pct.toFixed(0) + "%"}
                </span>
              </span>
            </button>
          ))}
          {sized && (
            <button
              onClick={onAddRecipe}
              className="mt-1 text-xs font-semibold text-brand-red transition hover:underline"
            >
              + Add size
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A misc / prep sub-recipe card: batch cost, yield and per-unit cost. */
function MiscCard({ row, onClick }: { row: CostingRow; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-red/40 hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-tight text-gray-900">{row.name}</span>
        {row.has_issues && (
          <span title="A line has a costing issue" className="shrink-0 text-amber-500">
            ⚠
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
        <div>
          <div className="text-gray-400">Batch cost</div>
          <div className="font-semibold tabular-nums text-gray-800">{fmt(row.total_cost)}</div>
        </div>
        <div>
          <div className="text-gray-400">Yield</div>
          <div className="font-semibold tabular-nums text-gray-800">
            {row.yield_qty ? `${row.yield_qty} ${row.yield_unit ?? ""}` : "—"}
          </div>
        </div>
        <div className="col-span-2">
          <div className="text-gray-400">Cost per {row.yield_unit ?? "unit"}</div>
          <div className="font-bold tabular-nums text-gray-900">
            {row.unit_cost === null
              ? "—"
              : "Rs" + row.unit_cost.toLocaleString("en-PK", { maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>
    </button>
  );
}

function StatBox({
  label,
  value,
  valueClass = "text-gray-800",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="mb-0.5 text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function DetailLineRow({ line }: { line: DetailLine }) {
  const qtyLabel =
    line.component_type === "overhead"
      ? "—"
      : `${line.qty ?? 0}${line.unit ? " " + line.unit : ""}`;
  const unitCostLabel =
    line.unit_cost === null || line.unit_cost === undefined
      ? "—"
      : "Rs" + line.unit_cost.toLocaleString("en-PK", { maximumFractionDigits: 2 });
  return (
    <tr>
      <td className="px-3 py-2">
        {/* Name what is actually costed. A custom label is shown underneath, and
            only when it differs — a label left over from a component that was
            later swapped out would otherwise read as the wrong ingredient. */}
        <div className="font-medium text-gray-800">
          {line.component_name || line.label || "Item"}
        </div>
        {line.component_name && line.label && line.label !== line.component_name && (
          <div className="text-[11px] text-gray-400">labelled “{line.label}”</div>
        )}
        {line.component_type === "overhead" && (
          <div className="text-[10px] uppercase tracking-wide text-gray-400">overhead</div>
        )}
        {line.note && <div className="text-[11px] text-amber-600">⚠ {line.note}</div>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{qtyLabel}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{unitCostLabel}</td>
      <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-800">
        {fmt(line.line_cost ?? 0)}
      </td>
    </tr>
  );
}

/** Slide-over showing the full read-only cost breakdown for a recipe. */
function DetailPanel({
  detail,
  loading,
  onClose,
  onEdit,
}: {
  detail: RecipeDetail | null;
  loading: boolean;
  onClose: () => void;
  onEdit: (id: number) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{detail?.name ?? "Recipe"}</h2>
            {detail && (detail.category || detail.variant) && (
              <p className="text-xs capitalize text-gray-500">
                {[detail.category, detail.variant].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        {loading || !detail ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        ) : (
          <div className="space-y-5 p-6">
            {/* Summary */}
            {detail.kind === "sub_recipe" ? (
              <div className="grid grid-cols-2 gap-3">
                <StatBox label="Batch cost" value={fmt(detail.costing.total_cost)} />
                <StatBox
                  label="Yield"
                  value={detail.yield_qty ? `${detail.yield_qty} ${detail.yield_unit ?? ""}` : "—"}
                />
                <StatBox
                  label={`Cost per ${detail.yield_unit ?? "unit"}`}
                  value={
                    detail.yield_qty && detail.yield_qty > 0
                      ? "Rs" +
                        (detail.costing.total_cost / detail.yield_qty).toLocaleString("en-PK", {
                          maximumFractionDigits: 2,
                        })
                      : "—"
                  }
                  valueClass="text-gray-900"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <StatBox label="Total cost" value={fmt(detail.costing.total_cost)} />
                <StatBox
                  label={`Sell price${detail.costing.sell_source === "menu" ? " (menu)" : ""}`}
                  value={fmt(detail.costing.sell_price)}
                />
                <StatBox label="Profit / unit" value={fmt(detail.costing.profit)} valueClass="text-green-700" />
                <StatBox
                  label="Margin"
                  value={
                    detail.costing.margin_pct === null
                      ? "—"
                      : detail.costing.margin_pct.toFixed(1) + "%"
                  }
                />
              </div>
            )}

            {/* Ingredient breakdown */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Ingredient breakdown</h3>
              {detail.lines.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-400">
                  No ingredients on this recipe.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Unit cost</th>
                        <th className="px-3 py-2 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {detail.lines.map((l) => (
                        <DetailLineRow key={l.id} line={l} />
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-800">
                        <td className="px-3 py-2" colSpan={3}>
                          Total
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt(detail.costing.total_cost)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button onClick={() => onEdit(detail.id)} className="btn-primary">
                {detail.kind === "sub_recipe" ? "Edit item" : "Edit recipe"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function SumRow({
  label,
  value,
  valueClass = "text-gray-800",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

function LineEditor({
  line,
  ingredients,
  subRecipes,
  lineCost,
  onChange,
  onRemove,
}: {
  line: EditableLine;
  ingredients: Ingredient[];
  subRecipes: CostingRow[];
  lineCost: number;
  onChange: (p: Partial<EditableLine>) => void;
  onRemove: () => void;
}) {
  const isOverhead = line.component_type === "overhead";
  const isSubRecipe = line.component_type === "sub_recipe";
  return (
    <div className="rounded-lg border border-gray-200 p-2.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2">
          {isOverhead ? (
            <div className="flex gap-2">
              <input
                value={line.label}
                onChange={(e) => onChange({ label: e.target.value })}
                placeholder="Gas / Electricity / Labour"
                className="input flex-1"
              />
              <input
                type="number"
                value={line.flat_cost ?? ""}
                onChange={(e) =>
                  onChange({ flat_cost: e.target.value ? Number(e.target.value) : 0 })
                }
                placeholder="Cost"
                className="input w-24"
              />
            </div>
          ) : isSubRecipe ? (
            (() => {
              const selected = subRecipes.find((s) => s.id === line.sub_recipe_id);
              // A whole product recipe (e.g. a pizza) has no per-yield-unit cost;
              // it's added by the count, not by weight/volume.
              const isProduct = !!selected && selected.unit_cost === null;
              return (
                <>
                  <select
                    value={line.sub_recipe_id ?? ""}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const sub = subRecipes.find((s) => s.id === id);
                      const prod = !!sub && sub.unit_cost === null;
                      const prev = subRecipes.find((s) => s.id === line.sub_recipe_id);
                      onChange({
                        sub_recipe_id: id,
                        // Follow the selection unless the user typed their own
                        // label — otherwise re-pointing a line leaves it named
                        // after the component it used to be.
                        label: keepLabel(line.label, autoLabel(prev), autoLabel(sub)),
                        // Likewise the unit: a product is counted in pieces, a
                        // batch sub-recipe measured in its own yield unit.
                        unit: prod ? "pc" : sub?.yield_unit ?? line.unit ?? "g",
                        qty: prod && !line.qty ? 1 : line.qty,
                      });
                    }}
                    className="input"
                  >
                    <option value="">— Select —</option>
                    {(() => {
                      const opt = (s: CostingRow) => {
                        const cost =
                          s.unit_cost !== null
                            ? ` (Rs${s.unit_cost}/${s.yield_unit ?? "unit"})`
                            : s.total_cost
                              ? ` (Rs${s.total_cost})`
                              : "";
                        return (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.variant ? ` — ${s.variant}` : ""}
                            {cost}
                          </option>
                        );
                      };
                      // Whole products (added by count) vs batch sub-recipes
                      // (added by weight/volume) — same split the editor already
                      // makes off unit_cost. Only group when both are present,
                      // so a plain recipe keeps its simple flat list.
                      const products = subRecipes.filter((s) => s.unit_cost === null);
                      const subs = subRecipes.filter((s) => s.unit_cost !== null);
                      if (products.length === 0 || subs.length === 0) {
                        return subRecipes.map(opt);
                      }
                      return (
                        <>
                          <optgroup label="Products">{products.map(opt)}</optgroup>
                          <optgroup label="Sub-recipes">{subs.map(opt)}</optgroup>
                        </>
                      );
                    })()}
                  </select>
                  <div className="flex gap-2">
                    <input
                      value={line.label}
                      onChange={(e) => onChange({ label: e.target.value })}
                      placeholder="Label"
                      className="input flex-1"
                    />
                    <input
                      type="number"
                      value={line.qty ?? ""}
                      onChange={(e) => onChange({ qty: e.target.value ? Number(e.target.value) : 0 })}
                      placeholder={isProduct ? "Count" : "Qty"}
                      className="input w-20"
                    />
                    {!isProduct && (
                      <select
                        value={line.unit ?? "g"}
                        onChange={(e) => onChange({ unit: e.target.value })}
                        className="input w-16"
                      >
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              );
            })()
          ) : (
            <>
              <select
                value={line.inventory_item_id ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const ing = ingredients.find((i) => i.id === id);
                  const prev = ingredients.find((i) => i.id === line.inventory_item_id);
                  onChange({
                    inventory_item_id: id,
                    label: keepLabel(line.label, prev?.name ?? "", ing?.name ?? ""),
                    // Follow the new ingredient's base unit — keeping the old one
                    // silently re-scales the cost (300 g of a per-piece item).
                    unit: ing?.base_unit ?? line.unit ?? "g",
                  });
                }}
                className="input"
              >
                <option value="">— Select ingredient —</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unit_cost}/{i.base_unit})
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  value={line.label}
                  onChange={(e) => onChange({ label: e.target.value })}
                  placeholder="Label"
                  className="input flex-1"
                />
                <input
                  type="number"
                  value={line.qty ?? ""}
                  onChange={(e) => onChange({ qty: e.target.value ? Number(e.target.value) : 0 })}
                  placeholder="Qty"
                  className="input w-20"
                />
                <select
                  value={line.unit ?? "g"}
                  onChange={(e) => onChange({ unit: e.target.value })}
                  className="input w-16"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 w-20">
          <span className="text-sm font-medium text-gray-700 tabular-nums">
            {"Rs" + lineCost.toLocaleString("en-PK", { maximumFractionDigits: 1 })}
          </span>
          <button
            onClick={onRemove}
            className="text-gray-400 hover:text-red-600"
            title="Remove line"
            aria-label="Remove line"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

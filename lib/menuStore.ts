"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { Menu, MenuCategory, MenuItem, Restaurant } from "./types";

// The menu is authored in genz-admin and published as a canonical public feed.
// We read it directly on load and cache it in localStorage for further usage,
// so new categories/items from genz-admin show up without any backend sync.
const ADMIN_MENU_URL =
  process.env.NEXT_PUBLIC_ADMIN_MENU_URL ??
  "https://api.admin.genzfoods.pk/api/public/menu";
const MENU_CACHE_KEY = "rms_menu_cache_v1";

let inflight: Promise<Menu> | null = null;

// Normalizes both the canonical admin feed (slug as id, camelCase, items key)
// and the old shape (integer id + slug, snake_case, menu_items key).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCategory(cat: any): MenuCategory {
  const rawItems: any[] = cat.items ?? cat.menu_items ?? [];
  return {
    id:         typeof cat.id === "string" ? cat.id : (cat.slug ?? String(cat.id)),
    name:       cat.name,
    type:       cat.type,
    sizes:      cat.sizes ?? undefined,
    comingSoon: cat.comingSoon ?? cat.is_coming_soon ?? false,
    items:      rawItems.map(normalizeItem),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeItem(item: any): MenuItem {
  return {
    id:             typeof item.id === "string" ? item.id : (item.slug ?? String(item.id)),
    name:           item.name,
    description:    item.description ?? undefined,
    price:          item.price ?? undefined,
    prices:         item.prices ?? undefined,
    tag:            item.tag ?? undefined,
    special:        item.special ?? item.is_special ?? undefined,
    signature:      item.signature ?? item.is_signature ?? undefined,
    pizzaSelection: item.pizzaSelection ?? item.pizza_selection ?? undefined,
    dealExtras:     item.dealExtras     ?? item.deal_extras     ?? undefined,
    defaultSize:    item.defaultSize ?? item.default_size ?? undefined,
  };
}

const FALLBACK_RESTAURANT: Restaurant = {
  name: "Gen Z Foods",
  address: "",
  phone: "",
  timing: "",
};

// Restaurant details still come from the RMS settings endpoint; a failure here
// must not block the menu, so we fall back to sensible defaults.
async function fetchRestaurant(): Promise<Restaurant> {
  try {
    const settings = await api.get<Record<string, string>>("/settings");
    return {
      name:     settings.restaurant_name ?? "Gen Z Foods",
      tagline:  settings.tagline,
      address:  settings.address ?? "",
      phone:    settings.phone ?? "",
      whatsapp: settings.whatsapp,
      timing:   settings.timing ?? "",
    };
  } catch {
    return FALLBACK_RESTAURANT;
  }
}

function loadCache(): Menu | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MENU_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Menu) : null;
  } catch {
    return null;
  }
}

function saveCache(menu: Menu): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(menu));
  } catch {
    // ignore storage errors (quota / private mode)
  }
}

async function fetchMenu(): Promise<Menu> {
  const [feed, restaurant] = await Promise.all([
    fetch(ADMIN_MENU_URL, { headers: { Accept: "application/json" } }).then((res) => {
      if (!res.ok) throw new Error(`Menu feed HTTP ${res.status}`);
      return res.json();
    }),
    fetchRestaurant(),
  ]);

  const categories: MenuCategory[] = (feed?.categories ?? []).map(normalizeCategory);

  const menu: Menu = {
    version: 1,
    restaurant,
    currency: { code: "PKR", symbol: "Rs" },
    categories,
  };

  saveCache(menu);
  return menu;
}

export function useMenu(): Menu | null {
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => {
    // 1) Paint instantly from the last cached menu, if any.
    const cachedMenu = loadCache();
    if (cachedMenu) setMenu(cachedMenu);

    // 2) Refresh from the live admin feed (shared across mounts this session).
    if (!inflight) inflight = fetchMenu();
    inflight
      .then(setMenu)
      .catch(() => {
        // Keep whatever we painted from cache; allow a later retry.
        inflight = null;
      });
  }, []);

  return menu;
}

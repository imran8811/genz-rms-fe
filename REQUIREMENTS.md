# Gen Z Foods — Billing Terminal (POS)

A single-screen, iPad-friendly billing app for Gen Z Foods (Multan).
**Scope is intentionally narrow:** pick category → item → size → quantity → print bill.
No login, no inventory, no order history, no backend, no DB. All state lives in `localStorage`.

---

## 1. Tech stack

| Layer       | Choice                                |
|-------------|---------------------------------------|
| Framework   | Next.js 15 (App Router)               |
| Language    | TypeScript                            |
| Styling     | Tailwind CSS, light theme             |
| State       | React `useReducer` + `useLocalStorage` (no external store lib) |
| Persistence | `localStorage` only (menu, bill counter) |
| Print       | `window.print()` + 80mm thermal stylesheet |

Run:
```
npm run dev      # http://localhost:3000
npm run build
```

---

## 2. Locked decisions

| Decision           | Value                                          |
|--------------------|------------------------------------------------|
| Tax                | None                                           |
| Discount           | None                                           |
| Currency           | PKR — formatted as `Rs1250` (no space, no dot) |
| Printer            | 80mm thermal (`@page { size: 80mm auto }`)     |
| Bill number        | Auto-increment forever, persisted              |
| Order type         | Required: Dine-in / Takeaway / Delivery        |
| Customer info      | Not collected                                  |
| Target device      | iPad landscape (~1180×820), touch ≥44px        |
| Brand colors       | Light bg, red primary (`#E53935`), yellow accent |

---

## 3. Menu data

Source of truth: **`menu.json`** at project root.

- Imported directly via `@/menu.json` in `lib/menuStore.ts`.
- On app load, the menu is seeded into `localStorage` under key `genz.menu` with `genz.menu.version`.
- If `menu.json.version` changes, localStorage is reseeded automatically.
- 13 categories, 86 items including Pizza Deals (with pizza selection metadata for deals 7/8/9).

To edit the menu: change `menu.json` and bump `version`.

---

## 4. File map

```
fe/
├── app/
│   ├── layout.tsx                # Root layout, viewport set for tablet
│   ├── page.tsx                  # Billing terminal (client)
│   └── globals.css               # Tailwind + 80mm print styles
├── components/
│   ├── CategoryTabs.tsx          # Left rail
│   ├── ItemGrid.tsx              # Items for active category
│   ├── ItemPickerModal.tsx       # Size + qty for normal items
│   ├── DealPickerModal.tsx       # Pizza picker for deals 7/8/9
│   ├── BillPanel.tsx             # Right rail (cart, order type, total, print)
│   └── Receipt.tsx               # Hidden DOM, becomes the print target
├── lib/
│   ├── types.ts
│   ├── currency.ts               # formatPKR()
│   ├── useLocalStorage.ts
│   ├── menuStore.ts              # Loads menu.json into localStorage
│   └── cartReducer.ts            # ADD / INC / DEC / REMOVE / SET_ORDER_TYPE / CLEAR
├── menu.json                     # Source-of-truth menu
├── REQUIREMENTS.md               # This file
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
└── next.config.mjs
```

---

## 5. Print flow

1. Operator taps **Print Bill** (only enabled when cart has lines).
2. `window.print()` fires — CSS hides everything except the `#receipt` element.
3. The receipt prints at 80mm width, monospace font, dashed dividers.
4. After dialog closes, bill counter increments and cart clears.

Receipt content: restaurant name + address + phone, bill #, date/time, order type, line items (with size and deal selections), total, footer ("Thank you, visit again!").

---

## 6. Open / future

- Logo file (user will provide).
- Drinks & Desserts category (currently `comingSoon: true` in `menu.json`).
- Possible future additions if requested: tax/discount toggle, daily sales summary, settings screen for editing menu, NTN/GST# on receipt.

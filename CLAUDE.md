# genz-rms-fe — RMS Frontend (POS)

Frontend for the Restaurant Management System — a point-of-sale (POS) UI.
Package name: `genz-foods-pos`. Talks to [`genz-rms-apis`](../genz-rms-apis).

- **Stack:** Next.js 16 (App Router), React 19, TypeScript 5.7, Tailwind CSS 3.4.
- **API base:** `process.env.NEXT_PUBLIC_API_URL` (defaults to
  `https://api.rms.genzfoods.pk/api`). Set in `.env.local`.
- **Auth:** Sanctum token from the backend, stored in `localStorage` under
  `rms_token` (user under `rms_user`); a 401 clears the session and bounces to `/`.

## Roles (`lib/auth.tsx`)

`admin` / `user` / `kitchen`. `homeRouteFor()` picks the landing route — dashboard / billing /
`/orders` — and is what login and every gate redirect to.
- **`kitchen` is the back-of-house terminal: the orders board and nothing else.** `RequireAuth` (in
  the `(rms)` layout and on `/billing`) bounces it off any other path via `canOpen()`, the sidebar
  shows only entries flagged `kitchen: true`, and `/orders` hides the front desk's **⏱ Time** button
  for it. None of that is the real gate — `genz-rms-apis` `RestrictKitchenUser` 403s every endpoint
  but the board's, so a typed URL gets an empty screen, not data. These checks only stop the UI
  offering doors that would slam.
- Adding a page a kitchen login should see means adding it to `KITCHEN_HOME`/`canOpen()` here **and**
  to the middleware's allowlist in the backend.

## Responsive: `md` is the line

The RMS is a desktop/counter app first, so most screens are laid out for a wide window.
**`md` (768px) is the one breakpoint that matters** — below it the app is in "mobile mode":
- `components/AppShell.tsx` (used by the `(rms)` layout) turns the 224px `Sidebar` into an
  **off-canvas drawer** — on a 375px phone the static column left ~150px of usable width — and puts
  a slim bar with the ☰ button in its place. That bar is **shell-level on purpose**: pages may drop
  their own headers at mobile widths, and the way back to the rest of the RMS must not go with them.
  The drawer closes on navigation, on Escape and on the backdrop. `md:static md:translate-x-0`
  restores the old column on desktop — nothing above `md` changed.
- `AppShell` wraps `children` in `flex min-h-0 flex-1 flex-col`. Pages size themselves with either
  `h-full` or `flex-1`; without that wrapper an `h-full` page resolves against the *whole* column and
  hangs its last rows below the fold by the height of the mobile bar.
- `/billing` is **not** in the `(rms)` group and renders no sidebar — it's a full-screen POS and is
  unaffected by any of this.

## Layout

- `app/` — Next.js App Router routes. Includes `(rms)` route group and `billing/`.
  Every route carries a one-line `layout.tsx` exporting `metadata.title` (its own name:
  "Sales", "Orders", …) — the pages themselves are `"use client"` and so can't export metadata.
  The login page at `/` keeps the root title. `/orders` overrides it at runtime with the
  waiting-order count.
- `components/` — UI components: `BillPanel`, `CategoryTabs`, `CounterAlerts`, `ItemGrid`,
  `Receipt`, `Sidebar`, picker modals, etc.
- `lib/` — core logic: `api.ts` (fetch wrapper + auth), `auth.tsx`,
  `cartReducer.ts`, `costing.ts`, `currency.ts`, `menuStore.ts`, `types.ts`,
  and hooks (`useFetch`, `useLocalStorage`).
- `menu.json` — menu data; `docs/` and `REQUIREMENTS.md` — product docs.

## Kitchen orders board (`/orders`)

Live slip board for the kitchen — a plain card grid, no modals. Polls `GET /orders/kitchen` every
10s (plus on tab focus) and renders each order as a receipt-style slip (`components/OrderSlip`),
**newest first**, so the order that just landed is at the top of the board. (The feed itself is
oldest-first; the page sorts a copy for display.)
- Orders with `kitchen_status === "new"` get a red pulsing frame and keep a repeating chime going
  until acknowledged. **OK — Received** tells the front desk the kitchen has it, **Ready** marks it
  cooked; both hit `POST /orders/{id}/kitchen-status`.
- A ready slip carries a small **↩ Undo** beside "Ready at 14:32" for the one pressed on the wrong
  order. It sends `received` — back in the kitchen, *not* `new`, which would restart the new-order
  alarm over food already cooking — and is styled small and off to the side, away from where the big
  green button was. The `overrides` map holds a locally-set status until the poll **echoes it back**
  (not "until the poll ranks at least this far"), or Undo's backwards step would be undone by the
  stale `ready` still in flight.
- The chime only rings for whoever is **watching** the board (tab visible *and* focused) and only
  for orders this browser didn't create — the POS page records its own bills via
  `lib/localOrders.ts` (`rms_local_orders` in localStorage), so the counter terminal never alarms
  itself. Suppressed orders still appear on the board and still need acknowledging.
- The chime is synthesised in `lib/alertSound.ts` (no audio asset). Browsers block audio until a
  gesture, so the page unlocks it on the first click/keypress anywhere and the header carries a
  🔕 → 🔔 toggle as the fallback.
- Local status changes are held in an `overrides` map so a poll in flight can't roll a slip back.

## Preparation time (front desk ⇄ kitchen, on the same board)

"How much longer?" at the counter, answered from the kitchen — both halves live on the `/orders`
slip, so there is no separate front-desk screen and no mode switch.
- **Front desk** gets a compact red **⏱ Time** button in the slip's action row, beside
  *OK — Received* / *Ready*, once the order is `ETA_ASK_AFTER_MINS` (5) minutes old and not yet
  ready (`components/OrderSlip.tsx`). Below five minutes the only honest answer is "it just came
  in". → `POST /orders/{id}/eta-request`. The same button re-asks after an answer.
- **Kitchen** sees that slip **pinned to the top of the board**, framed amber, and hears a
  *different* alarm from a new order — a loud two-tone klaxon vs. the rising three-note chime
  (`lib/alertSound.ts`, `startTimeQuestionSound`). The slip carries a number input + **Update**.
  → `POST /orders/{id}/eta` `{ minutes }`, which also acknowledges a still-`new` order.
- **Front desk** then sees `Kitchen said ~6 min at 14:32` with a live `≈ 3 min left` countdown
  (`etaRemaining()` counts down from `eta_set_at`, so the quote never goes stale).
- Only **one alarm plays at a time**, arbitrated inside `lib/alertSound.ts`: callers *request* an
  alarm and the module plays the highest-priority claim (`new-order` > `web-order` > `time-question`),
  since two chimes over each other defeats the point of a second sound. The arbitration lives in the
  module because the claims no longer share a page — `WebOrderNotifier` is mounted in the shell. There is **no card shake and no device vibration**
  (both removed — the motion read as noise, and the buzz never carried); the alarm is the sound plus
  the amber frame, so the board's 🔔 toggle has to be on for the kitchen to be told.
- Both alarms run through a compressor + makeup gain in `alertSound.ts` so they stay audible over a
  working kitchen; the klaxon is the loudest thing the board plays.
- The terminal that **asked** never alarms itself: `lib/etaAsks.ts` (`rms_eta_asks` in localStorage)
  records the ask — same idea as `lib/localOrders.ts` — and shows "⏱ Waiting for the kitchen"
  instead of the input. Entries clear once the question is settled (with a 20s grace so a poll
  already in flight can't make the board forget the ask was its own), so the *next* question, from
  whichever terminal, alarms this one again.

## Ready alert (kitchen → front desk) — an in-page toast

`components/ReadyOrderNotifier.tsx` polls the kitchen feed every 10s and raises a **green toast**
("#3021 · Ready to collect") in the top-right of whatever screen the front desk has open, the first
time an order shows up as `ready`. It carries a **✕** in its own top-right corner and clears itself
after `TOAST_MS` (30s) regardless — the ready state lives on the kitchen board, so a missed toast
loses nothing, and the ✕ is for getting one out of the way early rather than for keeping the screen
honest.
- Silent on `/orders`: the kitchen board already shows those slips, and the person who pressed
  "Ready" doesn't need telling. Leaving the page also clears any toast it raised.
- The first poll after a page load only records what is already ready, so a refresh doesn't spray
  toasts for the whole day's backlog.

### There are no desktop notifications anywhere in the RMS — don't add them back

This alert was a **desktop notification** until the counter laptop was replaced by a tablet, at which
point it stopped working **entirely and silently**: `new Notification(...)` **throws on Android
Chrome** (which accepts only `ServiceWorkerRegistration.showNotification()`), the throw was caught,
and the front desk was simply never told an order was ready — with nothing in the UI to say so. An
alert the OS is free to silence, throttle or refuse is the wrong carrier for something the counter
has to act on. `lib/desktopNotify.ts` and the service worker that briefly drew these have both been
**deleted**; the toast is the whole alert.

The obvious-looking repair — keep a notification "as a fallback for when the tab is hidden" — is a
trap, and was tried and removed:
- On the tablet it **doesn't fire in the case it exists for**. Android freezes the 10s poll as soon
  as Chrome is backgrounded, so nothing is there to raise it until the screen is woken anyway.
- It double-alerts in every other case, which is exactly what `WebOrderNotifier` was doing — an
  alarm card *and* an OS pop-up for the same online order.
- It costs a service worker that must be reachable at the site root over https, plus a permission
  prompt the staff have to dismiss, to buy that.

**Reaching a backgrounded tablet needs real Web Push** — VAPID keys and a send from `genz-rms-apis`,
not the Notification API. Until then the counter tablet must be set to **never auto-lock**, which is
what actually keeps these alerts working.

## The alert column (`components/CounterAlerts.tsx`)

One fixed top-right column, mounted in the `(rms)` layout **and** on `/billing`, that both notifiers
render into: `WebOrderNotifier` first, `ReadyOrderNotifier` under it — the online order is the one
holding up a phone call, so it takes the top.
- They used to position themselves, which was fine while only the web-order card drew anything. Two
  separately-positioned `fixed` boxes would now land on the same pixels and bury the alarm card, so
  **neither component may carry its own positioning** — that belongs here.
- The column is `pointer-events-none` with `pointer-events-auto` on each card, or an empty (or short)
  stack would swallow taps on the POS behind it.

## Online-order alarm (website → counter)

**The front desk is the only source of orders reaching the kitchen.** An order forwarded in from the
website does not appear on the kitchen board until the counter sends it through — the backend keeps
it off `GET /orders/kitchen` and serves it on `GET /orders/web-inbox` instead (see `genz-rms-apis` →
"The front desk is the only source of kitchen orders").

**The staff phone the customer to verify an online order before it is cooked.** That call does not
happen in the seconds after a chime starts, which shapes both halves below: the alert only
*announces*, and the counter board is where the order waits for as long as the call takes.

`components/WebOrderNotifier.tsx` announces one — and only announces it. It polls `/orders/counter`
every 10s, filters to what is still waiting, and raises **the same rising three-note chime the
kitchen hears for a new order** plus an on-screen card. (It raised a desktop pop-up alongside the
card too — removed; see "There are no desktop notifications anywhere in the RMS".) The card is
positioned by the shared alert column (see `components/CounterAlerts.tsx`), not by this component.
- **One button: OK.** It means "I have seen this", stops the sound and dismisses the card. It does
  **not** dispose of the order, so the card says where the order went — a link to *Orders / Counter*
  — or dismissing would look like handling it.
- Dismissal is remembered in `lib/webOrderAcks.ts` (`rms_web_order_acks` in localStorage), because a
  dismissed order is *still waiting* and its own state therefore cannot say whether anyone has looked
  at it. **localStorage rather than a column because the restaurant has one counter** — there is no
  second terminal to agree with, and the only thing that must survive is a page reload, without which
  a refresh mid-phone-call would set the alarm off again.

## Counter board (`/counter`) — "Orders / Counter"

What `/orders` is to the kitchen. Polls `GET /orders/counter` every 10s and shows each online order
as a card, **newest first**, with the customer's name, phone and address (they arrive in `notes`) —
that phone number is the whole point of the screen.
- Tabs **Waiting / Sent to kitchen / Cancelled / All today**; waiting cards get a red frame and a
  `TO VERIFY` badge, and the count rides in the tab title so it is visible from another screen.
- **Send to kitchen** → `POST /orders/{id}/release`, which releases *that same order* onto the kitchen
  board. It is never retyped as a POS bill: one sale must stay one row, or Sales counts the money
  twice. **Cancel** → `/reject`, behind an inline confirm, which drops it out of Sales.
- Sent and cancelled orders **stay on the board** as the counter's own record of what it did — the
  feed keeps them, unlike the kitchen's.
- The route is `/counter`, deliberately **not** `/orders/counter`: `canOpen()` lets a kitchen login
  open anything under `/orders/`, so nesting it there would offer the kitchen a door the API slams.
- Mounted in the `(rms)` layout **and** on `/billing`, and unlike `ReadyOrderNotifier` it stays live
  on `/orders` too. It can no longer collide with the board's own alarm over the same order (an
  unreleased order isn't on the board, and a released one has left the inbox), but the two still
  raise the same chime as separate claims and `alertSound.ts` plays only one at a time.
- It does **not** wait for the tab to be focused (the board's chime does): the whole point is to
  reach a counter looking at something else. A **kitchen login gets nothing** — it has the slip and
  the board's own alarm, and can't act on the customer's half anyway.
- Orders older than `ALARM_WINDOW_MINS` (60) stop ringing but **keep their card** until dismissed: a
  terminal opened at closing time shouldn't chime over the lunch rush.
- The card lists the items, total and the `notes` block verbatim — customer, phone, address and
  payment method arrive there from `WebOrderController::buildNotes()`.

## Sales: the **Source** column

Beside the existing **Type** column (Dine-in / Takeaway / Delivery / Food Panda) the orders table
carries a **Source** — where the order came *from*, which is a different question to what kind of
order it is. `originOf()` derives it, because `orders.source` alone cannot answer it:
- `web` → **Web**, `app` → **App**, `foodpanda` → **Food Panda** — these arrive already knowing how
  they came in, so they are taken at their word.
- `pos` covers everything typed at the till, so **the order type carries the answer**: Dine-in or
  Takeaway means someone was standing there (**Walk-in**), Delivery means they phoned or sent a
  WhatsApp (**WhatsApp/Call**).

So a walk-in and a phone order are told apart by their order type, not by anything stored — nobody
records "this one rang". If that distinction ever has to be exact, it needs its own column on
`orders`, set at the till.
- ⚠ **`app` is prepared, not live.** The label and colour exist, but `orders.source` is a MySQL enum
  of `pos,foodpanda,web` — storing `app` needs that enum widened, **and** `genz-web-apis` passing a
  source through (`WebOrderController` currently hardcodes `'web'`, ignoring the payload's `source`).
  Until both are done a mobile-app order arrives as **Web**.
- The table's `colSpan` / `LoadingRow cols` are hardcoded — they moved 7 → 8 with this column, and
  must move again if another is added, or the empty and loading rows misalign.

## Sales (`/sales`) on a phone

The date nav is a **desktop control**. The page header (title + date arrows/picker + the four
channel breakdown cards) needs ~900px to sit on one line, so it is `hidden md:flex` — on a phone
`/sales` reads *today* and there is no way to change that from the page. Deliberate: the header cost
most of the screen before a single figure was on it. `flex-wrap` covers the middle widths where the
row fits the screen but not one line.
- Stat cards go `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`, so Cash — the figure that gets checked
  against the drawer — lands on its own row on a phone. Values `truncate` rather than wrap: a figure
  broken over two lines changes each card's height and the row stops scanning as a row.
- The Orders card is `overflow-hidden`, so its filter pills would be **clipped** (Food Panda out of
  reach) rather than overflowing visibly — they're `overflow-x-auto` inside a `min-w-0` parent.
- The order slide-over is `w-full max-w-[520px]`; as a fixed `w-[520px]` it hung its left third off
  a 375px screen, anchored right, with nothing to scroll.

## Staff → Fines tab (`/staff`)

Sits between Advances and Food, and is where late-arrival money shows up. The **fine is charged by
the backend when attendance is saved** (see `genz-rms-apis` → "Late fines"); this tab is the
register plus manual CRUD (add / edit / delete any fine — breakage, uniform, whatever).
- Rows are badged **Late** (`source: auto_late`, written by the attendance sync) or **Manual**.
  Editing a Late row warns that re-saving that day's attendance will overwrite it — the durable fix
  is correcting the check-in time.
- **Nobody types check-in times.** Marking someone in *is* the check-in — saving stamps the current
  time server-side (today only, and only for someone not already marked in). Rows about to be
  stamped say *"stamps 17:30 on save"* under the time box, and the Late Fine column previews what
  that stamp will cost, ticking each minute (`clockTick`). Typing a time overrides the stamp.
  `savedStatus` holds the status as the server last stored it, which is what tells the preview
  apart "present since 2pm, no time recorded" (no stamp) from "being marked in now" (stamp).
- The time box is the browser's native widget, so a 12-hour locale renders a stored `17:45` as
  **`05:45 PM`** — that is display, not data.
- The **Attendance tab previews the fine live**: `minutesLate()` / `shiftStartMinutes()` at the top
  of `page.tsx` mirror `LateFineService`, so a check-in past the grace period shows *Rs 200 · 31 min
  late* in a "Late Fine" column before anything is saved. Typing a check-in time also moves the row
  off Absent by itself — to **Late** past the grace period, **Present** inside it (Half Day is left
  alone).
- The rule's numbers come from `GET /staff-fines/rule` (fetched once into `fineRule`), never
  hardcoded in the UI beyond a fallback — so changing `late_fine_amount` in settings changes what
  the screen quotes.
- After Save, `POST /staff-attendance/bulk` answers `{ records, fines }` and the tab shows a banner
  listing what was just charged — or "no late fines for this day", so a manager who expected one
  can see the rule didn't fire.
- Payroll carries a **−Fines** column; final salary subtracts it alongside food and advances.

## Common commands

```bash
npm install
npm run dev      # next dev (local dev server)
npm run build    # next build
npm run start    # next start (serve production build)
npm run lint     # next lint
```

## Conventions

- TypeScript throughout; shared types live in `lib/types.ts`.
- Go through the `lib/api.ts` wrapper for backend calls so auth/401 handling
  stays centralized — don't call `fetch` to the API directly from components.
- Styling via Tailwind utility classes (`tailwind.config.ts`, `app/globals.css`).

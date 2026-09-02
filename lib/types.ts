export type OrderType = "Dine-in" | "Takeaway" | "Delivery";

export interface Restaurant {
  name: string;
  tagline?: string;
  address: string;
  phone: string;
  whatsapp?: string;
  timing: string;
  features?: string[];
}

export interface Currency {
  code: string;
  symbol: string;
}

export interface PizzaSelection {
  size: string;
  count: number;
  from: string[];
}

export interface MenuItem {
  id: string;
  name: string;
  price?: number;
  prices?: Record<string, number | null>;
  description?: string;
  tag?: string;
  special?: boolean;
  signature?: boolean;
  pizzaSelection?: PizzaSelection;
  dealExtras?: string[];
  defaultSize?: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  type: "sized" | "single";
  sizes?: string[];
  items: MenuItem[];
  comingSoon?: boolean;
  seasonal?: boolean;
}

export interface Menu {
  version: number;
  restaurant: Restaurant;
  currency: Currency;
  categories: MenuCategory[];
}

export interface CartLine {
  lineId: string;
  itemId: string;
  categoryId?: string;
  name: string;
  size?: string;
  unitPrice: number;
  quantity: number;
  dealSelections?: string[];
}

export type OrderSource = "pos" | "foodpanda" | "web" | "app";

/** Kitchen workflow state shown on the orders board. */
export type KitchenStatus = "new" | "received" | "ready";

export interface KitchenOrderItem {
  id: number;
  item_name: string;
  size: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
  deal_selections: string[] | null;
}

export interface KitchenOrder {
  id: number;
  order_number: string;
  order_type: OrderType;
  source: OrderSource;
  subtotal: number;
  delivery_charge: number;
  extra_topping: number;
  total: number;
  status: "completed" | "cancelled";
  kitchen_status: KitchenStatus;
  received_at: string | null;
  ready_at: string | null;
  /**
   * When the front desk sent an online order through to the kitchen. Null on a
   * counter order (ringing it up *is* its release) and on one still waiting in
   * the front desk's inbox.
   */
  released_at: string | null;
  /** Front desk asked the kitchen how long this will take; null = nothing outstanding. */
  eta_requested_at: string | null;
  /** The kitchen's last answer, in minutes. */
  eta_minutes: number | null;
  /** When that answer was given — the front desk counts down from here. */
  eta_set_at: string | null;
  notes: string | null;
  created_at: string;
  items: KitchenOrderItem[];
}

export interface KitchenFeed {
  date: string;
  server_time: string;
  orders: KitchenOrder[];
}

export interface CartState {
  lines: CartLine[];
  orderType: OrderType;
  /** null = operator has not yet answered the required Food Panda question */
  isFoodpanda: boolean | null;
}

export type CartAction =
  | { type: "ADD"; line: Omit<CartLine, "lineId"> }
  | { type: "INC"; lineId: string }
  | { type: "DEC"; lineId: string }
  | { type: "REMOVE"; lineId: string }
  | { type: "SET_ORDER_TYPE"; orderType: OrderType }
  | { type: "SET_FOODPANDA"; isFoodpanda: boolean | null }
  | { type: "CLEAR" };

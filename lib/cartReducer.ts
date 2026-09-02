import type { CartAction, CartLine, CartState } from "./types";

export const initialCart: CartState = {
  lines: [],
  orderType: "Delivery",
  isFoodpanda: null,
};

function makeLineId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD": {
      const newLine: CartLine = { ...action.line, lineId: makeLineId() };
      return { ...state, lines: [...state.lines, newLine] };
    }
    case "INC":
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.lineId === action.lineId ? { ...l, quantity: l.quantity + 1 } : l
        ),
      };
    case "DEC":
      return {
        ...state,
        lines: state.lines
          .map((l) =>
            l.lineId === action.lineId ? { ...l, quantity: l.quantity - 1 } : l
          )
          .filter((l) => l.quantity > 0),
      };
    case "REMOVE":
      return { ...state, lines: state.lines.filter((l) => l.lineId !== action.lineId) };
    case "SET_ORDER_TYPE":
      return { ...state, orderType: action.orderType };
    case "SET_FOODPANDA":
      return {
        ...state,
        isFoodpanda: action.isFoodpanda,
        // Food Panda orders are always Takeaway
        orderType: action.isFoodpanda === true ? "Takeaway" : state.orderType,
      };
    case "CLEAR":
      return { ...state, lines: [], isFoodpanda: null };
    default:
      return state;
  }
}

export function cartTotal(state: CartState): number {
  return state.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
}

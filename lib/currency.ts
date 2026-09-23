export function formatPKR(amount: number): string {
  return `Rs${Math.round(amount).toLocaleString("en-PK")}`;
}

/**
 * Coerces a price off the menu feed to a number, or `undefined` if there isn't
 * one.
 *
 * The admin feed is not consistent about this and cannot easily be: a `sized`
 * item's `prices` live in a JSON column and come back as numbers, while a
 * `single` item's `price` is a plain integer column that Laravel serialises as
 * a **string** (`"400"`). Anything comparing `typeof price === "number"` was
 * therefore right about pizza and wrong about every single-price category.
 *
 * Returns `undefined` rather than `0` for a missing or unparseable price, so a
 * price that isn't set reads as "no price" instead of "free".
 */
export function toAmount(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

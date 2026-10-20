// The order of siblings is kept as fractional keys: strings that sort in the
// order the nodes are shown. A key between any two others can always be made,
// so moving a node rewrites that one node, not all its siblings.
//
// This is David Greenspan's "fractional indexing"
// (https://observablehq.com/@dgreensp/implementing-fractional-indexing).
// A key is an integer part and a fraction, in base 62. The first character of
// the integer part says how long it is: "a" two characters, "b" three, and so
// on; "Z", "Y"... the same for integers below zero. Adding at either end steps
// the integer, so a list that grows at its end, the usual case, keeps short
// keys. Adding between two keys with the same integer uses the fraction, which
// never ends in "0" so that there is always room before it.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0];
const LAST = DIGITS[DIGITS.length - 1];
/** The smallest integer part: nothing can go before it but fractions. */
const SMALLEST = "A" + ZERO.repeat(26);

/** A key that sorts after `before` and before `after`; null means no limit. */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null) validate(before);
  if (after !== null) validate(after);
  if (before !== null && after !== null && before >= after) {
    throw new Error(`keyBetween: "${before}" is not before "${after}"`);
  }
  if (before === null) {
    if (after === null) return "a" + ZERO;
    const int = integerPart(after);
    const fraction = after.slice(int.length);
    if (int === SMALLEST) return int + midpoint("", fraction);
    if (int < after) return int;
    const smaller = decrement(int);
    if (smaller === null) throw new Error("No key fits before " + after);
    return smaller;
  }
  const intA = integerPart(before);
  const fractionA = before.slice(intA.length);
  if (after === null) {
    const larger = increment(intA);
    return larger === null ? intA + midpoint(fractionA, null) : larger;
  }
  const intB = integerPart(after);
  if (intA === intB) return intA + midpoint(fractionA, after.slice(intB.length));
  const larger = increment(intA);
  if (larger === null) throw new Error("No key fits after " + before);
  return larger < after ? larger : intA + midpoint(fractionA, null);
}

/** `count` keys in order, spread between `before` and `after`. */
export function keysBetween(before: string | null, after: string | null, count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [keyBetween(before, after)];
  const middle = Math.floor(count / 2);
  const key = keyBetween(before, after);
  return [...keysBetween(before, key, middle), key, ...keysBetween(key, after, count - middle - 1)];
}

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 97 + 2;
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2;
  throw new Error(`Invalid sort key head "${head}"`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0]);
  if (length > key.length) throw new Error(`Invalid sort key "${key}"`);
  return key.slice(0, length);
}

function validate(key: string): void {
  if (key === "" || key === SMALLEST) throw new Error(`Invalid sort key "${key}"`);
  const int = integerPart(key);
  const fraction = key.slice(int.length);
  if (fraction.endsWith(ZERO)) throw new Error(`Invalid sort key "${key}"`);
  for (const c of key.slice(1)) if (!DIGITS.includes(c)) throw new Error(`Invalid sort key "${key}"`);
}

/** The next integer part, or null past the largest. */
function increment(int: string): string | null {
  const head = int[0];
  const digits = int.slice(1).split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) + 1;
    if (d < DIGITS.length) {
      digits[i] = DIGITS[d];
      return head + digits.join("");
    }
    digits[i] = ZERO;
  }
  // Every digit carried: the integer needs another digit.
  if (head === "Z") return "a" + ZERO;
  if (head === "z") return null;
  const next = String.fromCharCode(head.charCodeAt(0) + 1);
  if (next > "a") digits.push(ZERO);
  else digits.pop();
  return next + digits.join("");
}

/** The previous integer part, or null before the smallest. */
function decrement(int: string): string | null {
  const head = int[0];
  const digits = int.slice(1).split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) - 1;
    if (d >= 0) {
      digits[i] = DIGITS[d];
      return head + digits.join("");
    }
    digits[i] = LAST;
  }
  if (head === "a") return "Z" + LAST;
  if (head === "A") return null;
  const next = String.fromCharCode(head.charCodeAt(0) - 1);
  if (next < "Z") digits.push(LAST);
  else digits.pop();
  return next + digits.join("");
}

/** A fraction between two fractions, the digits after a decimal point; null is 1. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Copy the prefix the two share; `a` is padded with zeros as it is shorter.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)];
  // The first digits are next to each other.
  if (b !== null && b.length > 1) return b[0];
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

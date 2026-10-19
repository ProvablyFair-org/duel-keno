/**
 * EXACT RATIONAL ARITHMETIC for the hypergeometric law and the per-config RTP (KENO-18, KENO-19).
 *
 * Everything here is BigInt: binomial coefficients are exact integers, a multiplier is the exact
 * rational of its decimal literal in kenoConfig.json (the literal is JavaScript's shortest
 * round-trip rendering of the parsed double, String(cell) — verified equal to the file's literal on
 * all 260 cells, 2026-09-25), and an RTP is a reduced fraction. No floating point enters a result
 * this module returns; Number() appears only where a caller asks for a printable approximation.
 */

export interface Rational { num: bigint; den: bigint }

const abs = (x: bigint): bigint => (x < 0n ? -x : x);
export function gcd(a: bigint, b: bigint): bigint { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; }
export function reduce(r: Rational): Rational {
  if (r.den === 0n) throw new Error('zero denominator');
  const g = gcd(r.num, r.den) || 1n;
  const s = r.den < 0n ? -1n : 1n;
  return { num: (s * r.num) / g, den: (s * r.den) / g };
}
export const add = (a: Rational, b: Rational): Rational => reduce({ num: a.num * b.den + b.num * a.den, den: a.den * b.den });
export const sub = (a: Rational, b: Rational): Rational => reduce({ num: a.num * b.den - b.num * a.den, den: a.den * b.den });
export const mul = (a: Rational, b: Rational): Rational => reduce({ num: a.num * b.num, den: a.den * b.den });
export const eq = (a: Rational, b: Rational): boolean => a.num * b.den === b.num * a.den;
export const toNumber = (r: Rational): number => Number(r.num) / Number(r.den);
export const toString = (r: Rational): string => `${r.num}/${r.den}`;
export function absCmp(a: Rational, b: Rational): number {
  const l = abs(a.num) * b.den, r = abs(b.num) * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

/** C(n, k) exactly. */
export function binom(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}

/** The exact rational of a plain decimal literal ("4.035047673782158" → 4035047673782158/10^15). */
export function decimal(s: string): Rational {
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a plain decimal literal: ${s}`);
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  return reduce({ num: (neg ? -1n : 1n) * BigInt(i + f), den: 10n ** BigInt(f.length) });
}

/**
 * Hypergeometric weight w(k) = C(n,k)·C(N−n,d−k); P(k) = w(k) / C(N,d). Returned as integers so a
 * caller can check the law's identities without a single division.
 */
export function hypergeometricWeights(N: number, d: number, n: number): bigint[] {
  return Array.from({ length: n + 1 }, (_, k) => binom(n, k) * binom(N - n, d - k));
}

/** Exact RTP = Σ_k w(k)·m(k) / C(N,d) for a row of decimal-literal multipliers. */
export function exactRtp(weights: bigint[], total: bigint, multiplierLiterals: string[]): Rational {
  let acc: Rational = { num: 0n, den: 1n };
  weights.forEach((w, k) => { acc = add(acc, mul({ num: w, den: 1n }, decimal(multiplierLiterals[k]))); });
  return reduce({ num: acc.num, den: acc.den * total });
}

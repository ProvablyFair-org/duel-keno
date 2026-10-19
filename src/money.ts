/**
 * EXACT MONEY ON THE DECLARED GRID (profile KENO-11 / KENO-13).
 *
 * Duel serves every money and multiplier figure as a decimal STRING. The settlement rule was
 * measured on the whole capture (5,100 / 5,100 bets) before it was adopted here:
 *
 *   served multiplier  = the table cell, rounded half-up to MULTIPLIER_DP = 13 decimal places,
 *                        printed without trailing zeros (Number(cell.toFixed(13)).toString());
 *   amount_won         = amount × that 13-dp multiplier, EXACTLY — no further rounding;
 *   amount_currency    = amount (the 18-dp echo of the stake).
 *
 * Every comparison below is on integers (BigInt): a string that is not a plain decimal, or that
 * carries more places than the grid, is an error and never silently rounded. There is no tolerance.
 */

/** Decimal places the operator displays and credits a multiplier at (measured, see header). */
export const MULTIPLIER_DP = 13;
/** Decimal places of the money grid: response.amount_currency is an 18-dp string. */
export const MONEY_DP = 18;

/** Parse a plain decimal string to integer units of 10^-dp. Throws if off the grid. */
export function toUnits(s: string, dp: number): bigint {
  if (typeof s !== 'string' || !/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a plain decimal string: ${JSON.stringify(s)}`);
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  if (f.length > dp) throw new Error(`${s} carries ${f.length} decimal places, more than the ${dp}-dp grid`);
  const v = BigInt(i + f.padEnd(dp, '0'));
  return neg ? -v : v;
}

/** The served-multiplier string the declared display rounding produces for a table cell. */
export function displayMultiplier(cell: number): string {
  return Number(cell.toFixed(MULTIPLIER_DP)).toString();
}

/**
 * The payout the declared settlement rule credits, in units of 10^-(MONEY_DP + MULTIPLIER_DP):
 * amount (MONEY_DP grid) × displayMultiplier(cell) (MULTIPLIER_DP grid), exact.
 */
export function settledPayoutUnits(amount: string, cell: number): bigint {
  return toUnits(amount, MONEY_DP) * toUnits(displayMultiplier(cell), MULTIPLIER_DP);
}

/** A served amount_won on the same scale as settledPayoutUnits. */
export function servedPayoutUnits(amountWon: string): bigint {
  return toUnits(amountWon, MONEY_DP) * 10n ** BigInt(MULTIPLIER_DP);
}

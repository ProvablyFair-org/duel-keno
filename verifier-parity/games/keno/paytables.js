/**
 * Duel Keno payout tables — extracted verbatim from the audit repo:
 *   https://github.com/ProvablyFair-org/duel-keno/blob/main/kenoConfig.json
 *
 * Shape: PAYOUT_TABLES[risk][picksCount] = [m0, m1, ..., mPicksCount]
 *   where mH is the multiplier when the player's picks contain `H` of the
 *   10 drawn numbers.
 *
 * Risk levels in display order match Duel's UI: Classic, Low, Medium, High.
 *
 * Verified: 5,100 / 5,100 captured bets in the audit dataset produce the
 * exact recorded multiplier when looked up from this table.
 */

export const RISK_LEVELS = ['classic', 'low', 'medium', 'high'];

export const RISK_LABELS = {
  classic: 'Classic',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

// Duel's API uses an integer difficulty code; the audit dataset confirms
// this mapping. Kept here so derive() can accept either form.
export const RISK_BY_DIFFICULTY_CODE = {
  1: 'classic',
  2: 'low',
  3: 'medium',
  4: 'high',
};

export const PAYOUT_TABLES = {
  classic: {
    1:  [0, 3.996],
    2:  [0, 1.92, 4.516],
    3:  [0, 1.01, 3.12, 10.5385],
    4:  [0, 0.81, 1.81, 5.042183333333331, 23],
    5:  [0, 0.25, 1.4, 4.150066896551724, 17, 37],
    6:  [0, 0, 1, 3.722725, 7.1, 17, 50],
    7:  [0, 0, 0.47, 3.01, 4.524898592540465, 15, 32, 70],
    8:  [0, 0, 0, 2.21, 4.050489068730942, 13.1, 23, 60, 100],
    9:  [0, 0, 0, 1.56, 3.0213807244874564, 8.1, 15.5, 45, 65, 100],
    10: [0, 0, 0, 1.4, 2.2658709289192838, 4.6, 8.2, 18, 55, 100, 200],
  },
  low: {
    1:  [0.71, 1.866],
    2:  [0, 2, 3.982666666666667],
    3:  [0, 1.11, 1.4, 26.2635],
    4:  [0, 0, 2.22, 7.951975, 91.5],
    5:  [0, 0, 1.51, 4.242394482758621, 13.2, 305],
    6:  [0, 0, 1.11, 2.0157314655172414, 6.25, 101, 710],
    7:  [0, 0, 1.1, 1.6, 3.5305998592540457, 16, 230, 800],
    8:  [0, 0, 1.1, 1.512889475706286, 2.05, 5.55, 40, 110, 850],
    9:  [0, 0, 1.11, 1.3041712421933112, 1.71, 2.55, 7.6, 55, 300, 1100],
    10: [0, 0, 1.11, 1.216995957780725, 1.31, 1.81, 3.6, 14, 60, 300, 1200],
  },
  medium: {
    1:  [0.41, 2.766],
    2:  [0, 1.8, 5.316],
    3:  [0, 0, 2.84, 50.301],
    4:  [0, 0, 1.71, 10.1126, 102],
    5:  [0, 0, 1.41, 4.049291034482759, 14.1, 395],
    6:  [0, 0, 0, 3.0262810344827584, 9.05, 182, 750],
    7:  [0, 0, 0, 2, 7.03260197044335, 31, 405, 850],
    8:  [0, 0, 0, 2.01, 4.035047673782158, 11.1, 68, 450, 1000],
    9:  [0, 0, 0, 2, 2.5162327374018667, 5.1, 16, 110, 550, 1100],
    10: [0, 0, 0, 1.6070403763139798, 2.01, 4.1, 7.1, 27, 110, 600, 1200],
  },
  high: {
    1:  [0, 3.996],
    2:  [0, 0, 17.316],
    3:  [0, 0, 0, 82.251],
    4:  [0, 0, 0, 10.135725, 261],
    5:  [0, 0, 0, 4.518773793103448, 48.5, 460],
    6:  [0, 0, 0, 0, 11.1212, 352, 750],
    7:  [0, 0, 0, 0, 7.052904574243491, 90.5, 410, 900],
    8:  [0, 0, 0, 0, 5.015563429509735, 20.1, 275, 620, 1000],
    9:  [0, 0, 0, 0, 4.007382650555064, 11.1, 57, 510, 1000, 1200],
    10: [0, 0, 0, 0, 3.5071122039733673, 8.1, 13.1, 64, 600, 1000, 1200],
  },
};

export const GRID_SIZE = 40;
export const DRAWN_COUNT = 10;
export const MIN_PICKS = 1;
export const MAX_PICKS = 10;

/**
 * Multiplier for a (risk, picksCount, hits) triple.
 * Throws on invalid inputs so caller can show a friendly message.
 */
export function paytable(risk, picksCount, hits) {
  const row = PAYOUT_TABLES[risk]?.[picksCount];
  if (!row) throw new Error(`No payout row for risk=${risk}, picks=${picksCount}`);
  if (hits < 0 || hits > picksCount) throw new Error(`hits=${hits} out of range for picks=${picksCount}`);
  return row[hits];
}

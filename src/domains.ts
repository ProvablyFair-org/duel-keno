/**
 * Duel.com Keno — VALUE DOMAINS for every numeric leaf of the committed artifacts of record
 * (profile KENO-27). Ported in shape from Duel Dice src/domains.ts, 2026-09-25.
 *
 * WHY. The SHA-256 pin proves an artifact's bytes have not moved since they were pinned; a forger
 * who doctors a scalar re-pins the file in the same change. A physically impossible value (a
 * negative count, a p-value above 1, a mismatch count larger than the population) must therefore be
 * rejected by a bound that does NOT come from the artifact itself.
 *
 * THE RULE. Every bound is derived from src/ — the audited population in src/loader.ts, the grid in
 * src/rng.ts, the simulation design constants below (which src/simulate.ts uses) and the pinned
 * paytable's largest cell — never from the artifact being checked.
 *
 * REJECT ONLY THE IMPOSSIBLE. A genuine result is never rejected for being surprising: an RTP window
 * above 100% is possible (bounded by the largest multiplier), a z-score is unbounded, a
 * correlation can be negative. Step 21 asserts BOTH directions on every run: every numeric leaf
 * satisfies its domain, AND every numeric leaf path is covered by a rule — a new numeric field with
 * no declared domain FAILs, so the class cannot reopen quietly.
 */

import { GRID_SIZE, DRAWN_COUNT } from './rng';
import { EXPECTED_BETS, EXPECTED_REVEALED_EPOCHS, EPOCH_SIZE } from './loader';

/** src/simulate.ts design constants (ROUNDS_PER_CONFIG, NONCES_PER_SEED, EPOCH_LENGTH). */
export const SIM_ROUNDS_PER_CONFIG = 1_000_000;
export const SIM_NONCES_PER_SEED = 10_000;
export const SIM_EARLY_WINDOW = 50;
export const CONFIGS = 40;
export const MAX_PICKS = 10;
export const PAYOUT_CELLS = 260;
/** Largest multiplier any cell of a Keno table may hold for the RTP-type bounds: generous by design. */
export const MAX_MULTIPLIER_BOUND = 1_000_000;

export interface Domain { readonly label: string; readonly ok: (v: number) => boolean }
const D = (label: string, ok: (v: number) => boolean): Domain => ({ label, ok });

const FINITE = D('a finite number', v => Number.isFinite(v));
const NONNEG = D('a non-negative real', v => Number.isFinite(v) && v >= 0);
const PROB = D('a probability in [0,1]', v => Number.isFinite(v) && v >= 0 && v <= 1);
const CORR = D('a correlation in [-1,1]', v => Number.isFinite(v) && v >= -1 && v <= 1);
const exactly = (t: number, what: string) => D(`exactly ${t} (${what})`, v => v === t);
const intIn = (lo: number, hi: number, what: string) => D(`an integer in [${lo}, ${hi}] (${what})`, v => Number.isInteger(v) && v >= lo && v <= hi);
const realIn = (lo: number, hi: number, what: string) => D(`a real in [${lo}, ${hi}] (${what})`, v => Number.isFinite(v) && v >= lo && v <= hi);
const RTP = realIn(0, MAX_MULTIPLIER_BOUND, 'an RTP is a mean multiplier');
const MULT = realIn(0, MAX_MULTIPLIER_BOUND, 'a multiplier');

export interface Rule { file: string; path: RegExp; domain: Domain }

/** Path syntax: dotted keys, arrays as [i]. Matched against the WHOLE path. */
export function domainRules(): Rule[] {
  const R = (file: string, path: string, domain: Domain): Rule => ({ file, path: new RegExp(`^${path}$`), domain });
  const S = 'simulation-results.json', C = 'chi-squared-results.json', L = 'determinism-log.json', P = 'payout-coverage.json';
  const p1 = 'pass1_fresh_seeds', p2 = 'pass2_casino_seeds', I = '\\[\\d+\\]';
  return [
    R(S, `${p1}\\.roundsPerConfig`, exactly(SIM_ROUNDS_PER_CONFIG, 'src/simulate.ts ROUNDS_PER_CONFIG')),
    R(S, `${p1}\\.totalRounds`, exactly(SIM_ROUNDS_PER_CONFIG * CONFIGS, 'rounds × 40 configs')),
    R(S, `${p1}\\.configs`, exactly(CONFIGS, '4 risks × picks 1–10')),
    R(S, `${p1}\\.(avgTheoreticalRTP|avgSimulatedRTP)`, RTP),
    R(S, `${p1}\\.(chi2FailsAtAlpha01|chi2FailsBonferroni|serialIndependenceFails)`, intIn(0, CONFIGS, 'a count of configs')),
    R(S, `${p1}\\.results${I}\\.picks`, intIn(1, MAX_PICKS, 'picks')),
    R(S, `${p1}\\.results${I}\\.rounds`, exactly(SIM_ROUNDS_PER_CONFIG, 'rounds per config')),
    R(S, `${p1}\\.results${I}\\.(theoreticalRTP|simulatedRTP)`, RTP),
    R(S, `${p1}\\.results${I}\\.hitCounts${I}`, intIn(0, SIM_ROUNDS_PER_CONFIG, 'a hit-count bin')),
    R(S, `${p1}\\.results${I}\\.expectedCounts${I}`, realIn(0, SIM_ROUNDS_PER_CONFIG, 'an expected bin count')),
    R(S, `${p1}\\.results${I}\\.chi2`, NONNEG),
    R(S, `${p1}\\.results${I}\\.df`, intIn(0, MAX_PICKS, 'chi² degrees of freedom')),
    R(S, `${p1}\\.results${I}\\.(pValue|runsPValue)`, PROB),
    R(S, `${p1}\\.results${I}\\.r1`, CORR),
    R(S, `${p1}\\.results${I}\\.(r1Z|runsZ)`, FINITE),
    R(S, `${p1}\\.results${I}\\.numberCounts${I}`, intIn(0, SIM_ROUNDS_PER_CONFIG, 'a number is drawn at most once per round')),
    R(S, `${p1}\\.results${I}\\.uniformity\\.(chi2|correctedChi2)`, NONNEG),
    R(S, `${p1}\\.results${I}\\.uniformity\\.df`, exactly(GRID_SIZE - 1, 'grid − 1')),
    R(S, `${p1}\\.results${I}\\.uniformity\\.pValue`, PROB),
    R(S, `${p1}\\.results${I}\\.serial\\.pairSum`, intIn(0, SIM_ROUNDS_PER_CONFIG * MAX_PICKS * MAX_PICKS, 'Σ x_t·x_{t+1}')),
    R(S, `${p1}\\.results${I}\\.serial\\.(first|last)`, intIn(0, MAX_PICKS, 'a hit count')),
    R(S, `${p1}\\.results${I}\\.serial\\.runs`, intIn(1, SIM_ROUNDS_PER_CONFIG, 'runs in a sequence')),
    R(S, `${p1}\\.results${I}\\.serial\\.median`, realIn(0, MAX_PICKS, 'a median hit count')),
    R(S, `${p1}\\.results${I}\\.serial\\.n1`, intIn(0, SIM_ROUNDS_PER_CONFIG, 'a count of rounds')),
    R(S, `${p1}\\.(uniformityFailsAtAlpha01|uniformityFailsBonferroni)`, intIn(0, CONFIGS, 'a count of configs')),
    R(S, `${p2}\\.results${I}\\.(fullCounts|earlyCounts|lateCounts)${I}`, intIn(0, SIM_NONCES_PER_SEED, 'a histogram bin')),
    R(S, `${p1}\\.convergence${I}\\.roundsPerConfig`, intIn(1, SIM_ROUNDS_PER_CONFIG, 'a sample point')),
    R(S, `${p1}\\.convergence${I}\\.meanRTP`, RTP),
    R(S, `${p1}\\.convergence${I}\\.stdDev`, NONNEG),
    R(S, `${p2}\\.seeds_tested`, exactly(EXPECTED_REVEALED_EPOCHS, 'revealed epochs in src/loader.ts')),
    R(S, `${p2}\\.nonces_per_seed`, exactly(SIM_NONCES_PER_SEED, 'src/simulate.ts NONCES_PER_SEED')),
    R(S, `${p2}\\.epoch_length`, exactly(EPOCH_SIZE, 'EPOCH_SIZE in src/loader.ts')),
    R(S, `${p2}\\.seed_config_combinations`, intIn(1, EXPECTED_REVEALED_EPOCHS * CONFIGS, 'seed × config combinations')),
    R(S, `${p2}\\.(test_a_chi2_fails_at_alpha01|test_b_cherry_pick_flags)`, intIn(0, EXPECTED_REVEALED_EPOCHS * CONFIGS, 'a count of combinations')),
    R(S, `${p2}\\.(test_a_binomial_pValue|test_b_binomial_pValue)`, PROB),
    R(S, `${p2}\\.results${I}\\.picks`, intIn(1, MAX_PICKS, 'picks')),
    R(S, `${p2}\\.results${I}\\.(full_range_chi2|early_chi2|late_chi2)`, NONNEG),
    R(S, `${p2}\\.results${I}\\.(full_range_p|early_p|late_p)`, PROB),
    R(S, `${p2}\\.results${I}\\.(full_range_df|early_df|late_df)`, intIn(0, MAX_PICKS, 'chi² degrees of freedom')),
    R(C, `configs${I}\\.picks`, intIn(1, MAX_PICKS, 'picks')),
    R(C, `configs${I}\\.n`, intIn(1, EXPECTED_BETS, 'bets in a config')),
    R(C, `configs${I}\\.chi2`, NONNEG),
    R(C, `configs${I}\\.df`, intIn(0, MAX_PICKS, 'chi² degrees of freedom')),
    R(C, `configs${I}\\.pValue`, PROB),
    R(C, `configs${I}\\.observed${I}`, intIn(0, EXPECTED_BETS, 'an observed bin')),
    R(C, `configs${I}\\.expected${I}`, realIn(0, EXPECTED_BETS, 'an expected bin')),
    R(L, 'verified', exactly(EXPECTED_BETS, 'EXPECTED_BETS')),
    R(L, '(mismatches|skipped)', intIn(0, EXPECTED_BETS, 'a count of bets')),
    R(P, 'configs', exactly(CONFIGS, '40 configurations')),
    R(P, 'minBetsPerConfig', intIn(1, EXPECTED_BETS, 'the per-config floor')),
    R(P, 'betsPerConfig\\.[A-Z]+\\|\\d+', intIn(0, EXPECTED_BETS, 'bets in a config')),
    R(P, 'totalPayoutCells', exactly(PAYOUT_CELLS, 'Σ (picks + 1) over 40 configs')),
    R(P, '(cellsExercisedByLivePlay|cellsNeverExercised)', intIn(0, PAYOUT_CELLS, 'a count of cells')),
    R(P, 'uncoveredRtpShareOfTotal', PROB),
    R(P, `uncoveredCells${I}\\.picks`, intIn(1, MAX_PICKS, 'picks')),
    R(P, `uncoveredCells${I}\\.hits`, intIn(0, Math.min(MAX_PICKS, DRAWN_COUNT), 'hits')),
    R(P, `uncoveredCells${I}\\.probability`, PROB),
    R(P, `uncoveredCells${I}\\.multiplier`, MULT),
    R(P, `uncoveredCells${I}\\.rtpContribution`, RTP),
  ];
}

/** Numeric leaves of a JSON value as path → number. */
function numericLeaves(v: unknown, p = '', out: Array<[string, number]> = []): Array<[string, number]> {
  if (typeof v === 'number') out.push([p, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => numericLeaves(x, `${p}[${i}]`, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) numericLeaves((v as Record<string, unknown>)[k], p ? `${p}.${k}` : k, out);
  return out;
}

export interface DomainReport { file: string; leaves: number; violations: string[]; uncovered: string[] }

/** Check one committed artifact in both directions. */
export function validateDomains(file: string, json: unknown, rules = domainRules()): DomainReport {
  const mine = rules.filter(r => r.file === file);
  const violations: string[] = [], uncovered: string[] = [];
  const leaves = numericLeaves(json);
  for (const [path, value] of leaves) {
    const rule = mine.find(r => r.path.test(path));
    if (!rule) { uncovered.push(path); continue; }
    if (!rule.domain.ok(value)) violations.push(`${path} = ${value} is not ${rule.domain.label}`);
  }
  return { file, leaves: leaves.length, violations, uncovered };
}

/** Grid sanity the domains rest on, exported for the unit tests. */
export const DOMAIN_GRID = { GRID_SIZE, DRAWN_COUNT };

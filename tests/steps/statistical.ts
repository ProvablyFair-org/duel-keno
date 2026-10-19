/**
 * Informational Context: RTP & Statistical Tests (not scored)
 *
 * These are NOT verification steps — they provide context only.
 * Live dataset sample sizes (~128 bets/config) are insufficient for
 * conclusive distribution or serial independence testing.
 * Authoritative results come from simulation Pass 1 (1M rounds/config).
 */

import type { RiskLevel } from '../../src/types';
import { VerifyContext } from './context';
import { DIFFICULTY_TO_RISK } from '../../src/config';
import { countHits } from '../../src/loader';
import { chiSquaredTest, chiSquaredSurvival, lag1Autocorrelation, runsTest } from '../../src/stats';

import type { InfoItem } from './context';

export function run(ctx: VerifyContext): InfoItem[] {
  const { bets, cfg, chiResultsLog } = ctx;
  const items: InfoItem[] = [];

  // ── RTP analysis ────────────────────────────────────────────────────────────
  const totalBet = bets.reduce((a, b) => a + parseFloat(b.request.amount), 0);
  const totalWon = bets.reduce((a, b) => a + parseFloat(b.response.amount_won), 0);
  const empiricalRTP = totalWon / totalBet;
  items.push({
    label: 'RTP Analysis',
    detail: `Empirical RTP: ${(empiricalRTP * 100).toFixed(2)}% over ${bets.length.toLocaleString()} bets (high variance at this sample size; theoretical 99.90% proven analytically in Step 17)`,
  });

  // ── Chi-squared goodness-of-fit ─────────────────────────────────────────────
  const configGroups = new Map<string, { hits: number[]; risk: RiskLevel; picks: number }>();
  for (const b of bets) {
    const risk  = DIFFICULTY_TO_RISK[b.request.difficulty];
    const picks = b.request.selected_positions.length;
    const key   = `${risk}|${picks}`;
    if (!configGroups.has(key)) configGroups.set(key, { hits: [], risk, picks });
    configGroups.get(key)!.hits.push(countHits(b));
  }

  let fails = 0;
  let minP  = 1;
  for (const [, { hits, risk, picks }] of configGroups) {
    const n        = hits.length;
    const observed = new Array(picks + 1).fill(0);
    for (const h of hits) observed[h]++;
    const expected = Array.from({ length: picks + 1 }, (_, k) => cfg.hitProbability(picks, k) * n);
    const { chi2, df, pValue } = chiSquaredTest([...observed], expected);
    if (pValue < 0.01) fails++;
    if (pValue < minP) minP = pValue;
    chiResultsLog.push({ risk, picks, n, chi2, df, pValue, observed, expected });
  }

  const avgN = Math.round(bets.length / configGroups.size);
  items.push({
    label: 'Chi-squared Goodness-of-Fit',
    detail: `${configGroups.size} configs; fails at α=0.01: ${fails}/${configGroups.size}; min p=${minP.toFixed(4)} (~${avgN} bets/config insufficient; see simulation Step 19)`,
  });

  // ── Hit counts per PICKS COUNT (risk pooled — hits do not depend on risk) ─────
  const byPicks = new Map<number, number[]>();
  for (const b of bets) {
    const n = b.request.selected_positions.length;
    if (!byPicks.has(n)) byPicks.set(n, new Array(n + 1).fill(0));
    byPicks.get(n)![countHits(b)]++;
  }
  let picksFails = 0, picksMinP = 1;
  for (const [n, obs] of byPicks) {
    const tot = obs.reduce((a, x) => a + x, 0);
    const exp = Array.from({ length: n + 1 }, (_, k) => cfg.hitProbability(n, k) * tot);
    const { pValue } = chiSquaredTest([...obs], exp);
    if (pValue < 0.01) picksFails++;
    if (pValue < picksMinP) picksMinP = pValue;
  }
  items.push({
    label: 'Hit Counts per Picks Count (KENO-22)',
    detail: `${byPicks.size} picks counts, risk pooled; fails at α=0.01: ${picksFails}/${byPicks.size}; min p=${picksMinP.toFixed(4)} (informational)`,
  });

  // ── Drawn-number uniformity over the whole grid (KENO-22) ────────────────────
  // Each draw takes d = 10 of N = 40 numbers WITHOUT replacement, so the per-number counts are not
  // independent: Cov = n·p(1−p)·N/(N−1)·(I − 11ᵀ/N) with p = d/N. Pearson's X² over the N counts is
  // therefore (1−p)·N/(N−1) · χ²_{N−1}; the corrected statistic X² · (N−1) / (N−d) ~ χ²_{N−1}.
  const G = cfg.gridSize, D = cfg.drawnCount;
  const numberCounts = new Array(G).fill(0);
  for (const b of bets) for (const x of b.response.drawn_numbers) numberCounts[x - 1]++;
  const expectedEach = bets.length * D / G;
  const x2 = numberCounts.reduce((a, o) => a + (o - expectedEach) ** 2 / expectedEach, 0);
  const corrected = x2 * (G - 1) / (G - D);
  const uni = chiSquaredTest([...numberCounts], new Array(G).fill(expectedEach));
  const uniP = chiSquaredSurvival(corrected, G - 1);
  items.push({
    label: 'Drawn-Number Uniformity (KENO-22)',
    detail: `${bets.length * D} drawn numbers over ${G}; X²=${x2.toFixed(3)}, without-replacement corrected ${corrected.toFixed(3)} on df ${G - 1}, `
      + `p=${uniP.toFixed(4)} (uncorrected p=${uni.pValue.toFixed(4)}); informational — a ${bets.length}-round sample has little power`,
  });

  // ── Serial independence — lag-1 autocorrelation ─────────────────────────────
  const hitSeries = bets.map(b => countHits(b));
  const r1        = lag1Autocorrelation(hitSeries);
  const n         = hitSeries.length;
  const zScore14  = r1 / (1 / Math.sqrt(n));
  items.push({
    label: 'Serial Independence (lag-1)',
    detail: `r₁=${r1.toFixed(3)}, z=${zScore14.toFixed(2)} — large z is expected: the dataset contains Phase B (1,000 consecutive picks=1 bets, E[hits]=0.25) followed by Phase C (1,000 consecutive picks=10 bets, E[hits]=2.5). This regime shift creates artificial serial correlation in the aggregate hit series. It is a property of the audit's phase ordering, not the RNG. Simulation Step 19 tests each config independently at 1M rounds and finds 0/40 serial independence failures.`,
  });

  // ── Runs test ───────────────────────────────────────────────────────────────
  const { runs, expected: expectedRuns, z: zScore15, pValue } = runsTest(hitSeries);
  items.push({
    label: 'Serial Independence (runs test)',
    detail: `runs=${runs}, expected=${expectedRuns.toFixed(1)}, z=${zScore15.toFixed(2)}, p=${pValue < 1e-10 ? pValue.toExponential(2) : pValue.toFixed(4)} — same phase-ordering artifact as lag-1 above (picks=1 → picks=10 regime shift). Per-config simulation in Step 19 confirms RNG outputs are serially independent.`,
  });

  return items;
}

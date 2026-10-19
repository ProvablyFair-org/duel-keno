/**
 * Steps 19–20: Simulation Results
 *
 * NEITHER STEP TRUSTS A SIMULATOR SCALAR. outputs/simulation-results.json ships the per-config
 * (Pass 1) and per-seed×config (Pass 2) rows the summary scalars were computed from. Every count
 * the verdict rests on is re-derived here from those rows, the scalars are cross-checked against
 * the re-derivation, and a scalar that is ABSENT is a FAIL — `?? 0` would forgive a deleted field
 * as "zero failures". The row populations are bound to the configuration table (Pass 1) and to
 * the captured dataset (Pass 2), so an emptied or truncated results array cannot pass on
 * "0 fails".
 *
 * Since 2026-09-25 (KENO-20 / KENO-21) nothing is only range-checked: the Pass 1 serial statistics
 * are re-derived from shipped integer sufficient statistics, grid uniformity from shipped per-number
 * counts, the Pass 2 p-values from shipped histograms; Pass 1's first 1,000 rounds and Pass 2's early
 * window are replayed; and Step 20 scores the return of the served bets against its exact null.
 */

import * as fs   from 'fs';
import * as path from 'path';

import type { StepResult } from './context';
import type { RiskLevel } from '../../src/types';
import { step, VerifyContext } from './context';
import { DIFFICULTY_TO_RISK } from '../../src/config';
import { chiSquaredTest, chiSquaredSurvival, binomSurvival, medianFromHistogram, runsFromCounts } from '../../src/stats';
import { computeDrawFromBuffer } from '../../src/rng';
import { SIM_SEEDS } from '../../src/sim-seeds';
import { EXPECTED_REVEALED_EPOCHS } from '../../src/loader';
import { binom, hypergeometricWeights, decimal, add, mul, sub, toNumber, Rational } from '../../src/exact';
import { numbersAgree } from '../../src/diff';

/**
 * A RECOMPUTED p-value (or the chi² beside it) against the shipped one: the reproduction rule,
 * 1e-14 absolute + 1e-12 relative (src/diff.ts numbersAgree), not bit equality. The p comes from
 * Math.exp / Math.log inside the incomplete gamma, and those are not bit-identical across
 * platforms: on Linux (node:22, x64 and arm64) 22 of the 1,666 Pass 2 rows recompute a full / late
 * p that is 1 ulp (≤ 1.12e-16 absolute, ≤ 4.1e-16 relative) off the value macOS arm64 shipped,
 * with every chi² identical — measured 2026-09-28, GitHub Actions run 36466858888. A shipped value
 * that differs by more than the bound still FAILs (mutation M20e); integer pairs (df) stay exact.
 */
const agree = (a: unknown, b: unknown): boolean => isNum(a) && isNum(b) && numbersAgree(a, b);

/** Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7) — used only for the PRINTED CLT p beside the bootstrap p. */
function erfApprox(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.sign(x) * y;
}

/** Two-tailed critical z for a given alpha (Abramowitz & Stegun 26.2.23). */
function inverseCriticalZ(alpha: number): number {
  const p = alpha / 2;
  const t = Math.sqrt(-2 * Math.log(p));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

interface Pass1Row {
  risk: string; picks: number; rounds: number; simulatedRTP: number;
  hitCounts: number[]; expectedCounts: number[]; chi2: number; df: number; pValue: number;
  r1Z: number; runsPValue: number;
}
interface Pass2Row {
  seed_hash: string; risk: string; picks: number;
  full_range_p: number; early_p: number; late_p: number; cherry_pick_flag: boolean;
}

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir, cfg, bets, seedMap } = ctx;
  const simPath = path.join(outputsDir, 'simulation-results.json');

  // A missing artifact means neither step decided anything. That is a FAIL, not a FLAG that exits 2.
  if (!fs.existsSync(simPath)) {
    return [
      step(19, 'Simulation Results — Pass 1 Integrity', 'FAIL',
        'outputs/simulation-results.json not found — Pass 1 was not scored'),
      step(20, 'Simulation Results — Pass 2 Cherry-Pick Test', 'FAIL',
        'outputs/simulation-results.json not found — Pass 2 was not scored'),
    ];
  }

  const sim   = JSON.parse(fs.readFileSync(simPath, 'utf-8'));
  const allConfigs = cfg.allConfigs();
  const NCFG  = allConfigs.length;

  // ── Step 19: Pass 1 integrity ─────────────────────────────────────────────────
  const pass1 = sim.pass1_fresh_seeds ?? {};
  const rows: Pass1Row[] = Array.isArray(pass1.results) ? pass1.results : [];
  const p1Issues: string[] = [];

  if (!Array.isArray(pass1.results)) p1Issues.push('pass1_fresh_seeds.results is absent');
  if (rows.length !== NCFG) p1Issues.push(`${rows.length} Pass 1 rows != ${NCFG} configurations in kenoConfig.json`);
  if (pass1.configs !== NCFG) p1Issues.push(`configs scalar ${JSON.stringify(pass1.configs)} != ${NCFG}`);
  const rowKeys = new Set(rows.map(r => `${r.risk}|${r.picks}`));
  const missingCfg = allConfigs.filter(({ risk, picks }) => !rowKeys.has(`${risk}|${picks}`));
  if (missingCfg.length > 0 || rowKeys.size !== rows.length) {
    p1Issues.push(`${missingCfg.length} configuration(s) without a row, ${rows.length - rowKeys.size} duplicate row(s)`);
  }
  const roundsPer = pass1.roundsPerConfig;
  if (!isNum(roundsPer) || roundsPer <= 0) p1Issues.push(`roundsPerConfig ${JSON.stringify(roundsPer)} is not a positive number`);
  if (!isNum(pass1.totalRounds) || pass1.totalRounds !== roundsPer * NCFG) {
    p1Issues.push(`totalRounds ${JSON.stringify(pass1.totalRounds)} != roundsPerConfig × ${NCFG}`);
  }

  // Per-row recomputation from the shipped hit histogram:
  //   - the histogram must hold exactly `rounds` rounds;
  //   - chi² / p are recomputed against expected counts derived HERE from the independent
  //     hypergeometric model (not the row's own expectedCounts) — same code path, compared at the
  //     reproduction bound (agree() above: libm drift is 1 ulp, a forgery is not);
  //   - simulatedRTP is recomputed as Σ counts[k]·mult(k) / rounds. The simulator summed
  //     1,000,000 multipliers one at a time, whose rounding error is at most (n−1)·ε of the
  //     total; the bound is n·ε relative (2.22e-10 at n = 1e6), stated, not guessed.
  let badRows = 0, chiMismatch = 0, rtpMismatch = 0, nonFinite = 0;
  let chi2FailsRecount = 0, serialFailsRecount = 0;
  const bonAlpha = 0.01 / NCFG;
  const bonZCrit = inverseCriticalZ(bonAlpha);
  let failsBon = 0, serialBonFails = 0;
  let rtpSum = 0;
  for (const r of rows) {
    if (!isNum(r.pValue) || !isNum(r.r1Z) || !isNum(r.runsPValue) || !isNum(r.simulatedRTP) || !Array.isArray(r.hitCounts)) {
      nonFinite++; continue;
    }
    rtpSum += r.simulatedRTP;
    if (r.pValue < 0.01) chi2FailsRecount++;
    if (Math.abs(r.r1Z) > 3 || r.runsPValue < 0.01) serialFailsRecount++;
    if (r.pValue < bonAlpha) failsBon++;
    if (Math.abs(r.r1Z) > bonZCrit || r.runsPValue < bonAlpha) serialBonFails++;

    const risk = r.risk as RiskLevel;
    const n = r.hitCounts.reduce((a, c) => a + c, 0);
    if (r.rounds !== roundsPer || n !== roundsPer || r.hitCounts.length !== r.picks + 1) { badRows++; continue; }
    const expected = Array.from({ length: r.picks + 1 }, (_, k) => cfg.hitProbability(r.picks, k) * n);
    const chi = chiSquaredTest([...r.hitCounts], expected);
    if (!agree(chi.chi2, r.chi2) || !agree(chi.pValue, r.pValue) || chi.df !== r.df) chiMismatch++;
    let payout = 0;
    try {
      for (let k = 0; k <= r.picks; k++) payout += r.hitCounts[k] * cfg.multiplier(risk, r.picks, k);
    } catch { rtpMismatch++; continue; }
    const rtp = payout / n;
    if (Math.abs(rtp - r.simulatedRTP) > n * Number.EPSILON * Math.abs(rtp)) rtpMismatch++;
  }
  if (nonFinite > 0) p1Issues.push(`${nonFinite} row(s) with a non-finite pValue / r1Z / runsPValue / simulatedRTP`);
  if (badRows > 0) p1Issues.push(`${badRows} row(s) whose hit histogram does not hold roundsPerConfig rounds`);
  if (chiMismatch > 0) p1Issues.push(`${chiMismatch} row(s) whose chi²/p does not recompute from its hit histogram`);
  if (rtpMismatch > 0) p1Issues.push(`${rtpMismatch} row(s) whose simulatedRTP does not recompute from its hit histogram`);

  // Summary scalars: required, and must agree with the recount.
  const fails       = pass1.chi2FailsAtAlpha01;
  const serialFails = pass1.serialIndependenceFails;
  if (!isNum(fails)) p1Issues.push('chi2FailsAtAlpha01 is ABSENT — a missing count is not zero');
  else if (fails !== chi2FailsRecount) p1Issues.push(`chi2FailsAtAlpha01 ${fails} != ${chi2FailsRecount} recounted from the rows`);
  if (!isNum(serialFails)) p1Issues.push('serialIndependenceFails is ABSENT — a missing count is not zero');
  else if (serialFails !== serialFailsRecount) p1Issues.push(`serialIndependenceFails ${serialFails} != ${serialFailsRecount} recounted from the rows`);
  const avgRecount = rows.length > 0 ? rtpSum / rows.length : NaN;
  if (!isNum(pass1.avgSimulatedRTP) || pass1.avgSimulatedRTP !== avgRecount) {
    p1Issues.push(`avgSimulatedRTP ${JSON.stringify(pass1.avgSimulatedRTP)} != the mean of the rows' simulatedRTP`);
  }


  // ── Step 19, KENO-20 additions (2026-09-25) ───────────────────────────────────
  // (a) GRID UNIFORMITY with the without-replacement correction, re-derived from each row's shipped
  //     per-number counts: X² over the 40 counts, corrected X²·(N−1)/(N−d) ~ χ²_{N−1}; the stored
  //     statistic must equal the recomputation exactly (+ − × ÷ only), the p (incomplete gamma, libm) at the
  //     reproduction bound (agree()), and 0 configs may fail
  //     at the Bonferroni-corrected α — scored, like the hit-histogram chi².
  // (b) SERIAL STATISTICS RE-DERIVED. With the hit histogram (Σx, Σx²) the shipped integers (Σ x_t·x_{t+1},
  //     first, last, runs, median, n1) determine r1 EXACTLY (BigInt) and the runs z / p by the same
  //     formula runsTest uses. The stored r1 (a float sum over 1,000,000 terms) must lie within
  //     SERIAL_R1_TOL = 1e-9 of the exact value — the float error of that sum is below 1e-12 on every
  //     config, and 1e-9 on r1 is 1e-6 on r1Z, six orders under the |r1Z| > 3 decision threshold; the
  //     median must be the histogram's, n1 the histogram's count at or above it, and runsZ / runsPValue
  //     must equal the recomputation: the z exactly (+ − × ÷ √), the p (normalCDF, libm) at the reproduction
  //     bound (agree()).
  // (c) REPLAY. The first 1,000 rounds of every config are replayed from the pinned seed pairs and the
  //     mean RTP at the 1K convergence point must equal the artifact's, bit for bit.
  const SERIAL_R1_TOL = 1e-9;
  const G = cfg.gridSize, Dn = cfg.drawnCount;
  let uniMismatch = 0, uniBad = 0, uniFailsBon = 0, uniFailsA = 0;
  let serialMismatch = 0, serialBad = 0, runsDegenerate = 0, worstR1Gap = 0;
  for (const r of rows as Array<Pass1Row & Record<string, any>>) {
    const nc: unknown = r.numberCounts;
    const n = r.rounds;
    if (!Array.isArray(nc) || nc.length !== G || nc.some(x => !Number.isInteger(x) || x < 0 || x > n)
        || nc.reduce((a: number, x: number) => a + x, 0) !== n * Dn || !r.uniformity) { uniBad++; }
    else {
      const expEach = n * Dn / G;
      let x2 = 0;
      for (const o of nc as number[]) x2 += (o - expEach) ** 2 / expEach;
      const corr = x2 * (G - 1) / (G - Dn);
      const pU = chiSquaredSurvival(corr, G - 1);
      if (x2 !== r.uniformity.chi2 || corr !== r.uniformity.correctedChi2 || !agree(pU, r.uniformity.pValue) || r.uniformity.df !== G - 1) uniMismatch++;
      if (pU < 0.01) uniFailsA++;
      if (pU < bonAlpha) uniFailsBon++;
    }
    const sr = r.serial;
    const hc: number[] = r.hitCounts;
    if (!sr || !Array.isArray(hc) || ![sr.pairSum, sr.first, sr.last, sr.runs, sr.n1].every(Number.isInteger)) { serialBad++; continue; }
    const N = BigInt(n);
    const S1 = hc.reduce((a, c, k) => a + BigInt(k) * BigInt(c), 0n);
    const S2 = hc.reduce((a, c, k) => a + BigInt(k * k) * BigInt(c), 0n);
    const A = S1 - BigInt(sr.last), B = S1 - BigInt(sr.first);
    const num = N * N * BigInt(sr.pairSum) - N * S1 * (A + B) + (N - 1n) * S1 * S1;
    const den = N * (N * S2 - S1 * S1);
    const r1Exact = den === 0n ? 0 : Number(num) / Number(den);
    const gap = Math.abs(r1Exact - r.r1);
    if (gap > worstR1Gap) worstR1Gap = gap;
    const med = medianFromHistogram(hc);
    const n1 = hc.reduce((a, c, k) => a + (k >= med ? c : 0), 0);
    const rz = runsFromCounts(n, n1, sr.runs);
    if (n1 === n) runsDegenerate++;
    if (!(gap <= SERIAL_R1_TOL) || med !== sr.median || n1 !== sr.n1 || sr.runs < 1 || sr.runs > n
        || rz.z !== r.runsZ || !agree(rz.pValue, r.runsPValue) || r.r1Z !== r.r1 / (1 / Math.sqrt(n))) serialMismatch++;
  }
  if (uniBad > 0) p1Issues.push(`${uniBad} row(s) without a valid per-number histogram (40 counts summing to rounds × 10)`);
  if (uniMismatch > 0) p1Issues.push(`${uniMismatch} row(s) whose uniformity statistic / p does not recompute from its per-number counts`);
  if (pass1.uniformityFailsAtAlpha01 !== uniFailsA || pass1.uniformityFailsBonferroni !== uniFailsBon) {
    p1Issues.push(`uniformity fail scalars ${JSON.stringify([pass1.uniformityFailsAtAlpha01, pass1.uniformityFailsBonferroni])} != ${JSON.stringify([uniFailsA, uniFailsBon])} recounted`);
  }
  if (serialBad > 0) p1Issues.push(`${serialBad} row(s) without serial sufficient statistics`);
  if (serialMismatch > 0) p1Issues.push(`${serialMismatch} row(s) whose r1 / runs z / runs p do not re-derive from the shipped integers (r1 bound ${SERIAL_R1_TOL})`);
  // Replay: first 1,000 rounds of every config from the pinned seeds.
  const REPLAY_ROUNDS = 1000;
  let replaySum = 0, replayConfigs = 0;
  for (let ci = 0; ci < allConfigs.length && ci < SIM_SEEDS.length; ci++) {
    const { risk, picks } = allConfigs[ci];
    const key = Buffer.from(SIM_SEEDS[ci].server, 'hex');
    let total = 0;
    for (let nonce = 0; nonce < REPLAY_ROUNDS; nonce++) {
      const d = new Set(computeDrawFromBuffer(key, SIM_SEEDS[ci].client, nonce, G, Dn));
      let h = 0; for (let q = 1; q <= picks; q++) if (d.has(q)) h++;
      total += cfg.multiplier(risk, picks, h);
    }
    replaySum += total / REPLAY_ROUNDS; replayConfigs++;
  }
  const replayMean = replaySum / replayConfigs;
  const conv1k = Array.isArray(pass1.convergence) ? pass1.convergence.find((c: any) => c.roundsPerConfig === REPLAY_ROUNDS) : undefined;
  const replayOk = replayConfigs === NCFG && conv1k !== undefined && conv1k.meanRTP === replayMean;
  if (!replayOk) p1Issues.push(`REPLAY: the first ${REPLAY_ROUNDS} rounds of ${replayConfigs} configs from the pinned seeds give mean RTP ${replayMean}, artifact ${JSON.stringify(conv1k?.meanRTP)}`);

  const pass1Pass = p1Issues.length === 0 && failsBon === 0 && serialBonFails === 0 && uniFailsBon === 0;
  const totalBonFails = failsBon + serialBonFails;
  const totalUncorrected = chi2FailsRecount + serialFailsRecount;
  // The sentence carries the BOUND (α, the Bonferroni divisor, the counts); the measured
  // figures — the simulated RTP, the corrected threshold — go in `data`.
  let summary: string;
  if (p1Issues.length > 0) {
    summary = `Pass 1 artifact does not support its verdict: ${p1Issues.slice(0, 4).join('; ')}`;
  } else {
    summary = `${pass1.totalRounds.toLocaleString()} rounds × ${NCFG} configs; every row's chi²/p and simulated RTP `
      + `recomputed from its shipped hit histogram; grid uniformity (without-replacement corrected X² on 40 numbers) `
      + `recomputed from each row's per-number counts — ${uniFailsBon}/${NCFG} fail at α/${NCFG}; serial r1 re-derived exactly `
      + `from shipped integer sufficient statistics (bound ${SERIAL_R1_TOL}) and runs z / p recomputed; first ${REPLAY_ROUNDS} `
      + `rounds of every config replayed from the pinned seeds, 1K convergence point equal. `
      + `${totalBonFails}/${NCFG} configs fail at the Bonferroni-corrected threshold (α/${NCFG}). `;
    summary += totalUncorrected > 0
      ? `${totalUncorrected}/${NCFG} flag at uncorrected α = 0.01, consistent with expected false-positive rate across ${NCFG} independent tests.`
      : `0/${NCFG} flag even at uncorrected α = 0.01.`;
  }

  const s19 = step(19, 'Simulation Results — Pass 1 Integrity',
    pass1Pass ? 'PASS' : 'FAIL', summary,
    {
      totalRounds: pass1.totalRounds,
      configs: NCFG,
      rows: rows.length,
      avgSimulatedRTP: pass1.avgSimulatedRTP,
      alpha: 0.01,
      bonferroniAlpha: bonAlpha,
      chi2FailsBonferroni: failsBon,
      serialFailsBonferroni: serialBonFails,
      chi2FailsUncorrected: chi2FailsRecount,
      serialFailsUncorrected: serialFailsRecount,
      rowsNotRecomputing: chiMismatch + rtpMismatch + badRows + nonFinite,
      artifactIssues: p1Issues.length,
      uniformityFailsBonferroni: uniFailsBon, uniformityFailsUncorrected: uniFailsA,
      uniformityRowsNotRecomputing: uniMismatch + uniBad,
      serialRowsNotRederiving: serialMismatch + serialBad, serialR1WorstGap: worstR1Gap, serialR1Tolerance: SERIAL_R1_TOL,
      runsTestDegenerateConfigs: runsDegenerate,
      replay: { roundsPerConfig: REPLAY_ROUNDS, configs: replayConfigs, meanRTP: replayMean, matchesArtifact: replayOk },
    },
  );
  if (pass1Pass) console.log(`         ${summary}`);

  // ── Step 20: Pass 2 cherry-pick test ─────────────────────────────────────────
  // Population: one row per (revealed casino seed, risk, picks) actually PLAYED in the captured
  // dataset — derived from the bets here, not from the artifact's own header.
  const pass2 = sim.pass2_casino_seeds ?? {};
  const p2rows: Pass2Row[] = Array.isArray(pass2.results) ? pass2.results : [];
  const p2Issues: string[] = [];

  const playedCombos = new Set<string>();
  for (const b of bets) {
    playedCombos.add(`${b.seed.serverSeedHashed}|${DIFFICULTY_TO_RISK[b.request.difficulty]}|${b.request.selected_positions.length}`);
  }
  const rowCombos = new Set(p2rows.map(r => `${r.seed_hash}|${r.risk}|${r.picks}`));
  const unplayed  = [...rowCombos].filter(k => !playedCombos.has(k)).length;
  const unscored  = [...playedCombos].filter(k => !rowCombos.has(k)).length;
  const seedsInRows = new Set(p2rows.map(r => r.seed_hash));
  const unrevealedSeeds = [...seedsInRows].filter(h => !seedMap.has(h)).length;

  if (!Array.isArray(pass2.results)) p2Issues.push('pass2_casino_seeds.results is absent');
  if (p2rows.length !== playedCombos.size || rowCombos.size !== p2rows.length || unplayed > 0 || unscored > 0) {
    p2Issues.push(`${p2rows.length} rows (${rowCombos.size} distinct) vs ${playedCombos.size} seed×config combinations played `
      + `in the dataset: ${unscored} played but unscored, ${unplayed} scored but never played`);
  }
  if (pass2.seed_config_combinations !== p2rows.length) {
    p2Issues.push(`seed_config_combinations ${JSON.stringify(pass2.seed_config_combinations)} != ${p2rows.length} rows`);
  }
  if (seedsInRows.size !== EXPECTED_REVEALED_EPOCHS || pass2.seeds_tested !== EXPECTED_REVEALED_EPOCHS || unrevealedSeeds > 0) {
    p2Issues.push(`${seedsInRows.size} seeds in the rows (header ${JSON.stringify(pass2.seeds_tested)}), `
      + `${unrevealedSeeds} not among the dataset's revealed seeds; expected ${EXPECTED_REVEALED_EPOCHS}`);
  }

  // Re-score from the rows. Test A: full-range p < 0.01. Test B (cherry-pick): early window
  // significant at 0.05 while the late window is not — the simulator's own rule, re-applied.
  let testARecount = 0, flagsRecount = 0, flagDisagree = 0, p2NonFinite = 0, bothWindows = 0;
  for (const r of p2rows) {
    if (!isNum(r.full_range_p) || !isNum(r.early_p) || !isNum(r.late_p)) { p2NonFinite++; continue; }
    if (r.full_range_p < 0.01) testARecount++;
    const flag = r.early_p < 0.05 && r.late_p >= 0.05;
    if (flag) flagsRecount++;
    if (flag !== r.cherry_pick_flag) flagDisagree++;
    if (r.early_p < 0.05 && r.late_p < 0.05) bothWindows++;
  }
  if (p2NonFinite > 0) p2Issues.push(`${p2NonFinite} row(s) with a non-finite p-value`);
  if (flagDisagree > 0) p2Issues.push(`${flagDisagree} row(s) whose stored cherry_pick_flag disagrees with its own p-values`);
  const testA = pass2.test_a_chi2_fails_at_alpha01;
  const flags = pass2.test_b_cherry_pick_flags;
  if (!isNum(testA)) p2Issues.push('test_a_chi2_fails_at_alpha01 is ABSENT');
  else if (testA !== testARecount) p2Issues.push(`test_a_chi2_fails_at_alpha01 ${testA} != ${testARecount} recounted`);
  if (!isNum(flags)) p2Issues.push('test_b_cherry_pick_flags is ABSENT');
  else if (flags !== flagsRecount) p2Issues.push(`test_b_cherry_pick_flags ${flags} != ${flagsRecount} recounted`);

  // SCORED, both of them: P(X ≥ observed) under H₀ must be ≥ 0.01 (the simulator's own bound).
  const N = p2rows.length;
  const testAP = N > 0 ? binomSurvival(testARecount, N, 0.01) : NaN;
  // Test B tail at 0.05, the simulator's rate (src/simulate.ts): an upper bound on the nominal flag
  // rate 0.05 × 0.95 = 0.0475 (early p < 0.05 AND late p ≥ 0.05, disjoint nonces), so the lenient side.
  const testBP = N > 0 ? binomSurvival(flagsRecount, N, 0.05) : NaN;
  const testAOk = isNum(testAP) && testAP >= 0.01;
  const testBOk = isNum(testBP) && testBP >= 0.01;
  if (!agree(pass2.test_a_binomial_pValue, testAP) || !agree(pass2.test_b_binomial_pValue, testBP)) {
    p2Issues.push('stored binomial p-value(s) do not recompute from the recounted rows');
  }


  // ── Step 20, KENO-21 additions (2026-09-25) ───────────────────────────────────
  // (a) EVERY WINDOW RE-DERIVED. Each row now ships its full / early / late hit histograms; the three
  //     chi² / p values are recomputed here from them against hypergeometric expectations (the
  //     simulator's own code path, compared at the reproduction bound — agree() above), full = early + late elementwise, and the
  //     early window (nonces 0–49 = the captured range) is REPLAYED from the revealed seed for every
  //     row: the recomputed histogram must equal the shipped one.
  // (b) THE RETURN STATISTIC, PRE-REGISTERED. Over the captured early window the configurations the
  //     casino actually served are the captured bets themselves (every one of the 5,100 sits at nonce
  //     0–49 of its epoch, or 0–50 in the two capture-retry epochs — Step 4). Their return R = Σ multiplier(risk, picks, hits on the recomputed draw) is
  //     compared with its exact null: mean Σ μ_c and variance Σ σ²_c from the hypergeometric law and
  //     the table (exact rationals, src/exact.ts). One-sided, operator-favourable (lower) tail; the
  //     null distribution of R is a parametric bootstrap — B = 10,000 replicates, each bet's hits
  //     drawn from its exact hypergeometric law with a fixed-seed generator (mulberry32, seed
  //     0x6b656e6f), so the p-value is reproducible. RULE, fixed before the value was read: FAIL if
  //     the bootstrap p < 0.01. The CLT z and p are printed beside it, and the DETECTION POWER: the
  //     per-bet return deficit δ = (z₀.₉₉ + z₀.₈₀)·√Σσ² / N detectable at 80% power.
  let histBad = 0, histMismatch = 0, earlyReplayMismatch = 0;
  const earlyDrawsBySeed = new Map<string, number[][]>();
  for (const r of p2rows as Array<Pass2Row & Record<string, any>>) {
    const n = r.picks;
    const f: unknown = r.fullCounts, e: unknown = r.earlyCounts, l: unknown = r.lateCounts;
    const okArr = (x: unknown, tot: number) => Array.isArray(x) && x.length === n + 1
      && x.every(v => Number.isInteger(v) && v >= 0) && x.reduce((a: number, v: number) => a + v, 0) === tot;
    const NN = pass2.nonces_per_seed, EW = pass2.epoch_length;
    if (!okArr(f, NN) || !okArr(e, EW) || !okArr(l, NN - EW)
        || (f as number[]).some((v, k) => v !== (e as number[])[k] + (l as number[])[k])) { histBad++; continue; }
    const exp = (tot: number) => Array.from({ length: n + 1 }, (_, k) => cfg.hitProbability(n, k) * tot);
    const cf = chiSquaredTest([...(f as number[])], exp(NN)), ce = chiSquaredTest([...(e as number[])], exp(EW)),
          cl = chiSquaredTest([...(l as number[])], exp(NN - EW));
    if (!agree(cf.chi2, r.full_range_chi2) || !agree(cf.pValue, r.full_range_p) || cf.df !== r.full_range_df
        || !agree(ce.chi2, r.early_chi2) || !agree(ce.pValue, r.early_p) || ce.df !== r.early_df
        || !agree(cl.chi2, r.late_chi2) || !agree(cl.pValue, r.late_p) || cl.df !== r.late_df) histMismatch++;
    // Replay the early window from the revealed seed (draws cached per seed).
    let draws = earlyDrawsBySeed.get(r.seed_hash);
    if (!draws) {
      const ss = seedMap.get(r.seed_hash);
      const cs = bets.find(b => b.seed.serverSeedHashed === r.seed_hash)?.seed.clientSeed;
      draws = [];
      if (ss && cs !== undefined) {
        const key = Buffer.from(ss, 'hex');
        for (let nonce = 0; nonce < EW; nonce++) draws.push(computeDrawFromBuffer(key, cs, nonce, cfg.gridSize, cfg.drawnCount));
      }
      earlyDrawsBySeed.set(r.seed_hash, draws);
    }
    const eh = new Array(n + 1).fill(0);
    for (const d of draws) { const set = new Set(d); let h = 0; for (let q = 1; q <= n; q++) if (set.has(q)) h++; eh[h]++; }
    if (draws.length !== EW || eh.some((v, k) => v !== (e as number[])[k])) earlyReplayMismatch++;
  }
  if (histBad > 0) p2Issues.push(`${histBad} row(s) without valid full / early / late histograms (full = early + late)`);
  if (histMismatch > 0) p2Issues.push(`${histMismatch} row(s) whose chi² / p does not recompute from its shipped histograms`);
  if (earlyReplayMismatch > 0) p2Issues.push(`REPLAY: ${earlyReplayMismatch} row(s) whose early-window histogram does not replay from the revealed seed`);

  // (b) Return statistic.
  const Ctot = binom(cfg.gridSize, cfg.drawnCount);
  const moments = new Map<string, { mu: number; v: number; cdf: number[]; cells: number[] }>();
  for (const { risk, picks } of allConfigs) {
    const w = hypergeometricWeights(cfg.gridSize, cfg.drawnCount, picks);
    const lits = ctx.configRaw.data.multipliers[risk][String(picks)].map((x: number) => String(x));
    let m1: Rational = { num: 0n, den: 1n }, m2: Rational = { num: 0n, den: 1n };
    w.forEach((wk, k) => { const m = decimal(lits[k]); m1 = add(m1, mul({ num: wk, den: 1n }, m)); m2 = add(m2, mul({ num: wk, den: 1n }, mul(m, m))); });
    const mu: Rational = { num: m1.num, den: m1.den * Ctot };
    const ex2: Rational = { num: m2.num, den: m2.den * Ctot };
    const v = sub(ex2, mul(mu, mu));
    let acc = 0n; const cdf = w.map(x => { acc += x; return Number(acc) / Number(Ctot); });
    moments.set(`${risk}|${picks}`, { mu: toNumber(mu), v: toNumber(v), cdf, cells: lits.map(Number) });
  }
  let R = 0, M = 0, V = 0, nRet = 0;
  const betMoments: Array<{ cdf: number[]; cells: number[] }> = [];
  for (let i = 0; i < bets.length; i++) {
    const b = bets[i], draw = ctx.recomputedDraws[i];
    const risk = DIFFICULTY_TO_RISK[b.request.difficulty] as RiskLevel, picks = b.request.selected_positions.length;
    const mo = moments.get(`${risk}|${picks}`);
    if (!draw || !mo) continue;
    const hits = b.request.selected_positions.filter(q => draw.includes(q)).length;
    R += cfg.multiplier(risk, picks, hits); M += mo.mu; V += mo.v; nRet++;
    betMoments.push(mo);
  }
  const zRet = (R - M) / Math.sqrt(V);
  const pClt = 0.5 * (1 + erfApprox(zRet / Math.SQRT2));
  const B_REPLICATES = 10_000;
  let rng = 0x6b656e6f >>> 0;
  const next = () => { rng = (rng + 0x6D2B79F5) >>> 0; let t = rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let atOrBelow = 0;
  for (let rep = 0; rep < B_REPLICATES; rep++) {
    let sum = 0;
    for (const mo of betMoments) { const u = next(); let k = 0; while (k < mo.cdf.length - 1 && u >= mo.cdf[k]) k++; sum += mo.cells[k]; }
    if (sum <= R) atOrBelow++;
  }
  const pBoot = (atOrBelow + 1) / (B_REPLICATES + 1);
  const Z99 = 2.3263478740408408, Z80 = 0.8416212335729143;
  const powerDeficit = (Z99 + Z80) * Math.sqrt(V) / nRet;
  const retOk = nRet === bets.length && pBoot >= 0.01;
  if (nRet !== bets.length) p2Issues.push(`return statistic covers ${nRet} bets != ${bets.length} captured`);

  const pass2Pass = p2Issues.length === 0 && testAOk && testBOk && retOk;
  const pass2Summary = p2Issues.length > 0
    ? `Pass 2 artifact does not support its verdict: ${p2Issues.slice(0, 4).join('; ')}`
    : `${N} seed×config combos = every combination played in the dataset, on all ${EXPECTED_REVEALED_EPOCHS} revealed seeds; `
      + `counts re-scored from the rows. Test A: ${testARecount}/${N} fail at α = 0.01 — ${testAOk ? 'within' : 'EXCEEDS'} H₀ `
      + `(binomial P(X ≥ ${testARecount}) ${testAOk ? '≥' : '<'} 0.01). Test B: ${flagsRecount}/${N} early-only flags — `
      + `${testBOk ? 'within' : 'EXCEEDS'} H₀ (binomial P(X ≥ ${flagsRecount}) ${testBOk ? '≥' : '<'} 0.01). `
      + `Every row's full / early / late chi² / p recomputed from its shipped histograms and the early window replayed `
      + `from the revealed seed. Return of the ${nRet} served bets in the captured window vs its exact null: z computed, `
      + `bootstrap lower-tail p ${retOk ? '≥' : '<'} 0.01 (B = ${B_REPLICATES}, pre-registered rule); detection power in data.`;
  const s20 = step(20, 'Simulation Results — Pass 2 Cherry-Pick Test', pass2Pass ? 'PASS' : 'FAIL', pass2Summary,
    {
      seedConfigCombinations: N,
      combinationsPlayedInDataset: playedCombos.size,
      testAFails: testARecount,
      testABinomialP: testAP,
      cherryPickFlags: flagsRecount,
      cherryPickBinomialP: testBP,
      bothWindowsSignificant: bothWindows,
      artifactIssues: p2Issues.length,
      rowsNotRecomputing: histMismatch + histBad, earlyWindowReplayMismatches: earlyReplayMismatch,
      returnStatistic: { bets: nRet, observedReturn: R, nullMean: M, nullVariance: V, z: zRet, pCltLowerTail: pClt,
        bootstrapReplicates: B_REPLICATES, bootstrapSeed: '0x6b656e6f (mulberry32)', pBootstrapLowerTail: pBoot,
        rule: 'FAIL if the bootstrap lower-tail p < 0.01 (pre-registered)',
        detectablePerBetReturnDeficitAt80Power: powerDeficit },
    },
  );
  if (pass2Pass) console.log(`         ${pass2Summary}`);

  return [s19, s20];
}

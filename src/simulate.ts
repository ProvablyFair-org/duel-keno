/**
 * Two-pass Monte Carlo simulation for Duel.com Keno audit.
 *
 * Pass 1 — Fresh seeds (1 per config × 1,000,000 rounds × 40 configs = 40M rounds total).
 *   Exercises the draw code (src/rng.ts, PORTED from Duel's published Verify-tab code — not an
 *   independent implementation; see its header) and the multiplier tables.
 *   Includes chi-squared goodness-of-fit and serial independence (autocorrelation + runs test).
 *   The 40 seed pairs were generated once with crypto.randomBytes and are PINNED in src/sim-seeds.ts (SIM_SEEDS),
 *   so every figure this file writes is a deterministic function of the code, the pinned seeds, the
 *   pinned kenoConfig.json and the pinned dataset: a re-run reproduces it.
 *
 * NO RUN METADATA (profile KENO-27, rules.reproduction). The artifact carries no timestamp and no
 * execution time: a field that differs on every run makes a legitimate regeneration unable to
 * reproduce the pinned bytes, and a re-pin taken from such a run is a pin on the clock. Timings
 * are printed to the console only.
 *
 * Pass 2 — Casino seeds (102 revealed seeds × 10,000 nonces each).
 *   Test A: chi-squared on full nonce range 0–9,999 vs hypergeometric distribution.
 *   Test B: early epoch (nonces 0–49) vs late (50–9,999) — detects seed cherry-picking bias.
 *
 * Output: outputs/simulation-results.json
 */

import * as fs     from 'fs';
import * as path   from 'path';

import { computeDrawFromBuffer }                              from './rng';
import { SIM_SEEDS }                                          from './sim-seeds';
import { KenoConfig, DIFFICULTY_TO_RISK }                    from './config';
import { loadDataset, buildSeedMap }                         from './loader';
import { chiSquaredTest, chiSquaredSurvival, lag1Autocorrelation, runsTest } from './stats';
import type { KenoConfigFile, RiskLevel }                    from './types';

// ── Config ────────────────────────────────────────────────────────────────────

const configRaw: KenoConfigFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../kenoConfig.json'), 'utf-8'),
);
const cfg = new KenoConfig(configRaw.data);

const ROUNDS_PER_CONFIG = 1_000_000;
const NONCES_PER_SEED   = 10_000;
const EPOCH_LENGTH      = 50;

// ── Progress bar ─────────────────────────────────────────────────────────────

function progressBar(current: number, total: number, label: string, startMs: number, width = 30): void {
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const bar = '━'.repeat(filled) + '╌'.repeat(width - filled);
  const pct = (ratio * 100).toFixed(0).padStart(3);
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const eta = current > 0 ? (((Date.now() - startMs) / current) * (total - current) / 1000).toFixed(0) : '?';
  process.stdout.write(`\r  ${bar} ${pct}% │ ${current}/${total} │ ${label} │ ${elapsed}s elapsed · ~${eta}s left`);
}

function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

// ── Pinned simulation seeds (one unique pair per config) ─────────────────────
// Each config gets its own server+client seed pair so that every config's 1M
// rounds are generated from an independent HMAC stream.  This avoids cross-
// config correlation that a single shared seed would introduce (all configs
// would share the same draw sequence, only differing in how many picks are
// scored).  Generated once with crypto.randomBytes; pinned for reproducibility.
// The 40 pinned pairs live in src/sim-seeds.ts so the verifier can replay from them (KENO-20).


// ── Convergence sample points ────────────────────────────────────────────────
const CONVERGENCE_SAMPLES = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Run a single config (risk, picks) for N rounds using a fixed serverSeed buffer
 * and random nonces. Returns observed hit counts, empirical RTP, hit sequence
 * (for serial independence testing), RTP snapshots at sample points, and basic stats.
 */
function runConfig(
  keyBuffer:  Buffer,
  clientSeed: string,
  risk:       RiskLevel,
  picks:      number,
  rounds:     number,
): { hitCounts: number[]; hitSequence: number[]; simulatedRTP: number; rtpSnapshots: Map<number, number>; numberCounts: number[] } {
  const hitCounts   = new Array(picks + 1).fill(0);
  // KENO-20: every drawn number of every round is counted, for the grid-uniformity test.
  const numberCounts = new Array(cfg.gridSize).fill(0);
  const hitSequence = new Array(rounds) as number[];
  let totalPayout   = 0;

  const sampleSet    = new Set(CONVERGENCE_SAMPLES.filter(s => s <= rounds));
  const rtpSnapshots = new Map<number, number>();

  for (let nonce = 0; nonce < rounds; nonce++) {
    const drawn    = computeDrawFromBuffer(keyBuffer, clientSeed, nonce, cfg.gridSize, cfg.drawnCount);
    const drawnSet = new Set(drawn);
    for (const x of drawn) numberCounts[x - 1]++;

    let hits = 0;
    for (let p = 1; p <= picks; p++) {
      if (drawnSet.has(p)) hits++;
    }

    hitCounts[hits]++;
    hitSequence[nonce] = hits;
    totalPayout += cfg.multiplier(risk, picks, hits);

    const roundNum = nonce + 1;
    if (sampleSet.has(roundNum)) {
      rtpSnapshots.set(roundNum, totalPayout / roundNum);
    }
  }

  return { hitCounts, hitSequence, simulatedRTP: totalPayout / rounds, rtpSnapshots, numberCounts };
}

/**
 * Binomial survival function: P(X >= k | n, p).
 * Used for Pass 2 cherry-pick threshold (exact binomial test).
 */
function binomSurvival(k: number, n: number, p: number): number {
  // P(X >= k) = 1 - P(X <= k-1) = 1 - sum_{i=0}^{k-1} C(n,i) * p^i * (1-p)^(n-i)
  let cdf = 0;
  for (let i = 0; i < k; i++) {
    cdf += binomPMF(i, n, p);
  }
  return 1 - cdf;
}

function binomPMF(k: number, n: number, p: number): number {
  // Use log-space to avoid overflow for large n
  let logP = 0;
  for (let i = 0; i < k; i++) {
    logP += Math.log(n - i) - Math.log(i + 1);
  }
  logP += k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logP);
}

// ── Pass 1 ────────────────────────────────────────────────────────────────────

const allConfigs = cfg.allConfigs();

console.log('══════════════════════════════════════════════════════════');
console.log('  PASS 1 — Fresh random seeds');
console.log(`  ${allConfigs.length} configs × ${ROUNDS_PER_CONFIG.toLocaleString()} rounds`);
console.log('══════════════════════════════════════════════════════════\n');

const pass1Start = Date.now();

const pass1Results: Array<{
  risk:           RiskLevel;
  picks:          number;
  rounds:         number;
  theoreticalRTP: number;
  simulatedRTP:   number;
  hitCounts:      number[];
  expectedCounts: number[];
  chi2:           number;
  df:             number;
  pValue:         number;
  r1:             number;
  r1Z:            number;
  runsZ:          number;
  runsPValue:     number;
  numberCounts:   number[];
  uniformity:     { chi2: number; correctedChi2: number; df: number; pValue: number };
  serial:         { pairSum: number; first: number; last: number; runs: number; median: number; n1: number };
}> = [];

// Per-config RTP snapshots for convergence chart
const allSnapshots: Array<Map<number, number>> = [];

for (let ci = 0; ci < allConfigs.length; ci++) {
  const { risk, picks } = allConfigs[ci];
  progressBar(ci, allConfigs.length, `${risk}/${picks}p`, pass1Start);

  // Each config uses its own seed pair — independent HMAC streams avoid
  // cross-config correlation from shared draw sequences.
  const seedPair   = SIM_SEEDS[ci];
  const keyBuffer  = Buffer.from(seedPair.server, 'hex');
  const clientSeed = seedPair.client;

  const { hitCounts, hitSequence, simulatedRTP, rtpSnapshots, numberCounts } = runConfig(
    keyBuffer, clientSeed, risk, picks, ROUNDS_PER_CONFIG,
  );
  allSnapshots.push(rtpSnapshots);

  const expectedCounts = Array.from(
    { length: picks + 1 },
    (_, k) => cfg.hitProbability(picks, k) * ROUNDS_PER_CONFIG,
  );

  const { chi2, df, pValue }                              = chiSquaredTest([...hitCounts], expectedCounts);
  const r1                                                = lag1Autocorrelation(hitSequence);
  const r1Z                                               = r1 / (1 / Math.sqrt(ROUNDS_PER_CONFIG));
  const { z: runsZ, pValue: runsPValue, runs, median, n1 } = runsTest(hitSequence);

  // KENO-20 additions (2026-09-25). Nothing above this line changed, so every previously published
  // Pass 1 figure is reproduced; the additions are appended to each row.
  //  - Grid uniformity: rounds × drawnCount numbers over the grid; each draw is WITHOUT replacement,
  //    so Pearson's X² over the gridSize counts is (N−d)/(N−1) · χ²_{N−1}; corrected = X²·(N−1)/(N−d).
  //  - Serial sufficient statistics: with the hit histogram (Σx, Σx²) these integers let the
  //    verifier re-derive r1 EXACTLY and the runs z / p by the same formula, without the 1M sequence.
  const expEach = ROUNDS_PER_CONFIG * cfg.drawnCount / cfg.gridSize;
  let uniX2 = 0;
  for (const o of numberCounts) uniX2 += (o - expEach) ** 2 / expEach;
  const uniCorrected = uniX2 * (cfg.gridSize - 1) / (cfg.gridSize - cfg.drawnCount);
  const uniP = chiSquaredSurvival(uniCorrected, cfg.gridSize - 1);
  let pairSum = 0;
  for (let t = 0; t + 1 < hitSequence.length; t++) pairSum += hitSequence[t] * hitSequence[t + 1];

  pass1Results.push({
    risk, picks,
    rounds:         ROUNDS_PER_CONFIG,
    theoreticalRTP: cfg.theoreticalRTP(risk, picks),
    simulatedRTP,
    hitCounts,
    expectedCounts,
    chi2, df, pValue,
    r1, r1Z, runsZ, runsPValue,
    numberCounts,
    uniformity: { chi2: uniX2, correctedChi2: uniCorrected, df: cfg.gridSize - 1, pValue: uniP },
    serial: { pairSum, first: hitSequence[0], last: hitSequence[hitSequence.length - 1], runs, median, n1 },
  });
}
clearLine();
progressBar(allConfigs.length, allConfigs.length, 'done', pass1Start);
process.stdout.write('\n');

// ── Convergence data (mean RTP across all configs at each sample point) ──────

interface ConvergencePoint {
  roundsPerConfig: number;
  label: string;
  meanRTP: number;
  stdDev: number;
}

const convergenceData: ConvergencePoint[] = [];

for (const sampleN of CONVERGENCE_SAMPLES) {
  const rtpValues: number[] = [];
  for (const snap of allSnapshots) {
    const rtp = snap.get(sampleN);
    if (rtp !== undefined) rtpValues.push(rtp);
  }
  if (rtpValues.length === 0) continue;

  const mean = rtpValues.reduce((a, b) => a + b, 0) / rtpValues.length;
  const variance = rtpValues.length > 1
    ? rtpValues.reduce((a, b) => a + (b - mean) ** 2, 0) / (rtpValues.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const stdErr = rtpValues.length > 1 ? stdDev / Math.sqrt(rtpValues.length) : 0;

  const label = sampleN >= 1_000_000
    ? `${(sampleN / 1e6).toFixed(0)}M`
    : sampleN >= 1_000
      ? `${(sampleN / 1e3).toFixed(0)}K`
      : `${sampleN}`;

  convergenceData.push({
    roundsPerConfig: sampleN,
    label,
    meanRTP: mean,
    stdDev: stdErr,  // standard error of the mean, not raw SD
  });
}

const pass1ElapsedMs   = Date.now() - pass1Start;
const pass1Chi2Fails   = pass1Results.filter(r => r.pValue < 0.01).length;
const bonAlpha         = 0.01 / allConfigs.length;
const pass1Chi2FailsBon = pass1Results.filter(r => r.pValue < bonAlpha).length;
const pass1AvgRTP      = pass1Results.reduce((a, r) => a + r.simulatedRTP, 0) / pass1Results.length;
const pass1AvgTheoRTP  = pass1Results.reduce((a, r) => a + r.theoreticalRTP, 0) / pass1Results.length;
const pass1SerialFails = pass1Results.filter(r => Math.abs(r.r1Z) > 3 || r.runsPValue < 0.01).length;

console.log(`\n  Avg simulated RTP:   ${(pass1AvgRTP * 100).toFixed(4)}%`);
console.log(`  Avg theoretical RTP: ${(pass1AvgTheoRTP * 100).toFixed(4)}%`);
console.log(`  Chi-squared fails: ${pass1Chi2Fails}/${allConfigs.length} at α=0.01 · ${pass1Chi2FailsBon}/${allConfigs.length} at Bonferroni α/${allConfigs.length}`);
console.log(`  Serial independence: ${pass1SerialFails}/${allConfigs.length} configs flag (|r₁z|>3 or runs p<0.01)`);
console.log(`  Time: ${(pass1ElapsedMs / 1000).toFixed(1)}s\n`);

// ── Pass 2 ────────────────────────────────────────────────────────────────────

console.log('══════════════════════════════════════════════════════════');
console.log('  PASS 2 — Casino seeds');
console.log(`  102 seeds × ${NONCES_PER_SEED.toLocaleString()} nonces`);
console.log(`  Epoch window: nonces 0–${EPOCH_LENGTH - 1} (early) vs ${EPOCH_LENGTH}–${NONCES_PER_SEED - 1} (late)`);
console.log('══════════════════════════════════════════════════════════\n');

const pass2Start = Date.now();

const dataset    = loadDataset();
const seedMapRev = buildSeedMap(dataset.seeds);

interface SeedInfo {
  serverSeed:  string;
  clientSeed:  string;
  configs:     Array<{ risk: RiskLevel; picks: number }>;
}

const seedInfoMap = new Map<string, SeedInfo>();

for (const [hash, serverSeed] of seedMapRev.entries()) {
  seedInfoMap.set(hash, { serverSeed, clientSeed: '', configs: [] });
}

const seenConfigs = new Map<string, Set<string>>();

for (const bet of dataset.bets) {
  const hash = bet.seed.serverSeedHashed;
  const info = seedInfoMap.get(hash);
  if (!info) continue;
  if (!info.clientSeed) info.clientSeed = bet.seed.clientSeed;

  const risk  = DIFFICULTY_TO_RISK[bet.request.difficulty];
  const picks = bet.request.selected_positions.length;
  const key   = `${hash}|${risk}|${picks}`;
  if (!seenConfigs.has(key)) {
    seenConfigs.set(key, new Set());
    info.configs.push({ risk, picks });
  }
}

const pass2Results: Array<{
  seed_hash:        string;
  risk:             RiskLevel;
  picks:            number;
  full_range_chi2:  number;
  full_range_p:     number;
  full_range_df:    number;
  early_chi2:       number;
  early_p:          number;
  early_df:         number;
  late_chi2:        number;
  late_p:           number;
  late_df:          number;
  cherry_pick_flag: boolean;
  fullCounts:       number[];
  earlyCounts:      number[];
  lateCounts:       number[];
}> = [];

let testAFails      = 0;
let cherryPickFlags = 0;

const seedEntries = [...seedInfoMap.entries()].filter(([, info]) => info.clientSeed !== '');

let seedIdx = 0;
for (const [seedHash, info] of seedEntries) {
  seedIdx++;
  progressBar(seedIdx, seedEntries.length, `seed ${seedIdx}`, pass2Start);
  const keyBuffer = Buffer.from(info.serverSeed, 'hex');

  for (const { risk, picks } of info.configs) {
    const fullCounts  = new Array(picks + 1).fill(0);
    const earlyCounts = new Array(picks + 1).fill(0);
    const lateCounts  = new Array(picks + 1).fill(0);

    for (let nonce = 0; nonce < NONCES_PER_SEED; nonce++) {
      const drawn    = computeDrawFromBuffer(keyBuffer, info.clientSeed, nonce, cfg.gridSize, cfg.drawnCount);
      const drawnSet = new Set(drawn);
      let hits = 0;
      for (let p = 1; p <= picks; p++) {
        if (drawnSet.has(p)) hits++;
      }

      fullCounts[hits]++;
      if (nonce < EPOCH_LENGTH) earlyCounts[hits]++;
      else lateCounts[hits]++;
    }

    const fullExpected  = Array.from({ length: picks + 1 }, (_, k) => cfg.hitProbability(picks, k) * NONCES_PER_SEED);
    const earlyExpected = Array.from({ length: picks + 1 }, (_, k) => cfg.hitProbability(picks, k) * EPOCH_LENGTH);
    const lateExpected  = Array.from({ length: picks + 1 }, (_, k) => cfg.hitProbability(picks, k) * (NONCES_PER_SEED - EPOCH_LENGTH));

    const testA     = chiSquaredTest([...fullCounts],  fullExpected);
    const earlyTest = chiSquaredTest([...earlyCounts], earlyExpected);
    const lateTest  = chiSquaredTest([...lateCounts],  lateExpected);

    const cherryPickFlag = earlyTest.pValue < 0.05 && lateTest.pValue >= 0.05;

    if (testA.pValue < 0.01) testAFails++;
    if (cherryPickFlag) cherryPickFlags++;

    pass2Results.push({
      seed_hash: seedHash,
      risk, picks,
      full_range_chi2: testA.chi2,
      full_range_p:    testA.pValue,
      full_range_df:   testA.df,
      early_chi2:  earlyTest.chi2,
      early_p:     earlyTest.pValue,
      early_df:    earlyTest.df,
      late_chi2:   lateTest.chi2,
      late_p:      lateTest.pValue,
      late_df:     lateTest.df,
      cherry_pick_flag: cherryPickFlag,
      // Shipped 2026-09-25 (KENO-21) so the verifier re-derives every row's chi² / p.
      fullCounts, earlyCounts, lateCounts,
    });
  }

}
clearLine();
progressBar(seedEntries.length, seedEntries.length, 'done', pass2Start);
process.stdout.write('\n');

const pass2ElapsedMs = Date.now() - pass2Start;

const N = pass2Results.length;

// Binomial p-value for Test A: P(X >= testAFails | N, p=0.01)
const testAPValue = binomSurvival(testAFails, N, 0.01);
const testAVerdict = testAPValue >= 0.01 ? 'PASS' : 'FAIL';
const testARange = testAPValue >= 0.01
  ? `within expected range (binomial p=${testAPValue.toFixed(4)})`
  : `EXCEEDS expected range (binomial p=${testAPValue.toFixed(4)})`;

// Binomial p-value for cherry-pick flags: P(X >= flags | N, p=0.05).
// A flag needs early p < 0.05 AND late p >= 0.05. The two windows use disjoint nonces, so under H₀
// the nominal flag rate is 0.05 × 0.95 = 0.0475. The tail is computed at 0.05, the nominal rate of
// the early-window test alone and an upper bound on the flag rate: it gives the larger tail, so it
// is the more lenient of the two (57 / 1,666 flags: 0.9992 at 0.05, 0.9968 at 0.0475). The pinned
// artifact stores the 0.05 tail and Step 20 recomputes it at 0.05; MANIFEST states both.
const cherryPValue = binomSurvival(cherryPickFlags, N, 0.05);
const cherryVerdict = cherryPValue >= 0.01 ? 'PASS' : 'FAIL';
const cherryRange = cherryPValue >= 0.01
  ? `within expected range (binomial p=${cherryPValue.toFixed(4)})`
  : `EXCEEDS expected range — cherry-picking signal (binomial p=${cherryPValue.toFixed(4)})`;

console.log(`\n  Seeds tested: ${seedEntries.length}`);
console.log(`  Seed × config combinations: ${N}`);
console.log(`  Test A fails (p<0.01): ${testAFails} / ${N} — ${testARange} [${testAVerdict}]`);
console.log(`  Cherry-pick flags: ${cherryPickFlags} / ${N} — ${cherryRange} [${cherryVerdict}]`);
console.log(`  Time: ${(pass2ElapsedMs / 1000).toFixed(1)}s\n`);

// ── Write output ──────────────────────────────────────────────────────────────

const output = {
  pass1_fresh_seeds: {
    description: 'Auditor-generated random seeds. Exercises the draw code ported from Duel\'s published Verify-tab code, the multiplier tables, and serial independence of RNG outputs.',
    roundsPerConfig:    ROUNDS_PER_CONFIG,
    totalRounds:        ROUNDS_PER_CONFIG * allConfigs.length,
    configs:            allConfigs.length,
    avgTheoreticalRTP:  pass1AvgTheoRTP,
    avgSimulatedRTP:    pass1AvgRTP,
    chi2FailsAtAlpha01: pass1Chi2Fails,
    chi2FailsBonferroni: pass1Chi2FailsBon,
    serialIndependenceFails: pass1SerialFails,
    uniformityFailsAtAlpha01: pass1Results.filter(r => r.uniformity.pValue < 0.01).length,
    uniformityFailsBonferroni: pass1Results.filter(r => r.uniformity.pValue < 0.01 / allConfigs.length).length,
    results: pass1Results,
    convergence: convergenceData,
  },
  pass2_casino_seeds: {
    description: "Revealed casino server seeds from the capture dataset. Tests whether casino seed selection produces biased distributions over the epoch window (cherry-picking detection).",
    seeds_tested:             seedEntries.length,
    nonces_per_seed:          NONCES_PER_SEED,
    epoch_length:             EPOCH_LENGTH,
    seed_config_combinations: N,
    test_a_chi2_fails_at_alpha01: testAFails,
    test_a_binomial_pValue:       testAPValue,
    test_a_verdict:               testAVerdict,
    test_b_cherry_pick_flags:     cherryPickFlags,
    test_b_binomial_pValue:       cherryPValue,
    test_b_verdict:               cherryVerdict,
    results: pass2Results,
  },
};

// A SIMULATION RUN MUST NOT REWRITE THE ARTIFACT IT IS QUOTED FROM. outputs/simulation-results.json
// and outputs/rtp-convergence.html are committed, pinned in src/artifact-pins.ts and scored by
// Steps 19–21; a plain `npm run simulate` writing over them would replace the evidence of record
// with whatever this run happened to produce. This run writes under outputs/run/ — gitignored, a
// run record. The committed copies are refreshed only by PF_EMIT=1, and re-pinned in the same
// commit. Same contract as tests/verify.ts.
const PF_EMIT = process.env.PF_EMIT === '1';
const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
const RESULTS_DIR = PF_EMIT ? OUTPUTS_DIR : path.join(OUTPUTS_DIR, 'run');
const WROTE_TO = PF_EMIT ? 'outputs' : 'outputs/run';
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const outPath = path.join(RESULTS_DIR, 'simulation-results.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

// ── Generate RTP Convergence Chart (self-contained HTML) ─────────────────────

const theoreticalRTP = 0.999; // 99.9% — 0.1% house edge
const finalPoint = convergenceData[convergenceData.length - 1];
const finalRTP = finalPoint.meanRTP;

// The pinned chart is self-contained: Chart.js is inlined from the exact-pinned devDependency
// (package.json chart.js 4.4.7), never loaded from a CDN.
const CHARTJS_SOURCE = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');

const chartHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DUEL.COM KENO RTP CONVERGENCE — ${allConfigs.length} CONFIGS x 1M ROUNDS EACH</title>
<!-- Chart.js 4.4.7 dist/chart.umd.js inlined verbatim from the npm package pinned in package-lock.json -->
<script>${CHARTJS_SOURCE}<\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; padding: 24px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  h1 { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 24px; }
  .chart-wrap { position: relative; height: 420px; }
  .final-box { display: inline-block; border: 2px solid #4caf50; border-radius: 8px; padding: 10px 20px; margin-top: 20px; }
  .final-box .label { font-size: 13px; color: #666; }
  .final-box .value { font-size: 22px; font-weight: 700; color: #2e7d32; }
  .final-box .check { color: #4caf50; font-size: 18px; }
  .legend { text-align: center; margin-top: 12px; font-size: 13px; color: #666; }
  .legend span { margin: 0 12px; }
  .legend .dot { display: inline-block; width: 12px; height: 3px; vertical-align: middle; margin-right: 4px; }
</style>
</head>
<body>
<div class="container">
  <h1>DUEL.COM KENO RTP CONVERGENCE — ${allConfigs.length} CONFIGS x 1M ROUNDS EACH</h1>
  <div class="chart-wrap"><canvas id="chart"></canvas></div>
  <div class="legend">
    <span><span class="dot" style="background:#1565c0;height:3px"></span> Mean RTP (${allConfigs.length} configs)</span>
    <span><span class="dot" style="background:rgba(229,115,115,0.5);height:3px"></span> ±2 SE</span>
    <span><span class="dot" style="background:#e57373;border-top:2px dashed #e57373;height:0"></span> Theoretical (${(theoreticalRTP * 100).toFixed(1)}%)</span>
    <span style="background:rgba(229,115,115,0.08);padding:2px 8px;border-radius:3px">±2 SE band (standard error of mean)</span>
  </div>
  <div style="text-align:right; margin-top:8px;">
    <div class="final-box">
      <span class="label">Final Mean RTP:</span>
      <span class="value">${(finalRTP * 100).toFixed(3)}%</span>
      <span class="check">&#10003;</span>
    </div>
  </div>
</div>
<script>
const data = ${JSON.stringify(convergenceData.map(d => ({
  x: d.roundsPerConfig,
  y: d.meanRTP * 100,
  sd: d.stdDev * 100,
  label: d.label,
})))};

const theoretical = ${(theoreticalRTP * 100).toFixed(6)};
const labels = data.map(d => d.label);

const ctx = document.getElementById('chart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: {
    labels,
    datasets: [
      {
        label: 'Upper band',
        data: data.map(d => d.y + d.sd * 2),
        borderColor: 'transparent',
        backgroundColor: 'rgba(229,115,115,0.08)',
        fill: '+1',
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: 'Lower band',
        data: data.map(d => d.y - d.sd * 2),
        borderColor: 'transparent',
        backgroundColor: 'rgba(229,115,115,0.08)',
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: '±2 SE (upper)',
        data: data.map(d => d.y + d.sd),
        borderColor: 'rgba(229,115,115,0.4)',
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: '±2 SE (lower)',
        data: data.map(d => d.y - d.sd),
        borderColor: 'rgba(229,115,115,0.4)',
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: 'Theoretical (' + theoretical.toFixed(1) + '%)',
        data: data.map(() => theoretical),
        borderColor: '#e57373',
        borderWidth: 2,
        borderDash: [8, 4],
        fill: false,
        pointRadius: 0,
      },
      {
        label: 'Mean RTP',
        data: data.map(d => d.y),
        borderColor: '#1565c0',
        borderWidth: 2.5,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#1565c0',
        tension: 0.3,
      },
      {
        label: 'Final',
        data: data.map((d, i) => i === data.length - 1 ? d.y : null),
        borderColor: '#1565c0',
        backgroundColor: '#1565c0',
        pointRadius: 6,
        pointHoverRadius: 8,
        showLine: false,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => data[items[0].dataIndex].label + ' rounds/config',
          label: (item) => {
            if (item.datasetIndex === 5) return 'Mean RTP: ' + item.parsed.y.toFixed(4) + '%';
            if (item.datasetIndex === 4) return 'Theoretical: ' + theoretical.toFixed(4) + '%';
            return null;
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: 'Rounds per Config', font: { size: 12 } },
        ticks: { maxTicksLimit: 10 },
      },
      y: {
        title: { display: false },
        ticks: { callback: v => v.toFixed(1) + '%' },
      },
    },
  },
});
<\/script>
</body>
</html>`;

fs.writeFileSync(path.join(RESULTS_DIR, 'rtp-convergence.html'), chartHTML);

console.log('══════════════════════════════════════════════════════════');
console.log(`  Written: ${WROTE_TO}/simulation-results.json`);
console.log(`  Written: ${WROTE_TO}/rtp-convergence.html`);
if (PF_EMIT) console.log('  REPORT GENERATION (PF_EMIT=1): the committed artifacts in outputs/ were rewritten — re-pin them in src/artifact-pins.ts.');
else         console.log('  Committed artifacts NOT modified.');
console.log('══════════════════════════════════════════════════════════\n');

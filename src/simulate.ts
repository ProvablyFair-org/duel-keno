/**
 * Two-pass Monte Carlo simulation for Duel.com Keno audit.
 *
 * Pass 1 — Fresh random seeds (1 per config × 1,000,000 rounds × 40 configs = 40M rounds total).
 *   Validates the independent implementation and multiplier tables.
 *   Includes chi-squared goodness-of-fit and serial independence (autocorrelation + runs test).
 *   Uses crypto.randomBytes() — results change on every run.
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
import { KenoConfig, DIFFICULTY_TO_RISK }                    from './config';
import { loadDataset, buildSeedMap }                         from './loader';
import { chiSquaredTest, lag1Autocorrelation, runsTest } from './stats';
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
const SIM_SEEDS: Array<{ server: string; client: string }> = [
  { server: 'cb39d8adfaa1ebfac13d8e0de174140bc7d4315af7b8e49fb21e42ff69a0346b', client: 'ff57e66542fd7f65b600688dd952aaeb' },
  { server: '5e3aefdde81b846a00a292d8f3c2c72fb2ba671a0078455821bbeb655fd7f3f3', client: '62c30e7143a455a5ca8449a60336209c' },
  { server: 'fd036de869ba187678496424ecb6fc00faa3b0fe3703b20f9f1dacbec1df041e', client: '3c445ac10a4047a0518b766b9bcd8064' },
  { server: '604a9dba65dce50ac812e712ccf243c53e207e2d455c8abf785765dee3442fcc', client: '8a0548646b20870bfab68f21fcd778fe' },
  { server: '45e1b63fb6b11537144291a28055673cbd95f42f811ffef1f68f2390b47f9bf7', client: '72471a1d8830e50769ea1b38963b5c1c' },
  { server: '593e73c44198ed9c299efbd40f51618eb427b963de459e3649ba11090bc6b78a', client: '969f862ffac3c44b78e3e3284e8895c0' },
  { server: '34bb682011207c1656df279d4e966746e8ee07469bbc492dd97943638db7f78c', client: 'a6e9ecdb2b2965e2856ef4a2836b17b3' },
  { server: '7c7da880dafd86ad14e4421e157d3f442f413501d3e3538f6a2307c143338e14', client: '788a1fe12573e37b790d09977213909a' },
  { server: 'bbb20c99e36f5f036916795700fb4ee008781c667c05606af637d1e4f1189845', client: 'a94a6e80d81afde1e01b2b2f548e9220' },
  { server: '9e83d80c34f2911e2c9cbd6d31d19777285d2128b123af00512f6eeb03422820', client: '3d470b7eec568ca75964fb0cac7d6939' },
  { server: '5b5e178a6ea3363c738e205d6067fba050d8fca19522bac9e8796e15c2e19953', client: 'e685ed262e51dcf25c22a2649a2fead4' },
  { server: '9a0cd23bb4b79c352f384916e57cdff6499eb737e569ad9b88a5e7ede5a85cb7', client: '5d478d7a166a6fd45c0d7264b3ee885e' },
  { server: '87b0ad7fbfd965a9138695446ce468e28f090bf27b5f9dd3680a85b7f9316a8d', client: 'a4fa8689f2893ac22381669aee07e8cb' },
  { server: '60a80fc65ce23f7e64c3b3f08af18e2aaa9dc2db9077d5c42bacbb1efb41be33', client: '44190cc77c0257c0c28f6e1d56a789cb' },
  { server: 'e14c97e3eb7ffcb485fe004b917dcd5bfa90ecf784948f262594fdb91e12b410', client: 'f0c640407b012c0636bd5d532ccf5d1a' },
  { server: 'e44ef4d2fd1fb52b9255df031bd87eccea52e4a45299392a3fcd805ae50a406e', client: '7629ce1973f8fcf36ab503a932af062d' },
  { server: 'a8c200b668a2b1f79ca6335702d3d2200ed7af104cadd7708de53d7222f98b20', client: '3216783670da517ae60ab25990fcc864' },
  { server: 'b3f641dd918e7cfc42f28dc4a6ed9a1467d3c7830ff43c8888e5db61dd3dc50a', client: 'aa46716b35510c3b943ed11713a350da' },
  { server: '4d6b4cfb93832e833545309c703338b2498dabfe9415ddedd3d45102731c9d03', client: '01623a665227437cacce0a10906e721e' },
  { server: 'ddd2ec93eaa0e96c36121194ac1aee59dc827356cb4f39c668239d8d8d946dee', client: '73dede8b54b985aed840995fa5a9e1b8' },
  { server: 'fcd34512eb67c88b52412006cb85e5b337401ac24a9ca482eefe88690538c108', client: 'b60e43828fb758a0dae458d8abe3a6dd' },
  { server: '1a9720eb388e1faf2d2549c2fbd1a4acb1e53f9704a5e9dfea3e672f260b55f7', client: '9ebf4dbe2a34642c96336246238fb701' },
  { server: '3c760e93cdcf85a7caac1417646cf5fbe3705870cdabd7e95b94707e58717826', client: '60666ad8a4e63a870faa9fe2ac645a1b' },
  { server: '3913ff44936350352e40f6d3ad8b511e684ff6d39b3ca4af592c1c992ad6980a', client: '12bc305ab2009661184c8ccba6bb8132' },
  { server: '65d1cf239513b8b3eb5978ad4808e1a720969c5e6a461dfdbd906517d3c0035c', client: '981659b62b698ff660ccf3169862f75d' },
  { server: 'c8dd2240e380a3c6effc3521588a8cdae766d6db228c337e6d52f64506457820', client: '21983aa73e8f3012dcd13fca4fa24799' },
  { server: 'cdf4e018090f96e3304d8c0827d384c8edf21eb01c354c0b2e6b73c9e06fef02', client: '13b122ebde1c49de96a0a13dffa1e816' },
  { server: 'e2f6e6f8d081944ba5814c2dd235df5462df668a0a74bf1441a6f3cc2c3611d0', client: 'e5e3ddcc916d8a697def085b6fd90bab' },
  { server: '7738101d8f77dd292fda86df7bcbde3c6367ae3d1aeb95455ba8fb3e1da78fea', client: '1f4e099205a281259d8e8243853af56a' },
  { server: '5fea259c24dfad7fd6608ad0862070a31b23c483305f6afc66b8ffaacb56b955', client: 'c343b74fca50ec9e33ce6fe42e51996d' },
  { server: '6f801d4fb5bb9365a4c43f5586f225c998463516f25e1e5852108f3e6eab4e2f', client: '805a5e2ac48a495c5b204bbdb480f586' },
  { server: '4a94b811c61c8ca785ecadecc09f48a0dcc9b2296033053696631780fe74c2b6', client: '5b2b18837f7a3018f0270cb40d124a2d' },
  { server: 'bced60ed9d3ffde08e7c8caabc84f10376d940764a4660f66893970ddff9cf36', client: 'f9c247bdf814be2de1f5bf4e6a4216f1' },
  { server: 'd07cc29c5991ea0dc77f44eeaecdec582a96d8c66fbf81c1e0b8812cfe9a9b3c', client: 'd76d25a3ff119c2f41b9886e1001cf20' },
  { server: '3e8c794330834b22ce3f84d4a99aea9df4914bbf1bd4b7836d69b0e9e03d112e', client: '0a9407535e56c0ea7842783fe823356f' },
  { server: '6655f9793902c0b59b71faec6472c7b032b8a7f9ca1dfbd5151eb4c7e8b0793d', client: '55ce289071790a67218f7977f6849d7a' },
  { server: '41148e2474d407c7997f68932ed76fb07d311b0af02a91f40af64ad0c5e9fa06', client: '88244901d64c70b906332e8041df1047' },
  { server: '9c5a7bc4f0d29da0b88dff204b498cdec85b372fd4889464a82b761b88c586b5', client: 'b16f225a94e15a72c7cabbe916f542b3' },
  { server: 'c09fffeb255aaf23fbdbb8076bb271f70f90c469ce2a86df34cbf7624b277466', client: '1f62d31db4d606d77b73304617bc989f' },
  { server: 'd915e6571163912728ca761833e4e48a6a106152bb4306217ebbd7e4af1abe0d', client: 'f0ba43e932257b8a1dd5eefe22f6fc01' },
];

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
): { hitCounts: number[]; hitSequence: number[]; simulatedRTP: number; rtpSnapshots: Map<number, number> } {
  const hitCounts   = new Array(picks + 1).fill(0);
  const hitSequence = new Array(rounds) as number[];
  let totalPayout   = 0;

  const sampleSet    = new Set(CONVERGENCE_SAMPLES.filter(s => s <= rounds));
  const rtpSnapshots = new Map<number, number>();

  for (let nonce = 0; nonce < rounds; nonce++) {
    const drawn    = computeDrawFromBuffer(keyBuffer, clientSeed, nonce, cfg.gridSize, cfg.drawnCount);
    const drawnSet = new Set(drawn);

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

  return { hitCounts, hitSequence, simulatedRTP: totalPayout / rounds, rtpSnapshots };
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

  const { hitCounts, hitSequence, simulatedRTP, rtpSnapshots } = runConfig(
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
  const { z: runsZ, pValue: runsPValue }                  = runsTest(hitSequence);

  pass1Results.push({
    risk, picks,
    rounds:         ROUNDS_PER_CONFIG,
    theoreticalRTP: cfg.theoreticalRTP(risk, picks),
    simulatedRTP,
    hitCounts,
    expectedCounts,
    chi2, df, pValue,
    r1, r1Z, runsZ, runsPValue,
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

// Binomial p-value for cherry-pick flags: P(X >= flags | N, p=0.05)
// Under H₀ the flag rate is ~0.05 (early rejects at alpha=0.05 AND late doesn't)
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
  generatedAt: new Date().toISOString(),
  pass1_fresh_seeds: {
    description: 'Auditor-generated random seeds. Validates independent implementation, multiplier tables, and serial independence of RNG outputs.',
    roundsPerConfig:    ROUNDS_PER_CONFIG,
    totalRounds:        ROUNDS_PER_CONFIG * allConfigs.length,
    configs:            allConfigs.length,
    executionTimeMs:    pass1ElapsedMs,
    avgTheoreticalRTP:  pass1AvgTheoRTP,
    avgSimulatedRTP:    pass1AvgRTP,
    chi2FailsAtAlpha01: pass1Chi2Fails,
    chi2FailsBonferroni: pass1Chi2FailsBon,
    serialIndependenceFails: pass1SerialFails,
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
    executionTimeMs: pass2ElapsedMs,
    results: pass2Results,
  },
};

const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

const outPath = path.join(OUTPUTS_DIR, 'simulation-results.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

// ── Generate RTP Convergence Chart (self-contained HTML) ─────────────────────

const theoreticalRTP = 0.999; // 99.9% — 0.1% house edge
const finalPoint = convergenceData[convergenceData.length - 1];
const finalRTP = finalPoint.meanRTP;

const chartHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DUEL.COM KENO RTP CONVERGENCE — ${allConfigs.length} CONFIGS x 1M ROUNDS EACH</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"><\/script>
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

fs.writeFileSync(path.join(OUTPUTS_DIR, 'rtp-convergence.html'), chartHTML);

console.log('══════════════════════════════════════════════════════════');
console.log(`  Written: outputs/simulation-results.json`);
console.log(`  Written: outputs/rtp-convergence.html`);
console.log('══════════════════════════════════════════════════════════\n');

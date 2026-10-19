/**
 * Steps 13–18: Dataset Integrity & Anti-Circularity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { DIFFICULTY_TO_RISK } from '../../src/config';
import type { RiskLevel } from '../../src/types';
import { binom, hypergeometricWeights, exactRtp, decimal, sub, eq, absCmp, toNumber, toString, Rational } from '../../src/exact';
import { displayMultiplier } from '../../src/money';
import {
  checkDatasetHash,
  EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_EPOCHS, EPOCH_SIZE,
  EXPECTED_PHASE_BETS, EXPECTED_PHASE_SEEDS,
} from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, cfg, phaseD } = ctx;

  // ── Step 13: Population & Phase Labels ────────────────────────────────────────
  // Labels are not a population. Every figure the old step compared was read from inside the
  // file being scored, so a uniform shrink — drop rounds, drop the matching seeds, adjust the
  // header — kept every label valid, every ratio intact, and passed. Re-pinning the hash after
  // the shrink is exactly what a forger does, so the dataset pin cannot catch it either.
  //
  // The counts come from src/loader.ts, which the dataset does not control, and a mismatch is
  // a FAIL rather than a FLAG: a capture that is not the capture of record is not a warning.
  const phases    = new Set(bets.map(b => b.phase));
  const hasAll    = ['A', 'B', 'C', 'D'].every(p => phases.has(p));
  const lastPhase = bets[bets.length - 1].phase;

  const betPhaseCounts: Record<string, number> = {};
  for (const b of bets) betPhaseCounts[b.phase] = (betPhaseCounts[b.phase] ?? 0) + 1;
  const seedPhaseCounts: Record<string, number> = {};
  for (const s of seeds) seedPhaseCounts[s.phase] = (seedPhaseCounts[s.phase] ?? 0) + 1;

  const popIssues: string[] = [];
  if (bets.length !== EXPECTED_BETS)   popIssues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (seeds.length !== EXPECTED_SEEDS) popIssues.push(`seed records ${seeds.length} != ${EXPECTED_SEEDS}`);
  for (const [p, n] of Object.entries(EXPECTED_PHASE_BETS)) {
    const got = betPhaseCounts[p] ?? 0;
    if (got !== n) popIssues.push(`phase ${p} bets ${got} != ${n}`);
  }
  for (const [p, n] of Object.entries(EXPECTED_PHASE_SEEDS)) {
    const got = seedPhaseCounts[p] ?? 0;
    if (got !== n) popIssues.push(`phase ${p} seeds ${got} != ${n}`);
  }
  for (const p of Object.keys(betPhaseCounts)) {
    if (!(p in EXPECTED_PHASE_BETS)) popIssues.push(`unexpected bet phase '${p}'`);
  }

  const s13 = step(13, 'Population & Phase Labels',
    hasAll && lastPhase === 'D' && popIssues.length === 0 ? 'PASS' : 'FAIL',
    popIssues.length > 0
      ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${popIssues.join('; ')}`
      : `All ${EXPECTED_BETS} bets and ${EXPECTED_SEEDS} seed records carry valid phase labels, and the `
        + `population matches the capture plan in src/loader.ts — code constants, not the dataset's own header.`,
    { betPhases: betPhaseCounts, seedPhases: seedPhaseCounts, bets: bets.length, seeds: seeds.length },
  );

  // ── Step 14: Dataset hash (re-confirm) ────────────────────────────────────────
  const h2  = checkDatasetHash();
  const s14 = step(14, 'Dataset Hash',
    h2.match ? 'PASS' : 'FAIL',
    h2.expected,
  );

  // ── Step 15: Epoch Size ───────────────────────────────────────────────────────
  // Reporting min and max is not asserting them, and asserting only that they AGREE
  // (`min === max && min > 0`) is satisfied by any UNIFORM truncation: shrink every epoch from
  // 50 bets to 5 and min still equals max. The size is pinned to EPOCH_SIZE in src/loader.ts,
  // the epoch COUNT is pinned alongside it — an intact size with epochs missing is the other
  // half of the same shrink — and the pair is reconciled against the declared bet total.
  const epochSizes = new Map<string, number>();
  for (const b of bets) {
    epochSizes.set(b.seed.serverSeedHashed, (epochSizes.get(b.seed.serverSeedHashed) ?? 0) + 1);
  }
  const sizes   = [...epochSizes.values()];
  const maxSize = Math.max(...sizes);
  const minSize = Math.min(...sizes);
  const offenders = [...epochSizes.entries()]
    .filter(([, n]) => n !== EPOCH_SIZE)
    .map(([h, n]) => `${h.substring(0, 16)}: ${n}`);

  const epochIssues: string[] = [];
  if (epochSizes.size !== EXPECTED_EPOCHS) {
    epochIssues.push(`${epochSizes.size} epochs != ${EXPECTED_EPOCHS}`);
  }
  if (offenders.length > 0) {
    epochIssues.push(`${offenders.length} epoch(s) != ${EPOCH_SIZE} bets (${offenders.slice(0, 5).join('; ')})`);
  }
  if (EXPECTED_EPOCHS * EPOCH_SIZE !== EXPECTED_BETS) {
    epochIssues.push(`capture plan inconsistent: ${EXPECTED_EPOCHS} x ${EPOCH_SIZE} != ${EXPECTED_BETS}`);
  }

  const s15 = step(15, 'Epoch Size',
    epochIssues.length === 0 ? 'PASS' : 'FAIL',
    epochIssues.length > 0
      ? `EPOCH POPULATION MISMATCH vs the capture plan in src/loader.ts: ${epochIssues.join('; ')}`
      : `Exactly ${EXPECTED_EPOCHS} epochs of exactly ${EPOCH_SIZE} bets each, as pinned in src/loader.ts, `
        + `reconciling to the declared ${EXPECTED_BETS} bets.`,
    { epochs: epochSizes.size, expectedEpochs: EXPECTED_EPOCHS, minSize, maxSize, expectedSize: EPOCH_SIZE, offEpochs: offenders.length },
  );

  // ── Step 16: Hit symmetry (hypergeometric mode) ───────────────────────────────
  const p10  = 10;
  let maxK   = 0;
  let maxP   = 0;
  for (let k = 0; k <= p10; k++) {
    const prob = cfg.hitProbability(p10, k);
    if (prob > maxP) { maxP = prob; maxK = k; }
  }
  // A property of the probability model every RTP figure rests on, so it is pass/fail by nature:
  // a wrong hitProbability is a FAIL, never a FLAG that exits 2. The FAIL detail names the
  // measured mode instead of repeating the claim.
  const modeOk = maxK === 2 || maxK === 3;
  const s16 = step(16, 'Hit Symmetry (hypergeometric mode verification)',
    modeOk ? 'PASS' : 'FAIL',
    modeOk
      ? `picks=10: the mode of the hypergeometric hit distribution is ${maxK}, within {2, 3} straddling E[hits]=2.5`
      : `picks=10: the mode of the computed hit distribution is ${maxK}, not 2 or 3 — hitProbability is not the hypergeometric model`,
    { picks: p10, mode: maxK, modeProbability: maxP, expectedHits: 2.5 },
  );

  // ── Step 17: Probability independence — anti-circularity ─────────────────────
  // The detail states the BOUND; the measurement goes in `data`, where the reproduction gate
  // can compare it under tolerance instead of demanding that a float's decimal rendering be
  // identical on every machine that ever re-runs this suite.
  //
  // THE BOUND IS FLOATING-POINT ERROR, NOT A PERCENTAGE. The old 0.001 cap on an identity that
  // holds to double precision (worst measured deviation 1.1e-16, half an ulp of 0.999) would have
  // passed a config paying 99.8% — the full width of the house edge. Each RTP is a sum of at most
  // 11 terms P(k)×m_k: P(k) is exact-integer combinatorics with one rounded division (≤ ε), each
  // product adds ≤ ε, the ≤ 10 additions add ≤ 10ε of the sum, and parsing the table's decimal
  // multipliers adds ≤ ε/2 — about 12.5ε in all, rounded up to 16ε = 3.552713678800501e-15.
  // Anything wider is a table that does not encode 99.9%.
  const RTP_DEVIATION_BOUND = 16 * Number.EPSILON;
  let maxDeviation = 0;
  let worstConfig  = '';
  let worstRTP     = 0;
  let configsEvaluated = 0;
  for (const { risk, picks } of cfg.allConfigs()) {
    configsEvaluated++;
    let indepRTP = 0;
    for (let k = 0; k <= picks; k++) {
      indepRTP += cfg.hitProbability(picks, k) * cfg.multiplier(risk, picks, k);
    }
    // A non-finite RTP (a NaN multiplier) must not compare its way past the bound.
    const deviation = Number.isFinite(indepRTP) ? Math.abs(indepRTP - 0.999) : Infinity;
    if (deviation > maxDeviation) {
      maxDeviation = deviation;
      worstConfig  = `${risk}/picks=${picks}`;
      worstRTP     = indepRTP;
    }
  }

  // ── Step 17, exact half (KENO-18 / KENO-19) ────────────────────────────────────
  // The double-precision identity above is kept, and the same questions are now answered EXACTLY
  // in integer / rational arithmetic (src/exact.ts):
  //   the law     for every picks count n = 1 … 10, the hypergeometric weights w(k) = C(n,k)·C(N−n,d−k)
  //               satisfy Σ_k w(k) = C(N,d) and N·Σ_k k·w(k) = n·d·C(N,d) (mean n·d/N) exactly, and
  //               the double P(k) every other step uses equals the correctly rounded w(k)/C(N,d);
  //   the RTP     every (risk, picks) RTP = Σ_k w(k)·m(k) / C(N,d) as a reduced fraction from the
  //               table's decimal literals, compared with the claim 999/1000; the spread is printed;
  //   controls    a weight corrupted by one unit, and a table cell corrupted by one unit in its last
  //               printed place, must each be REJECTED by the same checks — or the checks decide
  //               nothing and the step FAILs.
  // A configuration whose exact RTP is not exactly 999/1000 is DISCLOSED with its magnitude
  // (limitation DL-7), not flagged — decision-12 on this board; the double-precision bound above
  // (16ε) still governs pass/fail and the exact deviation is held to the same bound.
  const Ngrid = cfg.gridSize, dDrawn = cfg.drawnCount;
  const Ctot = binom(Ngrid, dDrawn);
  const lawHolds = (n: number, w: bigint[]): boolean => {
    const sum = w.reduce((a, x) => a + x, 0n);
    const mean = w.reduce((a, x, k) => a + BigInt(k) * x, 0n);
    return sum === Ctot && BigInt(Ngrid) * mean === BigInt(n * dDrawn) * Ctot;
  };
  let lawFails = 0, floatPMismatch = 0, picksCounts = 0;
  for (let n = cfg.minPicks; n <= cfg.maxPicks; n++) {
    picksCounts++;
    const w = hypergeometricWeights(Ngrid, dDrawn, n);
    if (!lawHolds(n, w)) lawFails++;
    w.forEach((x, k) => { if (cfg.hitProbability(n, k) !== Number(x) / Number(Ctot)) floatPMismatch++; });
  }
  const claim: Rational = { num: 999n, den: 1000n };
  const EXACT_BOUND: Rational = { num: 1n, den: 2n ** 48n };   // 16ε = 16 · 2^-52 = 2^-48, exactly
  const literalsOf = (risk: RiskLevel, picks: number): string[] =>
    ctx.configRaw.data.multipliers[risk][String(picks)].map((x: number) => String(x));
  let exactEqual = 0, exactBeyondBound = 0;
  let worstExact: Rational = { num: 0n, den: 1n }, worstExactAt = '';
  let minDelta = Infinity, maxDelta = -Infinity;
  let servedWorst: Rational = { num: 0n, den: 1n }, servedWorstAt = '';
  const perConfigExactDelta: Record<string, number> = {};
  for (const { risk, picks } of cfg.allConfigs()) {
    const w = hypergeometricWeights(Ngrid, dDrawn, picks);
    const rtp = exactRtp(w, Ctot, literalsOf(risk, picks));
    const delta = sub(rtp, claim);
    const dNum = toNumber(delta);
    perConfigExactDelta[`${risk}/${picks}`] = dNum;
    if (dNum < minDelta) minDelta = dNum;
    if (dNum > maxDelta) maxDelta = dNum;
    if (eq(rtp, claim)) exactEqual++;
    if (absCmp(delta, EXACT_BOUND) > 0) exactBeyondBound++;
    if (absCmp(delta, worstExact) > 0) { worstExact = delta; worstExactAt = `${risk}/picks=${picks}`; }
    // What a player is actually paid on: the multiplier served at 13 dp (src/money.ts). Disclosed only.
    const served = exactRtp(w, Ctot, literalsOf(risk, picks).map(l => displayMultiplier(Number(l))));
    const sDelta = sub(served, claim);
    if (absCmp(sDelta, servedWorst) > 0) { servedWorst = sDelta; servedWorstAt = `${risk}/picks=${picks}`; }
  }
  // Negative controls — the checks above must reject a corrupted input.
  const w10 = hypergeometricWeights(Ngrid, dDrawn, 10);
  const corruptW = [...w10]; corruptW[3] += 1n;
  const lawControlRejected = !lawHolds(10, corruptW);
  const lits = literalsOf('CLASSIC', 1);
  const bumped = [...lits]; bumped[1] = '3.997';   // 3.996 + one unit in its last printed place
  const tableControlRejected = !eq(exactRtp(hypergeometricWeights(Ngrid, dDrawn, 1), Ctot, bumped), claim)
    && absCmp(sub(exactRtp(hypergeometricWeights(Ngrid, dDrawn, 1), Ctot, bumped), claim), EXACT_BOUND) > 0;

  const exactIssues: string[] = [];
  if (picksCounts !== 10) exactIssues.push(`${picksCounts} picks counts enumerated != 10`);
  if (lawFails > 0) exactIssues.push(`${lawFails} picks count(s) where Σ w != C(N,d) or the mean != n·d/N exactly`);
  if (floatPMismatch > 0) exactIssues.push(`${floatPMismatch} P(k) values the package uses differ from the correctly rounded exact law`);
  if (exactBeyondBound > 0) exactIssues.push(`${exactBeyondBound} config(s) whose EXACT RTP differs from 999/1000 by more than 16ε; worst ${worstExactAt} Δ = ${toString(worstExact)}`);
  if (!lawControlRejected) exactIssues.push('NEGATIVE CONTROL: a hypergeometric weight corrupted by one unit was NOT rejected by the law check');
  if (!tableControlRejected) exactIssues.push('NEGATIVE CONTROL: a table cell corrupted by one unit in its last place was NOT rejected by the exact RTP check');

  const s17Ok = maxDeviation <= RTP_DEVIATION_BOUND && configsEvaluated === 40 && exactIssues.length === 0;
  const s17 = step(17, 'Probability Independence (Anti-Circularity)',
    s17Ok ? 'PASS' : 'FAIL',
    s17Ok
      ? `All 40 configs: RTP proven via independent hypergeometric P(k) = C(picks,k)×C(40-picks,10-k)/C(40,10). `
        + `Every config's RTP equals 99.9% to within ${RTP_DEVIATION_BOUND} (16 × double-precision epsilon, the `
        + `floating-point error bound of the sum); the widest deviation is on ${worstConfig}. EXACT: for every picks count `
        + `1–10 the weights sum to C(40,10) and the mean is picks·10/40 in integer arithmetic, and the P(k) used everywhere is `
        + `the correctly rounded exact law; exact rational RTP from the table literals equals 999/1000 on ${exactEqual} of 40 `
        + `configs and lies within 16ε on all 40 (the others disclosed with their magnitude, DL-7); both negative controls rejected.`
      : maxDeviation > RTP_DEVIATION_BOUND || configsEvaluated !== 40
        ? `RTP identity broken: ${configsEvaluated}/40 configs evaluated; ${worstConfig} has RTP ${worstRTP}, `
          + `|RTP − 0.999| = ${maxDeviation} > ${RTP_DEVIATION_BOUND} (16 × double-precision epsilon).`
        : `Exact check failed: ${exactIssues.join('; ')}`,
    { configs: configsEvaluated, deviationBound: RTP_DEVIATION_BOUND, maxDeviation, worstConfig, worstConfigRTP: worstRTP, targetRTP: 0.999,
      exact: {
        picksCountsEnumerated: picksCounts, lawFailures: lawFails, floatProbabilityMismatches: floatPMismatch,
        configsExactlyEqualClaim: exactEqual, configsDifferingFromClaim: 40 - exactEqual, configsBeyond16Epsilon: exactBeyondBound,
        worstDeltaAt: worstExactAt, worstDeltaExact: toString(worstExact), worstDelta: toNumber(worstExact),
        deltaSpread: { min: minDelta, max: maxDelta }, perConfigDelta: perConfigExactDelta,
        servedMultiplierRtpWorstDeltaAt: servedWorstAt, servedMultiplierRtpWorstDeltaExact: toString(servedWorst),
        servedMultiplierRtpWorstDelta: toNumber(servedWorst),
        negativeControls: { corruptedWeightRejected: lawControlRejected, corruptedTableCellRejected: tableControlRejected },
      } },
  );

  // ── Step 18: Phase D — client seed variation ──────────────────────────────────
  const dClientSeeds = new Set(phaseD.map(b => b.seed.clientSeed));
  const dConfigs     = new Set(phaseD.map(b => `${DIFFICULTY_TO_RISK[b.request.difficulty]}|${b.request.selected_positions.length}`));
  // The step exists to show the Phase D equivalence holds across MORE THAN ONE client seed. Fewer
  // than two, or a Phase D that is not the capture plan's, means that was not shown: FAIL, not FLAG.
  // Each Phase D epoch (EPOCH_SIZE bets) runs on its own client seed, so the plan fixes the count.
  const expectedD        = EXPECTED_PHASE_BETS.D;
  const expectedDClients = expectedD / EPOCH_SIZE;
  const s18Issues: string[] = [];
  if (phaseD.length !== expectedD) s18Issues.push(`Phase D holds ${phaseD.length} bets != ${expectedD}`);
  if (dClientSeeds.size < 2) s18Issues.push(`only ${dClientSeeds.size} distinct client seed(s) — variation not shown`);
  if (dClientSeeds.size !== expectedDClients) s18Issues.push(`${dClientSeeds.size} distinct client seeds != ${expectedDClients} (one per Phase D epoch)`);
  const s18 = step(18, 'Phase D — Client Seed Variation',
    s18Issues.length === 0 ? 'PASS' : 'FAIL',
    s18Issues.length > 0
      ? `${s18Issues.join('; ')}; configs: ${[...dConfigs].join(', ')}`
      : `${phaseD.length} bets at $10, ${dClientSeeds.size} distinct client seeds, configs: ${[...dConfigs].join(', ')}`,
    { phaseDBets: phaseD.length, expectedPhaseDBets: expectedD, distinctClientSeeds: dClientSeeds.size, expectedClientSeeds: expectedDClients },
  );

  return [s13, s14, s15, s16, s17, s18];
}

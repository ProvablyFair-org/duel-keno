/**
 * Step 22: Draw Bias Bound (profile KENO-08).
 *
 * The draw is a backward Fisher-Yates shuffle of the 40 grid positions: for i = 39 … 1 one 32-bit
 * chunk selects j uniformly in 0 … i, so the ranges the selection uses are 40, 39, …, 2 — every one
 * of them is ENUMERATED here, not sampled. A chunk is accepted iff chunk < maxFair(range), with
 * maxFair taken from src/rng.ts maxFairFor — the very expression the draw executes — so an edit to
 * the ceiling in the draw is an edit to what this step measures.
 *
 * For each range r: A = maxFair(r) accepted values out of 2^32, R = 2^32 − A rejected. Each residue
 * j ∈ 0 … r−1 is hit by ⌊A/r⌋ or ⌈A/r⌉ accepted values, so the selection bias is exactly
 *   bias(r) = max_j |count_j / A − 1/r|,
 * computed here in integer arithmetic. The draw's ceiling (spec docs/ALGORITHM.md §2 Step 2:
 * LIMIT = floor(2^32 / r) · r) makes A a whole multiple of r, so bias(r) = 0 on every range — exactly
 * uniform, stronger than the profile's 2^-32 floor. The DECLARED property is exactness (the spec's
 * rejection rule exists to remove modulo bias), so a non-zero bias on any range is a FAIL even where
 * it would sit under 2^-32: a naive `chunk % r` over all 2^32 values is biased by 1.3970e-10 at r = 40
 * (24 / (40 · 2^32)) — under the 2^-32 ≈ 2.3283e-10 floor, and still not what the spec states.
 * (Duel's Verify-tab ceiling, 0xFFFFFFFF − (0xFFFFFFFF mod r), equals the spec's on the 34 ranges that
 * are not powers of two and is r lower on 2, 4, 8, 16, 32; both are whole multiples of r.)
 *
 * REJECTION CENSUS. Step 5 tallies what the draw actually did while recomputing all 5,100 captured
 * bets: HMAC calls, chunks scanned, chunks rejected, cursor advances. Exactly one chunk is accepted
 * per shuffle step, so scanned − rejected must equal 39 × 5,100; the census is bound to that.
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { maxFairFor } from '../../src/rng';
import { EXPECTED_BETS } from '../../src/loader';

const TWO32 = 2n ** 32n;

export function run(ctx: VerifyContext): StepResult[] {
  const G = ctx.cfg.gridSize;
  const ranges: Array<{ range: number; maxFair: number; accepted: string; rejected: number; biasNum: string; biasDen: string; exact: boolean }> = [];
  let nonExact = 0, beyondFloor = 0, worstRejected = 0, worstRejectedRange = 0;
  let expectedRejectionsPerDraw = 0;
  for (let i = G - 1; i > 0; i--) {
    const r = i + 1;
    const A = BigInt(maxFairFor(r));
    const R = TWO32 - A;
    const q = A / BigInt(r), rem = A % BigInt(r);
    // count_j ∈ {q, q+1}; |count/A − 1/r| = |r·count − A| / (r·A). With rem residues at q+1 and
    // r − rem at q, the extremes are (r − rem)… handled directly on both values that occur.
    const cands: bigint[] = [];
    if (rem > 0n) cands.push(BigInt(r) * (q + 1n) - A);
    if (BigInt(r) - rem > 0n) cands.push(A - BigInt(r) * q);
    const biasNum = cands.reduce((m, x) => (x < 0n ? -x : x) > m ? (x < 0n ? -x : x) : m, 0n);
    const biasDen = BigInt(r) * A;
    const exact = biasNum === 0n;
    if (!exact) nonExact++;
    // bias > 2^-32  ⇔  biasNum · 2^32 > biasDen
    if (biasNum * TWO32 > biasDen) beyondFloor++;
    if (Number(R) > worstRejected) { worstRejected = Number(R); worstRejectedRange = r; }
    expectedRejectionsPerDraw += Number(R) / 2 ** 32;
    ranges.push({ range: r, maxFair: Number(A), accepted: A.toString(), rejected: Number(R), biasNum: biasNum.toString(), biasDen: biasDen.toString(), exact });
  }

  const census = ctx.drawCensus;
  const steps = (G - 1) * EXPECTED_BETS;
  const issues: string[] = [];
  if (ranges.length !== G - 1) issues.push(`${ranges.length} ranges enumerated != ${G - 1} (2 … ${G})`);
  if (nonExact > 0) issues.push(`${nonExact} range(s) where the accepted count is not a whole multiple of the range — the selection is biased, not exact`);
  if (beyondFloor > 0) issues.push(`${beyondFloor} range(s) biased beyond the 2^-32 floor`);
  if (!census) issues.push('no rejection census — Step 5 did not run the draw');
  else {
    if (census.chunksScanned - census.chunksRejected !== steps) {
      issues.push(`census: ${census.chunksScanned} scanned − ${census.chunksRejected} rejected != ${steps} shuffle steps (39 × ${EXPECTED_BETS})`);
    }
    if (census.hmacCalls !== steps + census.cursorAdvances) {
      issues.push(`census: ${census.hmacCalls} HMAC calls != ${steps} + ${census.cursorAdvances} cursor advances`);
    }
  }

  const ok = issues.length === 0;
  return [step(22, 'Draw Bias Bound (rejection ceiling, every range enumerated)',
    ok ? 'PASS' : 'FAIL',
    ok
      ? `All ${G - 1} ranges the backward shuffle uses (${G} … 2) enumerated over all 2^32 chunk values with the draw's own `
        + `maxFair: on every range the accepted count is a whole multiple of the range, so each index is selected by exactly `
        + `the same number of values — bias exactly 0 (profile floor 2^-32). Largest rejection: ${worstRejected} of 2^32 values `
        + `at range ${worstRejectedRange} (maxFair 0x${maxFairFor(worstRejectedRange).toString(16).toUpperCase()}). Rejection census `
        + `over the ${EXPECTED_BETS} recomputed draws: ${census!.chunksRejected} chunk(s) rejected, ${census!.cursorAdvances} cursor `
        + `advance(s), ${steps} chunks accepted = 39 × ${EXPECTED_BETS}.`
      : `Draw bias bound failed: ${issues.join('; ')}`,
    { rangesEnumerated: ranges.length, nonExactRanges: nonExact, rangesBeyond2pow32: beyondFloor,
      largestRejection: worstRejected, largestRejectionRange: worstRejectedRange,
      expectedRejectedChunksPerDraw: expectedRejectionsPerDraw,
      census, shuffleSteps: steps, ranges },
  )];
}

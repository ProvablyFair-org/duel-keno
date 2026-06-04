/**
 * Steps 5–6: RNG Determinism
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { computeDrawFromBuffer } from '../../src/rng';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, seedMap } = ctx;

  // ── Step 5: Draw recomputation ────────────────────────────────────────────────
  let mismatches = 0;
  let skipped    = 0;
  for (const b of bets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { skipped++; continue; }
    const key      = Buffer.from(ss, 'hex');
    const computed = computeDrawFromBuffer(key, b.seed.clientSeed, b.seed.nonce);
    const apiSet   = new Set(b.response.drawn_numbers);
    const compSet  = new Set(computed);
    if (apiSet.size !== compSet.size || [...apiSet].some(n => !compSet.has(n))) {
      mismatches++;
    }
  }
  ctx.step5Mismatches = mismatches;
  ctx.step5Skipped    = skipped;
  const s5 = step(5, 'Draw Recomputation (RNG determinism)',
    mismatches === 0 ? 'PASS' : 'FAIL',
    `${bets.length - skipped}/${bets.length} verified, ${mismatches} SET mismatches, ${skipped} skipped`,
  );

  // ── Step 6: Client seed influence ─────────────────────────────────────────────
  // Substitute a wrong client seed across ALL epochs and count how many draws change.
  // (The old version tested a single seed with two hardcoded strings — a smoke test,
  //  not quantified proof.)
  const wrongClientSeed = 'WRONG_CLIENT_SEED_FOR_AUDIT_TEST';
  let totalChanged = 0;
  let totalChecked = 0;
  let epochsTested = 0;
  const zeroChangeEpochs: string[] = [];

  for (const [hash, epochBets] of ctx.byHash) {
    const ss = seedMap.get(hash);
    if (!ss) continue;
    const key = Buffer.from(ss, 'hex');
    let changed = 0;
    for (const bet of epochBets) {
      const correctDraw = new Set(computeDrawFromBuffer(key, bet.seed.clientSeed, bet.seed.nonce));
      const wrongDraw   = new Set(computeDrawFromBuffer(key, wrongClientSeed, bet.seed.nonce));
      if (correctDraw.size !== wrongDraw.size || [...correctDraw].some(n => !wrongDraw.has(n))) changed++;
      totalChecked++;
    }
    totalChanged += changed;
    epochsTested++;
    if (changed === 0) {
      zeroChangeEpochs.push(`Epoch ${hash.substring(0, 16)}: wrong client seed produced 0 changed draws`);
    }
  }

  const pctChanged = totalChecked > 0 ? ((totalChanged / totalChecked) * 100).toFixed(1) : '0.0';
  const s6Pass = totalChanged > 0 && zeroChangeEpochs.length === 0;
  const s6 = step(6, 'Client Seed Influence',
    s6Pass ? 'PASS' : 'FAIL',
    s6Pass
      ? `Wrong client seed changed ${totalChanged}/${totalChecked} draws (${pctChanged}%) across ${epochsTested} epochs`
      : `Client seed influence failed: ${zeroChangeEpochs.length} epochs with 0 changed draws. ${zeroChangeEpochs.slice(0, 3).join('; ')}`,
  );

  return [s5, s6];
}

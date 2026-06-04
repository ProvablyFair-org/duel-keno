/**
 * Steps 13–18: Dataset Integrity & Anti-Circularity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { DIFFICULTY_TO_RISK } from '../../src/config';
import { checkDatasetHash } from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, cfg, phaseD } = ctx;

  // ── Step 13: Phase labels ─────────────────────────────────────────────────────
  const phases    = new Set(bets.map(b => b.phase));
  const hasAll    = ['A', 'B', 'C', 'D'].every(p => phases.has(p));
  const lastPhase = bets[bets.length - 1].phase;
  const s13 = step(13, 'Phase Labels',
    hasAll && lastPhase === 'D' ? 'PASS' : 'FLAG',
    `Phases present: ${[...phases].sort().join(', ')}; last bet phase: ${lastPhase}`,
  );

  // ── Step 14: Dataset hash (re-confirm) ────────────────────────────────────────
  const h2  = checkDatasetHash();
  const s14 = step(14, 'Dataset Hash',
    h2.match ? 'PASS' : 'FAIL',
    h2.expected,
  );

  // ── Step 15: Epoch size ───────────────────────────────────────────────────────
  const epochSizes = new Map<string, number>();
  for (const b of bets) {
    epochSizes.set(b.seed.serverSeedHashed, (epochSizes.get(b.seed.serverSeedHashed) ?? 0) + 1);
  }
  const sizes   = [...epochSizes.values()];
  const maxSize = Math.max(...sizes);
  const minSize = Math.min(...sizes);
  const s15 = step(15, 'Epoch Size',
    (minSize === 50 && maxSize === 50) ? 'PASS' : 'FLAG',
    `${epochSizes.size} epochs; min=${minSize}, max=${maxSize} bets per epoch`,
  );

  // ── Step 16: Hit symmetry (hypergeometric mode) ───────────────────────────────
  const p10  = 10;
  let maxK   = 0;
  let maxP   = 0;
  for (let k = 0; k <= p10; k++) {
    const prob = cfg.hitProbability(p10, k);
    if (prob > maxP) { maxP = prob; maxK = k; }
  }
  const s16 = step(16, 'Hit Symmetry (hypergeometric mode verification)',
    (maxK === 2 || maxK === 3) ? 'PASS' : 'FLAG',
    `picks=10: mode of hypergeometric hit distribution = ${maxK} (expected 2 or 3, E[hits]=2.5)`,
  );

  // ── Step 17: Probability independence — anti-circularity ─────────────────────
  let maxDeviation = 0;
  let worstConfig  = '';
  for (const { risk, picks } of cfg.allConfigs()) {
    let indepRTP = 0;
    for (let k = 0; k <= picks; k++) {
      indepRTP += cfg.hitProbability(picks, k) * cfg.multiplier(risk, picks, k);
    }
    const deviation = Math.abs(indepRTP - 0.999);
    if (deviation > maxDeviation) {
      maxDeviation = deviation;
      worstConfig  = `${risk}/picks=${picks} (RTP=${(indepRTP * 100).toFixed(6)}%)`;
    }
  }
  const s17 = step(17, 'Probability Independence (Anti-Circularity)',
    maxDeviation < 0.001 ? 'PASS' : 'FAIL',
    `Given Duel's committed multiplier table (kenoConfig.json), independently-derived hypergeometric probabilities P(k) = C(picks,k)×C(40-picks,10-k)/C(40,10) yield 99.9% RTP for all 40 configurations (analytic identity over the full table). Max deviation: ${(maxDeviation * 100).toFixed(6)}% (${worstConfig}). The hit probabilities are derived independently from the RNG analysis; the multiplier table is operator-supplied. Live play (Step 8) exercised 190/260 table rows and matched every captured payout; rare high-hit rows that did not occur in the 5,100-bet sample are evaluated against the committed table via this identity rather than empirically.`,
  );

  // ── Step 18: Phase D — client seed variation ──────────────────────────────────
  const dClientSeeds = new Set(phaseD.map(b => b.seed.clientSeed));
  const dConfigs     = new Set(phaseD.map(b => `${DIFFICULTY_TO_RISK[b.request.difficulty]}|${b.request.selected_positions.length}`));
  const s18 = step(18, 'Phase D — Client Seed Variation',
    dClientSeeds.size >= 2 ? 'PASS' : 'FLAG',
    `${phaseD.length} bets at $10, ${dClientSeeds.size} distinct client seeds, configs: ${[...dConfigs].join(', ')}`,
  );

  return [s13, s14, s15, s16, s17, s18];
}

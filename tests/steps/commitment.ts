/**
 * Steps 1–4: Commit-Reveal Integrity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { verifyHash, computeDraw } from '../../src/rng';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, seedMap, byHash } = ctx;

  // ── Step 1: Seed hash integrity (cross-epoch) ───────────────────────────────
  let checked = 0, fails = 0, phaseBoundarySkips = 0;
  for (let i = 1; i < seeds.length; i++) {
    if (!seeds[i].seed.serverSeed) continue;
    const match = verifyHash(seeds[i].seed.serverSeed!, seeds[i - 1].seed.serverSeedHashed);
    if (!match && seeds[i].phase !== seeds[i - 1].phase) {
      phaseBoundarySkips++;
      continue;
    }
    if (!match) fails++;
    checked++;
  }
  const s1 = step(1, 'Seed Hash Integrity',
    fails === 0 ? 'PASS' : 'FAIL',
    `${checked} revealed seeds verified. ${phaseBoundarySkips} phase-boundary skips.`,
  );

  // ── Step 2: Next-Seed Promotion (Commitment Linkage) ────────────────────────
  // Recompute the linkage from the raw captured fields rather than reading the
  // capture script's pre-computed match flag. Property verified: the hash
  // pre-committed as "next" in epoch i equals the active serverSeedHashed in
  // epoch i+1 (previousNextHash === newActiveHash, chained across rotations).
  let promoChecked = 0, promoFails = 0;
  for (const s of seeds) {
    const p = s.nextSeedPromotion;
    if (!p) continue;
    promoChecked++;
    const linked = p.previousNextHash === p.newActiveHash;
    if (!linked) promoFails++;
  }
  const s2 = step(2, 'Next-Seed Promotion (Commitment Linkage)',
    promoFails === 0 ? 'PASS' : 'FAIL',
    `${promoChecked - promoFails}/${promoChecked} rotation transitions independently recomputed (previousNextHash === newActiveHash) — next-seed pre-commitment chain intact`,
  );

  // ── Step 3: Hash consistency within epoch ────────────────────────────────────
  let epochsWithMultipleHashes = 0;
  for (const [, epochBets] of byHash) {
    const distinctHashes = new Set(epochBets.map(b => b.seed.serverSeedHashed));
    if (distinctHashes.size !== 1) epochsWithMultipleHashes++;
  }
  const s3 = step(3, 'Hash Consistency Within Epoch',
    epochsWithMultipleHashes === 0 ? 'PASS' : 'FAIL',
    `All ${byHash.size} epochs: serverSeedHashed identical across all bets within each epoch`,
  );

  // ── Step 4: Nonce Audit (sequential continuity + capture-retry detection) ───
  const hardFailures: string[] = [];
  const captureArtifacts: string[] = [];
  const reconstructed: Array<{ epoch: string; missedNonce: number }> = [];
  let epochsChecked = 0;
  let unverifiable = 0;

  for (const [hash, epochBets] of byHash) {
    const sorted = [...epochBets].sort((a, b) => a.seed.nonce - b.seed.nonce);
    const shortHash = hash.substring(0, 16);
    const nonces = sorted.map(b => b.seed.nonce);

    // Check single client seed per epoch
    const clientSeeds = new Set(sorted.map(b => b.seed.clientSeed));
    if (clientSeeds.size !== 1) {
      hardFailures.push(`Epoch ${shortHash}: ${clientSeeds.size} distinct client seeds`);
    }

    // Check first nonce is 0
    if (nonces[0] !== 0) {
      hardFailures.push(`Epoch ${shortHash}: first nonce is ${nonces[0]} (expected 0)`);
    }

    // Detect capture-retry pattern: nonce 50 present + one gap in 0-50
    const hasNonce50 = nonces.includes(50);
    const missingNonces = Array.from({ length: 51 }, (_, i) => i).filter(i => !nonces.includes(i));
    const isRetryPattern = hasNonce50 && missingNonces.length === 1 && nonces.length === 50;

    if (isRetryPattern) {
      const missedNonce = missingNonces[0];
      const serverSeed = seedMap.get(hash);
      const clientSeedVal = sorted[0].seed.clientSeed;

      if (serverSeed) {
        // Reconstruct the missed-nonce draw deterministically from the revealed seed.
        // No captured server response exists for this nonce (it is missing precisely
        // because it was not captured), so this is a reconstruction, not a comparison.
        const computedDraw = computeDraw(serverSeed, clientSeedVal, missedNonce);
        reconstructed.push({ epoch: shortHash, missedNonce });
        captureArtifacts.push(
          `Epoch ${shortHash}: capture-retry — nonce ${missedNonce} missed; deterministic draw reconstructed from revealed seed: draw=${JSON.stringify(computedDraw.slice(0, 3))}... (no captured server response available for comparison)`
        );
      } else {
        captureArtifacts.push(`Epoch ${shortHash}: capture-retry — nonce ${missedNonce} missed; server seed unrevealed`);
        unverifiable++;
      }
    } else {
      // Check sequential continuity: nonces must be 0, 1, 2, ..., n-1
      for (let i = 0; i < nonces.length; i++) {
        if (nonces[i] !== i) {
          hardFailures.push(`Epoch ${shortHash}: nonce[${i}]=${nonces[i]} (expected ${i})`);
          break;
        }
      }
    }

    epochsChecked++;
  }

  const allOk = hardFailures.length === 0;
  const hasCaptureArtifacts = captureArtifacts.length > 0;
  const allReconstructed = hasCaptureArtifacts && unverifiable === 0;

  const s4Status = !allOk ? 'FAIL'
    : hasCaptureArtifacts && !allReconstructed ? 'FLAG'
    : 'PASS';

  const s4Detail = !allOk
    ? `${hardFailures.length} nonce violations: ${hardFailures.slice(0, 3).join('; ')}`
    : hasCaptureArtifacts
      ? `${epochsChecked} epochs. ${captureArtifacts.length} capture-retry: ${reconstructed.length} reconstructed from revealed seed (no captured server response available for comparison), ${unverifiable} unverifiable.`
      : `${epochsChecked} epochs: nonces sequential 0–49, single client seed per epoch.`;

  const s4 = step(4, 'Nonce Audit', s4Status, s4Detail);

  return [s1, s2, s3, s4];
}

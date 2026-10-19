/**
 * Steps 1–4: Commit-Reveal Integrity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { verifyHash, computeDraw } from '../../src/rng';
import {
  EXPECTED_SEEDS, EXPECTED_EPOCHS, EXPECTED_CHAIN_LINKS, EXPECTED_PHASE_BOUNDARY_SKIPS,
  EPOCH_SIZE, NONCE_BASE, groupByEpochWindow,
} from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, seedMap, byHash } = ctx;

  // ── Step 1: Seed hash integrity (cross-epoch) ───────────────────────────────
  // "0 mismatches" IS NOT A RESULT. An empty seed list satisfies it, and so does a list
  // truncated to a single entry — the old form of this step counted only the seeds it
  // happened to be handed and passed whenever none of them disagreed. What makes the
  // absence of a mismatch mean something is the SIZE of the thing that produced it, so the
  // population declared in src/loader.ts is asserted here alongside the hashes.
  //
  // A seed whose plaintext is never revealed cannot be checked, and an unverifiable seed
  // must be COUNTED AND REPORTED, never `continue`d past in silence: silent skipping is how
  // a step arrives at "0 mismatches" by checking nothing.
  let verified = 0, fails = 0, phaseBoundarySkips = 0, boundaryRepeats = 0, unrevealed = 0;
  const failures: string[] = [];
  for (let i = 1; i < seeds.length; i++) {
    if (!seeds[i].seed.serverSeed) { unrevealed++; continue; }
    const match = verifyHash(seeds[i].seed.serverSeed!, seeds[i - 1].seed.serverSeedHashed);
    if (match) { verified++; continue; }
    // The first rotation of a new phase does not reveal the preceding entry's seed. The rig
    // (capture/capture-auto.reference.js) rotates at the end of a phase and again at the start of
    // the next, and both rotations read the same last transaction (meta.lastTxId), because the
    // bet-less end-of-phase epoch between them has none. So the phase-start record repeats the
    // plaintext and revealedFrom of the record before it, and the bet-less epoch's own seed is
    // never revealed. Expected exactly once per phase change; the count is pinned below, and how
    // many of them repeat the preceding record is counted (not scored).
    if (seeds[i].phase !== seeds[i - 1].phase) {
      phaseBoundarySkips++;
      if (seeds[i].seed.serverSeed === seeds[i - 1].seed.serverSeed) boundaryRepeats++;
      continue;
    }
    fails++;
    failures.push(`seed[${i}]: SHA-256(revealed) != seed[${i - 1}].serverSeedHashed`);
  }

  // Commitments whose plaintext no later record reveals (seedMap, src/loader.ts buildSeedMap), and
  // how many of those epochs carry bets. Reported, not scored: Step 5 pins the revealed count.
  const unrevealedCommitments = seeds.filter(s => !seedMap.has(s.seed.serverSeedHashed));
  const unrevealedWithBets = unrevealedCommitments
    .filter(s => (byHash.get(s.seed.serverSeedHashed)?.length ?? 0) > 0).length;

  const s1Population: string[] = [];
  if (seeds.length !== EXPECTED_SEEDS) {
    s1Population.push(`seed records ${seeds.length} != ${EXPECTED_SEEDS}`);
  }
  if (unrevealed !== 0) {
    s1Population.push(`${unrevealed} seed(s) never revealed a plaintext — unverifiable, not skipped`);
  }
  if (verified + phaseBoundarySkips !== EXPECTED_CHAIN_LINKS) {
    s1Population.push(
      `${verified} verified + ${phaseBoundarySkips} boundary != ${EXPECTED_CHAIN_LINKS} transitions`);
  }
  if (phaseBoundarySkips !== EXPECTED_PHASE_BOUNDARY_SKIPS) {
    s1Population.push(
      `${phaseBoundarySkips} phase-boundary skips != ${EXPECTED_PHASE_BOUNDARY_SKIPS} in the capture plan`);
  }

  const s1 = step(1, 'Seed Hash Integrity',
    fails === 0 && s1Population.length === 0 ? 'PASS' : 'FAIL',
    fails > 0
      ? `${fails} hash mismatches: ${failures.slice(0, 3).join('; ')}`
      : s1Population.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s1Population.join('; ')}`
        : `All ${EXPECTED_SEEDS} seed records in the capture plan are present; records 1–${EXPECTED_CHAIN_LINKS} `
          + `each carry a plaintext (seeds[0]'s was filled in after capture and is not read). `
          + `All ${EXPECTED_CHAIN_LINKS} transitions accounted for — `
          + `${EXPECTED_CHAIN_LINKS - EXPECTED_PHASE_BOUNDARY_SKIPS} reveal the preceding entry's commitment, `
          + `${EXPECTED_PHASE_BOUNDARY_SKIPS} are phase-start rotations, of which ${boundaryRepeats} repeat the `
          + `preceding record's plaintext. ${unrevealedCommitments.length} commitments have no revealed plaintext, `
          + `${unrevealedWithBets} of them with bets. 0 records without a plaintext.`,
    { seedRecords: seeds.length, expectedSeeds: EXPECTED_SEEDS, verified, phaseBoundarySkips, boundaryRepeats,
      unrevealedCommitments: unrevealedCommitments.length, unrevealedCommitmentsWithBets: unrevealedWithBets, unrevealed, mismatches: fails },
  );

  // ── Step 2: Next-Seed Promotion (Commitment Linkage) ────────────────────────
  // Set membership shows a bet was served under SOME captured seed. It says nothing about
  // ORDER: it cannot tell a seed committed before the bet from one picked, after seeing the bet,
  // from the seeds already held.
  //
  // The forward commitment is a consistency check on that order: every rotation response carries
  // the hash of the seed it will activate NEXT, so seeds[i].nextServerSeedHash must equal
  // seeds[i+1].serverSeedHashed across every transition. Equal links show the records fit
  // together; a chain constructed after settlement would pass too, so they do not show when a
  // commitment was shown. That rests on the capture's recorded pre-bet observations (MANIFEST.md,
  // Limitations and trust, K1). The dataset has carried that field on
  // all 106 rows since capture and nothing read it — the old step instead read
  // `nextSeedPromotion.match`, a boolean the CAPTURE SCRIPT wrote, which asserts only that the
  // capture script agreed with itself. It is recomputed here from the raw hashes, and the
  // supplied boolean is cross-checked against the recomputation rather than trusted.
  const chainFailures: string[] = [];
  let linksChecked = 0, linksOk = 0;
  for (let i = 0; i < seeds.length - 1; i++) {
    linksChecked++;
    if (seeds[i].seed.nextServerSeedHash === seeds[i + 1].seed.serverSeedHashed) linksOk++;
    else chainFailures.push(
      `seed[${i}].nextServerSeedHash != seed[${i + 1}].serverSeedHashed — epoch ${i + 1} was not pre-committed by epoch ${i}`);
  }

  // The first captured epoch has no predecessor inside the capture, so the chain above cannot
  // reach it. Its own rotation record carries the hash that was standing as "next" BEFORE
  // capture began; that is the pre-capture link, and it is the only evidence that the first
  // epoch was committed rather than chosen. An ABSENT link must FAIL — if it passed quietly,
  // deleting the field would be a way to make the check disappear.
  const first = seeds[0];
  const preCapture = first?.nextSeedPromotion;
  let preCaptureOk = false;
  if (!preCapture) {
    chainFailures.push('seed[0] carries no nextSeedPromotion — the pre-capture link is ABSENT, not satisfied');
  } else if (preCapture.previousNextHash !== first.seed.serverSeedHashed) {
    chainFailures.push(
      'seed[0]: the hash standing as "next" before capture != the first epoch\'s active hash');
  } else {
    preCaptureOk = true;
  }

  // Cross-check the capture script's own verdict against what was just recomputed.
  let promoChecked = 0, promoDisagreements = 0;
  for (const s of seeds) {
    if (!s.nextSeedPromotion) continue;
    promoChecked++;
    if (s.nextSeedPromotion.previousNextHash !== s.nextSeedPromotion.newActiveHash) {
      if (s.nextSeedPromotion.match) promoDisagreements++;
    } else if (!s.nextSeedPromotion.match) promoDisagreements++;
  }
  if (promoDisagreements > 0) {
    chainFailures.push(
      `${promoDisagreements} rotation record(s) where the capture script's stored \`match\` disagrees with the recomputed hashes`);
  }
  if (linksChecked !== EXPECTED_CHAIN_LINKS) {
    chainFailures.push(`${linksChecked} chain links != ${EXPECTED_CHAIN_LINKS} in the capture plan`);
  }
  if (promoChecked !== EXPECTED_SEEDS) {
    chainFailures.push(`${promoChecked} rotation records != ${EXPECTED_SEEDS} in the capture plan`);
  }

  const s2 = step(2, 'Next-Seed Promotion (Commitment Linkage)',
    chainFailures.length === 0 ? 'PASS' : 'FAIL',
    chainFailures.length > 0
      ? `Forward commitment chain broken: ${chainFailures.slice(0, 3).join('; ')}`
      : `All ${EXPECTED_CHAIN_LINKS} epoch transitions recomputed from the raw hashes: each epoch's `
        + `serverSeedHashed equals the previous epoch's recorded nextServerSeedHash, and the first epoch's `
        + `active hash equals the pre-capture "next" hash. Chain equality is a consistency check on the `
        + `${EXPECTED_SEEDS} records, not proof of when a commitment was shown; that each was shown before its `
        + `epoch's bets rests on the capture's recorded pre-bet observations (capture integrity assumed). `
        + `The capture script's own \`match\` flags agree with the recomputation on all ${EXPECTED_SEEDS} records.`,
    {
      chainLinksChecked: linksChecked,
      chainLinksOk: linksOk,
      expectedChainLinks: EXPECTED_CHAIN_LINKS,
      preCaptureLinkPresent: preCapture !== undefined,
      preCaptureLinkVerified: preCaptureOk,
      rotationRecords: promoChecked,
      captureFlagDisagreements: promoDisagreements,
    },
  );

  // ── Step 3: Hash consistency within epoch ────────────────────────────────────
  // THE OLD FORM WAS A TAUTOLOGY. Bets were grouped BY their serverSeedHashed and the step then
  // asserted one distinct serverSeedHashed per group — true of any input whatsoever, including a
  // dataset in which every bet carried a different hash. It could not fail, so it decided nothing.
  //
  // Epoch membership now comes from the capture timeline (src/loader.ts groupByEpochWindow): a
  // bet belongs to the last rotation record that precedes it. That source does not read the
  // bet's hash, so the claim is falsifiable: every bet served while rotation record i was active
  // must carry record i's committed serverSeedHashed AND record i's clientSeed.
  //
  // Seed reuse is asserted here too, because the report cites this step for it: all
  // EXPECTED_SEEDS committed serverSeedHashed values must be pairwise distinct. Two epochs on one
  // seed would serve the same draw at every shared (clientSeed, nonce).
  const { epochs, orphans } = groupByEpochWindow(bets, seeds);
  const s3Failures: string[] = [];
  let betBearing = 0, empty = 0;
  for (const e of epochs) {
    if (e.bets.length === 0) { empty++; continue; }
    betBearing++;
    const tag = `seeds[${e.index}] (${e.record.seed.serverSeedHashed.substring(0, 16)})`;
    const hashes  = new Set(e.bets.map(b => b.seed.serverSeedHashed));
    const clients = new Set(e.bets.map(b => b.seed.clientSeed));
    if (hashes.size !== 1) {
      s3Failures.push(`${tag}: ${hashes.size} distinct serverSeedHashed among its ${e.bets.length} bets`);
    } else if (!hashes.has(e.record.seed.serverSeedHashed)) {
      s3Failures.push(`${tag}: its bets carry ${[...hashes][0].substring(0, 16)}, not the hash the rotation committed`);
    }
    if (clients.size !== 1) {
      s3Failures.push(`${tag}: ${clients.size} distinct client seeds among its bets`);
    } else if (!clients.has(e.record.seed.clientSeed)) {
      s3Failures.push(`${tag}: its bets carry client seed ${[...clients][0]}, not the rotation record's ${e.record.seed.clientSeed}`);
    }
  }
  if (orphans.length > 0) {
    s3Failures.push(`${orphans.length} bet(s) captured before any rotation record — no epoch can claim them`);
  }
  if (betBearing !== EXPECTED_EPOCHS) {
    s3Failures.push(`${betBearing} bet-bearing epochs != ${EXPECTED_EPOCHS} in the capture plan`);
  }
  if (empty !== EXPECTED_SEEDS - EXPECTED_EPOCHS) {
    s3Failures.push(`${empty} rotation records without bets != ${EXPECTED_SEEDS - EXPECTED_EPOCHS} (the end-of-phase rotations)`);
  }
  const distinctCommitted = new Set(seeds.map(s => s.seed.serverSeedHashed)).size;
  if (distinctCommitted !== seeds.length || seeds.length !== EXPECTED_SEEDS) {
    s3Failures.push(`${distinctCommitted} distinct serverSeedHashed across ${seeds.length} rotation records `
      + `(expected ${EXPECTED_SEEDS} of ${EXPECTED_SEEDS}) — a committed seed was reused`);
  }

  const s3 = step(3, 'Hash Consistency Within Epoch',
    s3Failures.length === 0 ? 'PASS' : 'FAIL',
    s3Failures.length > 0
      ? `${s3Failures.length} disagreement(s) with the rotation records: ${s3Failures.slice(0, 3).join('; ')}`
      : `Epochs keyed by the capture timeline, not by the bets' own hash: every bet served under each of `
        + `the ${EXPECTED_EPOCHS} bet-bearing rotation records carries that record's committed serverSeedHashed `
        + `and its clientSeed; the ${EXPECTED_SEEDS - EXPECTED_EPOCHS} remaining records are the end-of-phase `
        + `rotations and carry no bets. 0 orphan bets. All ${EXPECTED_SEEDS} committed serverSeedHashed values `
        + `are pairwise distinct — no seed reused.`,
    { rotationRecords: epochs.length, betBearingEpochs: betBearing, emptyEpochs: empty, orphanBets: orphans.length,
      distinctCommittedHashes: distinctCommitted, disagreements: s3Failures.length },
  );

  // ── Step 4: Nonce Audit (declared base, capture order, capture-retry → capture-origin FLAG) ─
  // KENO-04. Within every epoch the nonces must be exactly NONCE_BASE … NONCE_BASE + EPOCH_SIZE − 1
  // with no gap, repeat or reorder. The base is the DECLARED constant in src/loader.ts, not the
  // minimum observed. Reorder is checked in CAPTURE order (dataset order), before any sort: a sort
  // would erase exactly the reordering it is meant to detect.
  //
  // A CAPTURE-RETRY GAP IS A FLAG, NOT A PASS (decided 2026-09-17, profile policies.FLAG; ported from
  // Duel Dice Step 4). The pattern is: nonce NONCE_BASE + EPOCH_SIZE present and exactly one nonce of
  // the window absent — the capture script missed one response and the operator had already consumed
  // that nonce. When the epoch's revealed seed hashes to its commitment, the missed draw is fixed by
  // the commitment and is reconstructed here; it is disclosed as a capture-origin FLAG (limitation
  // DL-1 in MANIFEST.md), verdict-neutral. Any other gap, repeat or reorder is operator-side: FAIL.
  const hardFailures: string[] = [];
  const captureArtifacts: string[] = [];
  const reconstructed: Array<{ epoch: string; missedNonce: number; reconstructedDraw: number[] }> = [];
  let epochsChecked = 0;
  let unverifiable = 0;
  let reorderEpochs = 0;
  const windowEnd = NONCE_BASE + EPOCH_SIZE;   // exclusive

  for (const [hash, epochBets] of byHash) {
    const shortHash = hash.substring(0, 16);
    // Capture order first: nonces must strictly increase in the order the capture recorded them.
    const captureOrder = epochBets.map(b => b.seed.nonce);
    for (let i = 1; i < captureOrder.length; i++) {
      if (!(captureOrder[i] > captureOrder[i - 1])) {
        hardFailures.push(`Epoch ${shortHash}: nonce ${captureOrder[i]} recorded after ${captureOrder[i - 1]} — reordered or repeated in capture order`);
        reorderEpochs++;
        break;
      }
    }
    const nonces = [...captureOrder].sort((a, b) => a - b);

    const clientSeeds = new Set(epochBets.map(b => b.seed.clientSeed));
    if (clientSeeds.size !== 1) {
      hardFailures.push(`Epoch ${shortHash}: ${clientSeeds.size} distinct client seeds`);
    }
    if (nonces[0] !== NONCE_BASE) {
      hardFailures.push(`Epoch ${shortHash}: first nonce is ${nonces[0]} (declared base ${NONCE_BASE})`);
    }

    const hasOverflow = nonces.includes(windowEnd);
    const missing = Array.from({ length: EPOCH_SIZE + 1 }, (_, i) => NONCE_BASE + i).filter(n => !nonces.includes(n));
    const isRetryPattern = hasOverflow && missing.length === 1 && nonces.length === EPOCH_SIZE
      && new Set(nonces).size === nonces.length;

    if (isRetryPattern) {
      const missedNonce = missing[0];
      const serverSeed = seedMap.get(hash);
      if (serverSeed) {
        // No captured server response exists for this nonce (that is why it is missing), so this is
        // a reconstruction fixed by the commitment, not a comparison.
        const draw = computeDraw(serverSeed, epochBets[0].seed.clientSeed, missedNonce);
        reconstructed.push({ epoch: shortHash, missedNonce, reconstructedDraw: draw });
        captureArtifacts.push(`Epoch ${shortHash}: capture retry — nonce ${missedNonce} missed, reconstructed from the revealed seed`);
      } else {
        captureArtifacts.push(`Epoch ${shortHash}: capture retry — nonce ${missedNonce} missed; server seed unrevealed`);
        unverifiable++;
      }
    } else {
      for (let i = 0; i < nonces.length; i++) {
        if (nonces[i] !== NONCE_BASE + i) {
          hardFailures.push(`Epoch ${shortHash}: nonce[${i}]=${nonces[i]} (expected ${NONCE_BASE + i})`);
          break;
        }
      }
      if (nonces.length !== EPOCH_SIZE) hardFailures.push(`Epoch ${shortHash}: ${nonces.length} nonces != ${EPOCH_SIZE}`);
    }
    epochsChecked++;
  }
  if (epochsChecked !== EXPECTED_EPOCHS) {
    hardFailures.push(`${epochsChecked} epochs checked != ${EXPECTED_EPOCHS} in the capture plan`);
  }

  const allOk = hardFailures.length === 0;
  const hasCaptureArtifacts = captureArtifacts.length > 0;
  const allReconstructed = hasCaptureArtifacts && unverifiable === 0;
  const s4Status: 'PASS' | 'FLAG' | 'FAIL' = !allOk ? 'FAIL' : hasCaptureArtifacts ? 'FLAG' : 'PASS';
  const s4Origin: 'capture' | undefined = s4Status === 'FLAG' && allReconstructed ? 'capture' : undefined;

  const s4Detail = !allOk
    ? `${hardFailures.length} nonce violations: ${hardFailures.slice(0, 3).join('; ')}`
    : allReconstructed
      ? `${epochsChecked} epochs checked against the declared base ${NONCE_BASE} and window of ${EPOCH_SIZE}, in capture order `
        + `(no reorder, no repeat) and sorted (no gap), single client seed per epoch. ${captureArtifacts.length} capture-retry `
        + `epoch(s): the live capture missed exactly one nonce (nonce ${windowEnd} present, one of ${NONCE_BASE}–${windowEnd - 1} `
        + `absent); each missed draw is reconstructed from a revealed server seed whose SHA-256 matches the commitment the capture recorded for that epoch. `
        + `The auditor did not witness those draws live, so this is a capture-origin FLAG (limitation DL-1 in MANIFEST.md), `
        + `verdict-neutral. 0 unverifiable.`
      : hasCaptureArtifacts
        ? `${epochsChecked} epochs. ${captureArtifacts.length} capture retry: ${reconstructed.length} reconstructed, `
          + `${unverifiable} NOT verifiable (no revealed seed) — the unverifiable one(s) carry this flag.`
        : `${epochsChecked} epochs: nonces ${NONCE_BASE}–${windowEnd - 1} in capture order, single client seed per epoch.`;

  const s4 = step(4, 'Nonce Audit', s4Status, s4Detail,
    { epochsChecked, expectedEpochs: EXPECTED_EPOCHS, nonceBase: NONCE_BASE, epochSize: EPOCH_SIZE,
      captureRetryEpochs: captureArtifacts.length, reconstructed: reconstructed.length, unverifiable,
      reorderEpochs, hardFailures: hardFailures.length, reconstructedDraws: reconstructed },
    s4Origin);

  return [s1, s2, s3, s4];
}

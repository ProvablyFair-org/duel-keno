/**
 * Steps 5–6: RNG Determinism
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { computeDrawFromBuffer, DrawCensus } from '../../src/rng';
import { EXPECTED_BETS, EXPECTED_REVEALED_EPOCHS } from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, seedMap } = ctx;

  // ── Step 5: Draw recomputation + draw structure + pick legality ──────────────
  // A bet whose epoch seed was never revealed cannot be recomputed. Counting those as
  // "skipped" and then passing on "0 mismatches" would let a capture in which NOTHING was
  // revealed score a clean pass, so the number recomputed is bound to the declared
  // population: every one of the captured bets must be reproduced, not merely the ones that
  // happened to be reproducible.
  //
  // KENO-10 — STRUCTURE IS ASSERTED FROM THE SERVED RECORD ITSELF, not only through the set
  // comparison. A Set comparison alone would accept a served array padded with a duplicate
  // ([1,1,2,…] has the same Set as a 9-number draw plus one), so each served drawn_numbers must
  // have exactly numbersDrawn members, no duplicate, every member an integer inside the 1-based
  // grid 1 … gridSize; the recomputed draw is held to the same rule. Each bet's pick set must be
  // legal: its size inside min_picks … max_picks, no duplicate, inside the grid, request.picks
  // equal to its size, and the response echoing the same picks and difficulty the request sent.
  //
  // KENO-17 — PICK-SET INDEPENDENCE, NAMED. The derivation takes (key, clientSeed, nonce) and no
  // pick, risk or stake argument (computeDrawFromBuffer declares 3 required parameters; the draw
  // message is clientSeed:nonce:cursor). It is witnessed on data: every bet recomputes with its
  // picks excluded from the derivation, across the epochs in which bets under ONE seed pair carry
  // different pick sets — counted and bound here.
  const G = ctx.cfg.gridSize, DRAWN = ctx.cfg.drawnCount;
  const structOk = (arr: unknown): boolean => Array.isArray(arr) && arr.length === DRAWN
    && new Set(arr).size === DRAWN && arr.every(n => Number.isInteger(n) && n >= 1 && n <= G);
  let mismatches = 0;
  let skipped    = 0;
  let servedStructBad = 0, recomputedStructBad = 0, illegalPicks = 0, echoMismatch = 0;
  const census: DrawCensus = { hmacCalls: 0, chunksScanned: 0, chunksRejected: 0, cursorAdvances: 0 };
  const recomputed: Array<number[] | null> = [];
  for (const b of bets) {
    if (!structOk(b.response.drawn_numbers)) servedStructBad++;
    const picks = b.request.selected_positions;
    const picksLegal = Array.isArray(picks) && picks.length >= ctx.cfg.minPicks && picks.length <= ctx.cfg.maxPicks
      && new Set(picks).size === picks.length && picks.every(n => Number.isInteger(n) && n >= 1 && n <= G)
      && b.request.picks === picks.length;
    if (!picksLegal) illegalPicks++;
    if (JSON.stringify(b.response.selected_positions) !== JSON.stringify(picks)
      || b.response.difficulty !== b.request.difficulty) echoMismatch++;

    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { skipped++; recomputed.push(null); continue; }
    const key      = Buffer.from(ss, 'hex');
    const computed = computeDrawFromBuffer(key, b.seed.clientSeed, b.seed.nonce, G, DRAWN, census);
    recomputed.push(computed);
    if (!structOk(computed)) recomputedStructBad++;
    const apiSet   = new Set(b.response.drawn_numbers);
    const compSet  = new Set(computed);
    if (apiSet.size !== compSet.size || [...apiSet].some(n => !compSet.has(n))) {
      mismatches++;
    }
  }
  ctx.step5Mismatches = mismatches;
  ctx.step5Skipped    = skipped;
  ctx.recomputedDraws = recomputed;
  ctx.drawCensus      = census;

  // KENO-17 witness: epochs whose bets share ONE (serverSeed, clientSeed) pair but carry more than
  // one distinct pick set, all recomputed by the pick-free derivation above.
  let multiPickEpochs = 0;
  for (const [, eb] of ctx.byHash) {
    if (new Set(eb.map(b => JSON.stringify(b.request.selected_positions))).size > 1) multiPickEpochs++;
  }
  const deriveArity = computeDrawFromBuffer.length;

  const verifiedCount = bets.length - skipped;
  const s5Issues: string[] = [];
  if (bets.length !== EXPECTED_BETS) s5Issues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (skipped !== 0) s5Issues.push(`${skipped} bet(s) not recomputable — their epoch seed was never revealed`);
  if (verifiedCount !== EXPECTED_BETS) s5Issues.push(`recomputed ${verifiedCount} != ${EXPECTED_BETS}`);
  if (seedMap.size !== EXPECTED_REVEALED_EPOCHS) {
    s5Issues.push(`${seedMap.size} epochs have a revealed plaintext != ${EXPECTED_REVEALED_EPOCHS}`);
  }
  if (servedStructBad > 0) s5Issues.push(`${servedStructBad} served drawn_numbers not exactly ${DRAWN} distinct integers in 1–${G}`);
  if (recomputedStructBad > 0) s5Issues.push(`${recomputedStructBad} recomputed draws not exactly ${DRAWN} distinct integers in 1–${G}`);
  if (illegalPicks > 0) s5Issues.push(`${illegalPicks} bet(s) with an illegal pick set (size, duplicate, range, or request.picks disagreeing)`);
  if (echoMismatch > 0) s5Issues.push(`${echoMismatch} response(s) whose selected_positions / difficulty differ from the request`);
  if (deriveArity !== 3) s5Issues.push(`the draw derivation declares ${deriveArity} required parameters, not (key, clientSeed, nonce) — a pick/risk/stake input may reach the draw`);
  if (multiPickEpochs < 1) s5Issues.push('no epoch carries more than one pick set under one seed pair — pick independence not witnessed on data');

  const s5 = step(5, 'Draw Recomputation (RNG + drand absent)',
    mismatches === 0 && s5Issues.length === 0 ? 'PASS' : 'FAIL',
    mismatches > 0
      ? `${mismatches} of ${verifiedCount} recomputed draws disagree with the captured draw`
      : s5Issues.length > 0
        ? `DRAW / POPULATION CHECK FAILED: ${s5Issues.join('; ')}`
        : `All ${EXPECTED_BETS} captured bets recomputed from the revealed seed of their epoch — `
          + `${EXPECTED_REVEALED_EPOCHS}/${EXPECTED_REVEALED_EPOCHS} epochs revealed, 0 unverifiable, 0 set mismatches. `
          + `Every served and every recomputed draw is exactly ${DRAWN} distinct integers in 1–${G}; every pick set is legal `
          + `(${ctx.cfg.minPicks}–${ctx.cfg.maxPicks} distinct numbers in 1–${G}, request.picks equal to its size) and echoed unchanged `
          + `with its difficulty. The derivation takes (key, clientSeed, nonce) only — no pick, risk or stake — and recomputes `
          + `every bet, including ${multiPickEpochs} epochs whose bets carry different pick sets under one seed pair.`,
    { bets: bets.length, expectedBets: EXPECTED_BETS, recomputed: verifiedCount, skipped, mismatches, revealedEpochs: seedMap.size,
      servedStructureViolations: servedStructBad, recomputedStructureViolations: recomputedStructBad,
      illegalPickSets: illegalPicks, requestResponseEchoMismatches: echoMismatch,
      derivationRequiredParams: deriveArity, epochsWithMultiplePickSets: multiPickEpochs },
  );

  // ── Step 6: Client seed influence (model-rate gate + empty-seed control) ──────
  // Substitute a wrong client seed on EVERY bet and count how many draws stay the same.
  //
  // MODEL RATE (KENO-06). An unrelated client seed reproduces the same 10-of-40 set with
  // probability p = 1/C(40,10) = 1/847,660,528 per bet, so over 5,100 bets E = 5100·p ≈ 6.0e-6
  // collisions and the bound E + 5σ admits 0 — the model rate and the exact "every draw changes"
  // rule coincide here, and the exact rule is kept. (Ported from the Duel Mines / Dice Step 6
  // model-rate gate, whose lattice p is large enough for the bound to admit collisions.)
  //
  // EMPTY-SEED CONTROL. A wrong seed proves the client seed is READ; an EMPTY seed is the case an
  // implementation that concatenates or defaults it could still ignore. Every bet is recomputed
  // with clientSeed = "" and held to the same bound.
  const P_COLLIDE = 1 / 847660528;   // 1 / C(40, 10)
  const wrongClientSeed = 'WRONG_CLIENT_SEED_FOR_AUDIT_TEST';
  let totalChanged = 0, totalChecked = 0, epochsTested = 0, epochsUnrevealed = 0;
  let emptyTested = 0, emptyCollisions = 0;
  const zeroChangeEpochs: string[] = [];
  const partialEpochs: string[] = [];
  const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every(n => b.includes(n));

  for (const [hash, epochBets] of ctx.byHash) {
    const ss = seedMap.get(hash);
    if (!ss) { epochsUnrevealed++; continue; }
    const key = Buffer.from(ss, 'hex');
    let changed = 0;
    for (const bet of epochBets) {
      const correctDraw = computeDrawFromBuffer(key, bet.seed.clientSeed, bet.seed.nonce);
      const wrongDraw   = computeDrawFromBuffer(key, wrongClientSeed, bet.seed.nonce);
      const emptyDraw   = computeDrawFromBuffer(key, '', bet.seed.nonce);
      if (!sameSet(correctDraw, wrongDraw)) changed++;
      if (sameSet(correctDraw, emptyDraw)) emptyCollisions++;
      totalChecked++;
      emptyTested++;
    }
    totalChanged += changed;
    epochsTested++;
    if (changed === 0) {
      zeroChangeEpochs.push(`Epoch ${hash.substring(0, 16)}: wrong client seed produced 0 changed draws`);
    } else if (changed !== epochBets.length) {
      partialEpochs.push(`Epoch ${hash.substring(0, 16)}: ${epochBets.length - changed} of ${epochBets.length} draws unchanged`);
    }
  }
  const expectedCollisions = totalChecked * P_COLLIDE;
  const collisionBound = expectedCollisions + 5 * Math.sqrt(totalChecked * P_COLLIDE * (1 - P_COLLIDE));
  const collisions = totalChecked - totalChanged;

  // Client-seed ORIGIN, disclosed from the data and the capture rig (not a pass/fail property of the
  // operator): Phase D seeds were set by the capture script as 'pfaudit' + Date.now() in base 36, so
  // they are predictable from the wall clock; the epochs exposed are enumerated here. Phases A–C
  // seeds come from the rig's generateClientSeed (16 chars, Math.random — not a CSPRNG).
  const phaseDSeedRows = seeds.filter(s => s.phase === 'D');
  const predictable = phaseDSeedRows
    .filter(s => /^pfaudit[0-9a-z]+$/.test(s.seed.clientSeed))
    .map(s => {
      const ms = parseInt(s.seed.clientSeed.slice('pfaudit'.length), 36);
      const bearing = ctx.byHash.get(s.seed.serverSeedHashed)?.length ?? 0;
      return { clientSeed: s.seed.clientSeed, serverSeedHashed: s.seed.serverSeedHashed,
        decodedWallClock: new Date(ms).toISOString(), rotationRecordAt: s.at, betsUnderIt: bearing };
    });
  const abcPattern = /^[A-Za-z0-9]{16}$/;
  const abcSeeds = new Set(ctx.bets.filter(b => b.phase !== 'D').map(b => b.seed.clientSeed));
  const abcOffPattern = [...abcSeeds].filter(c => !abcPattern.test(c)).length;

  const s6Issues: string[] = [];
  if (zeroChangeEpochs.length > 0) {
    s6Issues.push(`${zeroChangeEpochs.length} epoch(s) with 0 changed draws (${zeroChangeEpochs.slice(0, 3).join('; ')})`);
  }
  if (partialEpochs.length > 0) {
    s6Issues.push(`${partialEpochs.length} epoch(s) where the client seed did not change every draw (${partialEpochs.slice(0, 3).join('; ')})`);
  }
  if (collisions > collisionBound) {
    s6Issues.push(`${collisions} of ${totalChecked} draws unchanged under a wrong client seed, above the model bound E + 5σ = ${collisionBound.toExponential(3)}`);
  }
  if (emptyCollisions > collisionBound) {
    s6Issues.push(`EMPTY-SEED CONTROL: ${emptyCollisions} of ${emptyTested} draws unchanged with clientSeed = "", above the model bound — the draw does not depend on the client seed`);
  }
  if (totalChecked !== EXPECTED_BETS || emptyTested !== EXPECTED_BETS) {
    s6Issues.push(`substituted a wrong / empty client seed on ${totalChecked} / ${emptyTested} bets != ${EXPECTED_BETS} in the capture plan`);
  }
  if (epochsTested !== EXPECTED_REVEALED_EPOCHS || epochsUnrevealed !== 0) {
    s6Issues.push(`${epochsTested} epochs tested, ${epochsUnrevealed} unrevealed != ${EXPECTED_REVEALED_EPOCHS} revealed`);
  }

  const s6 = step(6, 'Client Seed Influence',
    s6Issues.length === 0 ? 'PASS' : 'FAIL',
    s6Issues.length > 0
      ? `Client seed influence failed: ${s6Issues.join('; ')}`
      : `Substituting a wrong client seed changes the draw for every one of the ${EXPECTED_BETS} bets `
        + `in every one of the ${EXPECTED_REVEALED_EPOCHS} epochs (model rate p = 1/C(40,10), E + 5σ admits 0 collisions); `
        + `the empty-seed control (clientSeed = "") changes all ${EXPECTED_BETS} as well. Disclosed, not scored: the `
        + `${predictable.length} bet-bearing Phase D client seeds are 'pfaudit' + a base-36 wall-clock timestamp (predictable; `
        + `epochs enumerated in data.phaseDPredictableSeeds, limitation DL-3) and the Phase A–C seeds come from the capture rig's `
        + `Math.random() generator, which is not a CSPRNG (limitation DL-4).`,
    { betsTested: totalChecked, expectedBets: EXPECTED_BETS, drawsChanged: totalChanged, collisions,
      collisionProbabilityPerBet: P_COLLIDE, expectedCollisions, collisionBound, epochsTested,
      epochsUnrevealed, zeroChangeEpochs: zeroChangeEpochs.length, partialEpochs: partialEpochs.length,
      emptySeedControl: { betsTested: emptyTested, collisions: emptyCollisions, collisionBound },
      phaseDPredictableSeeds: predictable,
      phaseABCClientSeeds: { distinct: abcSeeds.size, matching16CharAlphanumeric: abcSeeds.size - abcOffPattern,
        generator: 'capture/capture-auto.reference.js generateClientSeed: 16 chars from a 62-char alphabet via Math.random() — not a CSPRNG' } },
  );

  return [s5, s6];
}

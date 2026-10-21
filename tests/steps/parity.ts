/**
 * Step 23: Player-Verifier Parity (profile KENO-24).
 *
 * Two player-facing verifiers exist for Duel Keno and neither is this package's code:
 *   (a) the ProvablyFair.org docs-site VerifyBets component — derive.js + paytables.js + the
 *       pure-JS HMAC, vendored byte for byte under verifier-parity/ and hash-pinned in
 *       src/site-verifier.ts;
 *   (b) the LIVE page https://www.provablyfair.org/verify-bets — three deployed Next.js chunks,
 *       vendored byte for byte under verifier-parity/live-site/chunks/ and hash-pinned in
 *       src/live-site-verifier.ts, run by the site's own runtime in a child process.
 * Both are EXECUTED on every one of the 5,100 captured bets.
 *
 * A THIRD verifier is the operator's own: (c) Duel's Keno Verify-tab code (duel.com → Provably Fair →
 * Verify → Expand → Copy, copied verbatim 2026-09-25 to evidence/verify-tab/, pinned in
 * src/operator-verifier.ts; profile KENO-09). It is a SECOND CHECK, not the source of src/rng.ts (which
 * is rebuilt from docs/ALGORITHM.md by an implementer who never opened Duel's code). It is EXECUTED
 * unmodified on every bet; its draw, in the shuffled order it returns, must equal src/rng.ts
 * computeDraw's in the same order, and as a set the served drawn_numbers.
 *
 * SCORED: the DRAWN SET each verifier prints must equal the draw this package recomputed (Step 5,
 * and so the draw the casino served) on every bet; the docs-site verifier's paytables.js must equal
 * the pinned kenoConfig.json cell for cell (all 260), and the MULTIPLIER it prints must equal the one
 * the casino served on every bet. A pin mismatch, a load failure, a missing result, one differing
 * draw, cell or multiplier is a FAIL. The live page computes no Keno multiplier.
 *
 * HISTORY (MANIFEST.md PV-1). On 2026-09-25 this step first ran against the docs-site bytes of the
 * local checkout (branch repotree-sync @ 2ad89bc), whose keno paytables.js differed from the audited
 * table on 106 of 260 cells and printed the wrong multiplier on 1,472 of 5,100 captured bets. That
 * branch is stale: the site's main (bd4d59c, 2026-09-19; table last changed 4aaa1b2, 2026-06-07)
 * carries the correct table, and the vendored bytes are now main's.
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { DIFFICULTY_TO_RISK } from '../../src/config';
import { EXPECTED_BETS } from '../../src/loader';
import { displayMultiplier } from '../../src/money';
import { loadSiteVerifier, SITE_VERIFIER_PROVENANCE } from '../../src/site-verifier';
import { runLiveSiteVerifier, LIVE_SITE_PROVENANCE } from '../../src/live-site-verifier';
import {
  runOperatorVerifier, OPERATOR_EXPECTED_LOGS, OPERATOR_VERIFIER_PROVENANCE,
} from '../../src/operator-verifier';
import { GRID_SIZE, DRAWN_COUNT } from '../../src/rng';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap, cfg } = ctx;
  const issues: string[] = [];
  const sameSet = (a: number[] | null | undefined, b: number[] | null | undefined): boolean =>
    !!a && !!b && a.length === b.length && a.every(n => b.includes(n));

  // ── (a) docs-site verifier ───────────────────────────────────────────────────
  const site = loadSiteVerifier();
  let siteChecked = 0, siteDrawMismatch = 0, siteMultMismatch = 0, siteThrew = 0;
  const siteMultExamples: Array<Record<string, unknown>> = [];
  let tableCellsDiffering = 0, tableCellsCompared = 0;
  if (site.error || !site.deriveKeno || !site.payoutTables) {
    issues.push(`docs-site verifier: ${site.error ?? 'not loaded'}`);
  } else {
    for (const { risk, picks } of cfg.allConfigs()) for (let k = 0; k <= picks; k++) {
      tableCellsCompared++;
      const s = site.payoutTables[risk.toLowerCase()]?.[String(picks)]?.[k];
      if (s !== cfg.multiplier(risk, picks, k)) tableCellsDiffering++;
    }
    for (let i = 0; i < bets.length; i++) {
      const b = bets[i];
      const ss = seedMap.get(b.seed.serverSeedHashed);
      const mine = ctx.recomputedDraws[i];
      if (!ss || !mine) continue;
      let r: ReturnType<NonNullable<typeof site.deriveKeno>> | null = null;
      try {
        r = site.deriveKeno({ clientSeed: b.seed.clientSeed, serverSeed: ss, nonce: b.seed.nonce,
          picks: b.request.selected_positions, risk: DIFFICULTY_TO_RISK[b.request.difficulty].toLowerCase() });
      } catch { siteThrew++; continue; }
      siteChecked++;
      if (!sameSet(r.drawnNumbers, mine)) siteDrawMismatch++;
      if (r.multiplier === null || displayMultiplier(r.multiplier) !== b.response.multiplier) {
        siteMultMismatch++;
        if (siteMultExamples.length < 5) siteMultExamples.push({ betId: b.response.id, risk: DIFFICULTY_TO_RISK[b.request.difficulty],
          picks: b.request.selected_positions.length, hits: r.hitCount, served: b.response.multiplier, site: r.multiplier });
      }
    }
    if (siteThrew > 0) issues.push(`docs-site verifier threw on ${siteThrew} bet(s)`);
    if (siteChecked !== EXPECTED_BETS) issues.push(`docs-site verifier ran on ${siteChecked} bets != ${EXPECTED_BETS}`);
    if (siteDrawMismatch > 0) issues.push(`docs-site verifier drew a different set on ${siteDrawMismatch} bet(s)`);
    if (tableCellsCompared !== 260 || tableCellsDiffering > 0) issues.push(`docs-site paytables.js differs from kenoConfig.json on ${tableCellsDiffering} of ${tableCellsCompared} cells`);
    if (siteMultMismatch > 0) issues.push(`docs-site verifier prints a multiplier other than the one served on ${siteMultMismatch} bet(s)`);
  }

  // ── (b) live-site verifier ───────────────────────────────────────────────────
  const rounds = [];
  for (let i = 0; i < bets.length; i++) {
    const b = bets[i];
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;
    rounds.push({ id: i, serverSeed: ss, clientSeed: b.seed.clientSeed, nonce: b.seed.nonce,
      kenoRisk: DIFFICULTY_TO_RISK[b.request.difficulty].toLowerCase() });
  }
  const live = runLiveSiteVerifier('Duel.com', rounds);
  let liveChecked = 0, liveDrawMismatch = 0, liveMissing = 0;
  if (live.error || !live.drawn) {
    issues.push(`live-site verifier: ${live.error ?? 'no result'}`);
  } else {
    for (let i = 0; i < bets.length; i++) {
      const got = live.drawn.get(String(i));
      if (got === undefined || got === null) { liveMissing++; continue; }
      liveChecked++;
      // The page prints positions + 1 in shuffle order; compare as a set.
      if (!sameSet(got, ctx.recomputedDraws[i])) liveDrawMismatch++;
    }
    if (liveMissing > 0) issues.push(`live-site verifier returned no draw for ${liveMissing} bet(s)`);
    if (liveChecked !== EXPECTED_BETS) issues.push(`live-site verifier ran on ${liveChecked} bets != ${EXPECTED_BETS}`);
    if (liveDrawMismatch > 0) issues.push(`live-site verifier drew a different set on ${liveDrawMismatch} bet(s)`);
  }

  // ── (c) the operator's own Verify-tab code (KENO-09) ─────────────────────────
  const opRounds = [];
  for (let i = 0; i < bets.length; i++) {
    const b = bets[i];
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;
    opRounds.push({ id: String(i), serverSeed: ss, clientSeed: b.seed.clientSeed, nonce: b.seed.nonce, gridSize: GRID_SIZE, drawnCount: DRAWN_COUNT });
  }
  const op = runOperatorVerifier(opRounds);
  let opChecked = 0, opOrderVsRng = 0, opSetVsServed = 0, opMissing = 0;
  const opExamples: string[] = [];
  if (op.error || !op.drawn) {
    issues.push(`operator Verify-tab code: ${op.error ?? 'no result'}`);
  } else {
    const logsOk = op.logs.length === OPERATOR_EXPECTED_LOGS.length && op.logs.every((l, i) => l === OPERATOR_EXPECTED_LOGS[i]);
    if (!logsOk) issues.push(`operator Verify-tab code printed ${JSON.stringify(op.logs).slice(0, 200)} — not only its empty-input message`);
    for (let i = 0; i < bets.length; i++) {
      const got = op.drawn.get(String(i));
      if (got === undefined || got === null) { opMissing++; continue; }
      opChecked++;
      const mine = ctx.recomputedDraws[i];
      // Operator and src/rng.ts both return the shuffle order: compared IN ORDER.
      if (!mine || got.length !== mine.length || got.some((n, k) => n !== mine[k])) {
        opOrderVsRng++;
        if (opExamples.length < 3) opExamples.push(`bet ${bets[i].response.id}: operator [${got}] vs src/rng.ts [${mine}]`);
      }
      // The served drawn_numbers are a set whose order is presentation-only (Step 5).
      if (!sameSet(got, bets[i].response.drawn_numbers)) {
        opSetVsServed++;
        if (opExamples.length < 3) opExamples.push(`bet ${bets[i].response.id}: operator [${got}] vs served [${bets[i].response.drawn_numbers}]`);
      }
    }
    if (opMissing > 0) issues.push(`operator Verify-tab code returned no draw for ${opMissing} bet(s)`);
    if (opChecked !== EXPECTED_BETS) issues.push(`operator Verify-tab code ran on ${opChecked} bets != ${EXPECTED_BETS}`);
    if (opOrderVsRng > 0 || opSetVsServed > 0) {
      issues.push(`operator Verify-tab code disagrees: in order with src/rng.ts on ${opOrderVsRng}, as a set with the served draw on ${opSetVsServed} bet(s) (${opExamples.join('; ')})`);
    }
  }

  const ok = issues.length === 0;
  return [step(23, 'Player-Verifier Parity (docs-site + live-site)',
    ok ? 'PASS' : 'FAIL',
    ok
      ? `Both player verifiers executed from their pinned bytes on all ${EXPECTED_BETS} bets: the docs-site derive.js `
        + `(${SITE_VERIFIER_PROVENANCE.repository} @ ${SITE_VERIFIER_PROVENANCE.head.slice(0, 7)}) and the live `
        + `${LIVE_SITE_PROVENANCE.page} bundle each print the drawn set this package recomputes on every bet; the docs-site `
        + `paytables.js equals the pinned kenoConfig.json on ${tableCellsCompared - tableCellsDiffering} of ${tableCellsCompared} cells and `
        + `the multiplier it prints equals the served one on ${siteChecked - siteMultMismatch} of ${siteChecked} bets. The live page `
        + `prints no Keno multiplier. Duel's own Keno Verify-tab code (${OPERATOR_VERIFIER_PROVENANCE.savedAs}, copied `
        + `${OPERATOR_VERIFIER_PROVENANCE.copiedOn}, SHA-256-pinned) executed unmodified on ${opChecked} of ${EXPECTED_BETS} bets returns `
        + `src/rng.ts's draw in the same shuffled order on every bet and the served draw as a set on every bet `
        + `(${opOrderVsRng} / ${opSetVsServed} differ). Duel's code is a second check; src/rng.ts is rebuilt from docs/ALGORITHM.md.`
      : `Player-verifier parity failed: ${issues.join('; ')}`,
    { siteFiles: site.files, siteChecked, siteDrawMismatches: siteDrawMismatch, siteThrew,
      sitePaytableCellsCompared: tableCellsCompared, sitePaytableCellsDiffering: tableCellsDiffering,
      siteMultiplierDiffersFromServed: siteMultMismatch, siteMultiplierExamples: siteMultExamples,
      liveFiles: live.files, liveChecked, liveDrawMismatches: liveDrawMismatch, liveMissing,
      liveStandInModules: live.standIns.length,
      operatorFiles: op.files, operatorProvenance: OPERATOR_VERIFIER_PROVENANCE, operatorChecked: opChecked,
      operatorOrderDiffersFromRng: opOrderVsRng, operatorSetDiffersFromServed: opSetVsServed, operatorMissing: opMissing },
  )];
}

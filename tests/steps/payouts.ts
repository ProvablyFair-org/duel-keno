/**
 * Steps 7–12: Payout & Multiplier Tables + Configuration
 */

import type { RiskLevel } from '../../src/types';
import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { DIFFICULTY_TO_RISK } from '../../src/config';
import { countHits, countHitsIn, MIN_BETS_PER_CONFIG, EXPECTED_PHASE_BETS, EXPECTED_BETS } from '../../src/loader';
import { settledPayoutUnits, servedPayoutUnits, displayMultiplier, toUnits, MULTIPLIER_DP, MONEY_DP } from '../../src/money';

/** Phase D's stake in the capture plan: the whole point of the phase is the 1000× larger bet. */
const PHASE_D_STAKE = 10;
/** The flat house edge the committed table encodes (1 − 0.999 RTP, proven per config in step 17). */
const SERVED_EDGE = 0.1;

/**
 * NO TOLERANCE ON MONEY (2026-09-25). Until this date Steps 7–9 compared parsed doubles at a
 * relative 1e-12 and multiplied the SERVED multiplier. Duel's settlement rule was then measured on
 * all 5,100 bets (src/money.ts): the served multiplier is the table cell rounded to 13 decimal
 * places and amount_won = amount × that multiplier exactly. The steps now assert that rule on
 * integers, from the RECOMPUTED cell (the cell selected by hits counted against the draw Step 5
 * recomputed), so the served multiplier is compared, never used.
 *
 * Kept for Step 12, which compares two table constants: a relative bound on a double that is read
 * from the pinned table itself.
 */
export const MONEY_REL_TOL = 1e-12;
export const moneyTol = (x: number): number => MONEY_REL_TOL * Math.max(Math.abs(x), 1);

/** Where the committed multiplier table came from (KENO-13 provenance). */
export const TABLE_ORIGIN =
  'operator config endpoint: kenoConfig.json is a Duel API response envelope {success, data} whose data keys are '
  + 'min_picks, max_picks, numbers_drawn, grid_size, difficulty_levels, multipliers, probabilities, scaling_edge; '
  + 'the package holds no fetch record of the URL (the same envelope and key set are what GET duel.com/api/v2/keno/config '
  + 'returned when read on 2026-09-05, outside this package). The probabilities field is never read by any derivation.';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, cfg, configRaw } = ctx;
  const results: StepResult[] = [];

  // The recomputed cell for every bet: hits counted against the RECOMPUTED draw (KENO-10), never
  // against the served drawn_numbers. A bet Step 5 could not recompute has no cell and is counted.
  interface Cell { risk: RiskLevel; picks: number; hits: number; cell: number | null }
  const cells: Cell[] = bets.map((b, i) => {
    const risk = DIFFICULTY_TO_RISK[b.request.difficulty];
    const picks = b.request.selected_positions.length;
    const draw = ctx.recomputedDraws[i] ?? null;
    const hits = draw ? countHitsIn(b.request.selected_positions, draw) : -1;
    let cell: number | null = null;
    if (draw) { try { cell = cfg.multiplier(risk, picks, hits); } catch { cell = null; } }
    return { risk, picks, hits, cell };
  });
  const noCell = cells.filter(c => c.cell === null).length;

  // ── Step 7: Payout math (exact, from the recomputed cell) ─────────────────────
  let errors = 0, checked = 0, paying = 0, zeroPaid = 0, currencyEcho = 0, offGrid = 0;
  for (let i = 0; i < bets.length; i++) {
    const b = bets[i], c = cells[i];
    checked++;
    if (c.cell === null) { errors++; continue; }
    try {
      const expected = settledPayoutUnits(b.request.amount, c.cell);
      const served   = servedPayoutUnits(b.response.amount_won);
      if (expected !== served) errors++;
      if (c.cell > 0) paying++; else { zeroPaid++; if (served !== 0n) errors++; }
      if (toUnits(b.response.amount_currency, MONEY_DP) !== toUnits(b.request.amount, MONEY_DP)) currencyEcho++;
    } catch { offGrid++; }
  }
  const s7Ok = errors === 0 && offGrid === 0 && currencyEcho === 0 && checked === EXPECTED_BETS && noCell === 0;
  results.push(step(7, 'Payout Math',
    s7Ok ? 'PASS' : 'FAIL',
    s7Ok
      ? `${checked} bets: amount_won equals amount × the RECOMPUTED table cell rounded to ${MULTIPLIER_DP} dp, exactly on `
        + `integer units (no tolerance); every zero-cell bet credits exactly 0; amount_currency echoes the stake on the `
        + `${MONEY_DP}-dp grid.`
      : `${checked} bets checked: ${errors} payout(s) differ from amount × round${MULTIPLIER_DP}(recomputed cell) exactly, `
        + `${offGrid} money string(s) off the grid, ${currencyEcho} amount_currency not equal to the stake, `
        + `${noCell} bet(s) with no recomputed cell${checked !== EXPECTED_BETS ? `; ${checked} != ${EXPECTED_BETS}` : ''}.`,
    { betsChecked: checked, expectedBets: EXPECTED_BETS, errors, offGrid, currencyEchoMismatches: currencyEcho,
      betsWithoutRecomputedCell: noCell, payingBets: paying, zeroCellBets: zeroPaid,
      settlementRule: `amount_won == amount × Number(cell.toFixed(${MULTIPLIER_DP})), exact on integer units`,
      multiplierDecimalPlaces: MULTIPLIER_DP, moneyDecimalPlaces: MONEY_DP },
  ));

  // ── Step 8: Multiplier table provenance (served vs declared, exact on the display rounding) ─
  // The served multiplier string must equal the display rounding of paytable[risk][picks][hits]
  // with hits from the recomputed draw — string equality, no tolerance. Hits counted against the
  // SERVED draw are compared too: they must agree with the recomputed ones on every bet.
  let mismatches = 0, servedHitDisagree = 0, exactCells = 0, roundedCells = 0;
  const rowsServed = new Set<string>();
  for (let i = 0; i < bets.length; i++) {
    const b = bets[i], c = cells[i];
    if (countHits(b) !== c.hits) servedHitDisagree++;
    if (c.cell === null) { mismatches++; continue; }
    rowsServed.add(`${c.risk}|${c.picks}`);
    if (b.response.multiplier !== displayMultiplier(c.cell)) mismatches++;
    else if (String(c.cell) === b.response.multiplier) exactCells++;
    else roundedCells++;
  }
  const s8Ok = mismatches === 0 && servedHitDisagree === 0 && bets.length === EXPECTED_BETS;
  results.push(step(8, 'Multiplier Table Provenance',
    s8Ok ? 'PASS' : 'FAIL',
    s8Ok
      ? `${bets.length} bets: the served multiplier string equals paytable[risk][picks][hits] of the pinned kenoConfig.json `
        + `displayed at ${MULTIPLIER_DP} dp, with hits counted against the recomputed draw (and equal to the hits counted `
        + `against the served draw on every bet); ${rowsServed.size} (risk, picks) rows served, every served cell compared. `
        + `Table origin: ${TABLE_ORIGIN}`
      : `${mismatches} served multiplier(s) differ from the display-rounded recomputed cell; ${servedHitDisagree} bet(s) whose `
        + `hits on the served draw differ from the recomputed draw.`,
    { betsChecked: bets.length, expectedBets: EXPECTED_BETS, mismatches, servedVsRecomputedHitDisagreements: servedHitDisagree,
      cellsServedAtFullPrecision: exactCells, cellsServedDisplayRounded: roundedCells, rowsServed: rowsServed.size,
      displayRule: `served == Number(cell.toFixed(${MULTIPLIER_DP})).toString()`, tableOrigin: TABLE_ORIGIN,
      operatorProbabilityFieldRead: false },
  ));

  // ── Step 9: Phase C Bet-Size Invariance ──────────────────────────────────────
  // Phase D bets at $10 must produce identical draws to $0.01 bets given the same
  // (serverSeed, clientSeed, nonce), and pay by the same table cell and the same exact settlement
  // rule as the base stake. Proves bet amount is neither an RNG input nor a pricing input.
  //
  // The profile floor (KENO-12) is ≥ 100 elevated-stake PAYING bets. Phase D was played on MEDIUM
  // picks=10, where 43 of the 100 bets paid; the floor is printed as ASSUMED with that witness
  // count (phaseDPayingFloorMet), never silently passed. Captured 2026-04-11, before the floor
  // existed (limitation DL-5).
  {
    const phaseDIdx = bets.map((b, i) => [b, i] as const).filter(([b]) => b.phase === 'D');
    const expectedD = EXPECTED_PHASE_BETS.D;
    let drawChecked = 0, drawFails = 0, multFails = 0, payFails = 0, unrevealedD = 0, offStake = 0, payingD = 0;
    const baseStakeSameRow = new Set<string>();
    for (const [b] of bets.map((b, i) => [b, i] as const)) if (b.phase !== 'D') baseStakeSameRow.add(`${DIFFICULTY_TO_RISK[b.request.difficulty]}|${b.request.selected_positions.length}`);
    let rowsWithBaseStakeTwin = 0;
    const dRows = new Set<string>();
    for (const [b, i] of phaseDIdx) {
      if (b.request.amount !== String(PHASE_D_STAKE)) offStake++;
      const draw = ctx.recomputedDraws[i];
      if (!draw) { unrevealedD++; continue; }
      const apiSet = new Set(b.response.drawn_numbers);
      if (apiSet.size !== draw.length || draw.some(n => !apiSet.has(n))) drawFails++;
      const c = cells[i];
      dRows.add(`${c.risk}|${c.picks}`);
      if (c.cell === null || b.response.multiplier !== displayMultiplier(c.cell)) multFails++;
      else {
        try { if (settledPayoutUnits(b.request.amount, c.cell) !== servedPayoutUnits(b.response.amount_won)) payFails++; }
        catch { payFails++; }
        if (c.cell > 0) payingD++;
      }
      drawChecked++;
    }
    for (const r of dRows) if (baseStakeSameRow.has(r)) rowsWithBaseStakeTwin++;
    const PAYING_FLOOR = 100;
    const s9Issues: string[] = [];
    if (drawFails > 0) s9Issues.push(`${drawFails} recomputed draw(s) disagree with the served draw`);
    if (multFails > 0) s9Issues.push(`${multFails} served multiplier(s) differ from the table cell the $0.01 stake is priced by`);
    if (payFails > 0) s9Issues.push(`${payFails} payout(s) not settled by the same exact rule as the base stake`);
    if (unrevealedD > 0) s9Issues.push(`${unrevealedD} Phase D bet(s) on an unrevealed seed — not recomputable`);
    if (offStake > 0) s9Issues.push(`${offStake} Phase D bet(s) not at the $${PHASE_D_STAKE} stake`);
    if (phaseDIdx.length !== expectedD) s9Issues.push(`Phase D holds ${phaseDIdx.length} bets != ${expectedD} in the capture plan`);
    if (drawChecked !== expectedD) s9Issues.push(`${drawChecked} checked != ${expectedD}`);
    if (rowsWithBaseStakeTwin !== dRows.size) s9Issues.push(`${dRows.size - rowsWithBaseStakeTwin} Phase D (risk, picks) row(s) never played at the base stake — no same-config comparison`);
    const s9 = step(9, 'Phase C Bet-Size Invariance (Phase D at $10)',
      s9Issues.length === 0 ? 'PASS' : 'FAIL',
      s9Issues.length > 0
        ? `${drawChecked}/${phaseDIdx.length} Phase D bets checked: ${s9Issues.join('; ')}`
        : `${drawChecked}/${expectedD} Phase D bets, all at $${PHASE_D_STAKE}: draws recomputed from the revealed seeds; every `
          + `served multiplier is the same display-rounded table cell the $0.01 stake is priced by on the same (risk, picks) `
          + `row (also played at $0.01), and every payout settles by the same exact rule. 0 unrevealed. ${payingD} of the `
          + `${expectedD} paid: below the profile floor of ${PAYING_FLOOR} elevated-stake paying bets — ASSUMED, disclosed as DL-5.`,
      { phaseDBets: phaseDIdx.length, expectedPhaseDBets: expectedD, drawChecked, drawFails, multFails, payFails,
        unrevealed: unrevealedD, offStake, payingBets: payingD, payingFloor: PAYING_FLOOR,
        phaseDPayingFloorMet: payingD >= PAYING_FLOOR, rowsAlsoPlayedAtBaseStake: rowsWithBaseStakeTwin },
    );
    results.push(s9);
  }

  // ── Step 10: Configuration Completeness & Payout-Cell Coverage ──────────────
  // "Every config appears at least once" is a weak claim: one bet on a configuration is
  // enough to satisfy it while proving nothing about that configuration's behaviour. The
  // floor is MIN_BETS_PER_CONFIG in src/loader.ts, and it is scored.
  //
  // Coverage is reported at the level that actually matters — the PAYOUT CELL. A Keno
  // multiplier is selected by (risk, picks, hits), and live play only ever exercises the cells
  // whose hit counts came up. The cells it never reached are where a wrong multiplier could
  // sit unchallenged by this dataset, so they are named in outputs/payout-coverage.json
  // together with the share of theoretical RTP resting on them. That share is the honest size
  // of what live play did NOT confirm; the anti-circularity step (17) is what covers it, by
  // evaluating the whole committed table against independent hypergeometric probabilities.
  const configCounts: Record<string, number> = {};
  const seenCells = new Set<string>();
  const phaseConfigCounts: Record<string, Record<string, number>> = {};
  for (let i = 0; i < bets.length; i++) {
    const b = bets[i];
    const risk  = DIFFICULTY_TO_RISK[b.request.difficulty];
    const picks = b.request.selected_positions.length;
    const key   = `${risk}|${picks}`;
    configCounts[key] = (configCounts[key] ?? 0) + 1;
    (phaseConfigCounts[b.phase] ??= {})[key] = (phaseConfigCounts[b.phase][key] ?? 0) + 1;
    if (cells[i].hits >= 0) seenCells.add(`${key}|${cells[i].hits}`);
  }

  const allConfigs = cfg.allConfigs();
  const missing    = allConfigs.filter(({ risk, picks }) => (configCounts[`${risk}|${picks}`] ?? 0) === 0);
  const belowFloor = allConfigs
    .filter(({ risk, picks }) => {
      const n = configCounts[`${risk}|${picks}`] ?? 0;
      return n > 0 && n < MIN_BETS_PER_CONFIG;
    })
    .map(({ risk, picks }) => `${risk}/p${picks}: ${configCounts[`${risk}|${picks}`]}`);

  let totalCells = 0, observedCells = 0, uncoveredRtpMass = 0, totalRtpMass = 0;
  const uncoveredCells: Array<Record<string, unknown>> = [];
  for (const { risk, picks } of allConfigs) {
    for (let k = 0; k <= picks; k++) {
      totalCells++;
      const p    = cfg.hitProbability(picks, k);
      const mult = cfg.multiplier(risk, picks, k);
      const rtp  = p * mult;
      totalRtpMass += rtp;
      if (seenCells.has(`${risk}|${picks}|${k}`)) observedCells++;
      else {
        uncoveredRtpMass += rtp;
        uncoveredCells.push({ risk, picks, hits: k, probability: p, multiplier: mult, rtpContribution: rtp });
      }
    }
  }
  uncoveredCells.sort((a, b) => (b.rtpContribution as number) - (a.rtpContribution as number));
  const uncoveredRtpShare = totalRtpMass > 0 ? uncoveredRtpMass / totalRtpMass : 0;

  ctx.payoutCoverage = {
    configs: allConfigs.length,
    minBetsPerConfig: MIN_BETS_PER_CONFIG,
    betsPerConfig: configCounts,
    totalPayoutCells: totalCells,
    cellsExercisedByLivePlay: observedCells,
    cellsNeverExercised: uncoveredCells.length,
    uncoveredRtpShareOfTotal: uncoveredRtpShare,
    note: 'A payout cell is one (risk, picks, hits) entry of the committed kenoConfig.json multiplier '
      + 'table. `cellsNeverExercised` are the entries no captured bet ever landed on, so this dataset '
      + 'does not confirm their multipliers directly; `uncoveredRtpShareOfTotal` is the fraction of '
      + 'summed theoretical RTP that rests on them. Step 17 covers the full table analytically, against '
      + 'hypergeometric probabilities derived independently of the operator config.',
    uncoveredCells,
  };

  const configIssues: string[] = [];
  if (missing.length > 0) {
    configIssues.push(`${missing.length} config(s) never played: ${missing.map(c => `${c.risk}/p${c.picks}`).join(', ')}`);
  }
  if (belowFloor.length > 0) {
    configIssues.push(`${belowFloor.length} config(s) below the ${MIN_BETS_PER_CONFIG}-bet floor: ${belowFloor.join(', ')}`);
  }
  // Bets on a (risk, picks) the committed table does not define are counted, not dropped.
  const knownKeys = new Set(allConfigs.map(({ risk, picks }) => `${risk}|${picks}`));
  const offTable  = Object.entries(configCounts).filter(([k]) => !knownKeys.has(k)).reduce((n, [, c]) => n + c, 0);
  if (offTable > 0) configIssues.push(`${offTable} bet(s) on a (risk, picks) not in kenoConfig.json`);
  const counted = Object.values(configCounts).reduce((n, c) => n + c, 0);
  if (counted !== EXPECTED_BETS) configIssues.push(`${counted} bets counted != ${EXPECTED_BETS} in the capture plan`);

  // The floor is SCORED: a configuration live play did not exercise to the floor is a claim this
  // audit would otherwise make without evidence, so it is a FAIL, not a FLAG that exits 2.
  results.push(step(10, 'Configuration Completeness & Payout-Cell Coverage',
    configIssues.length === 0 ? 'PASS' : 'FAIL',
    configIssues.length > 0
      ? configIssues.join('; ')
      : `All ${allConfigs.length} (risk × picks) configurations carry at least ${MIN_BETS_PER_CONFIG} live bets. `
        + `Payout-cell coverage, and the share of theoretical RTP on cells live play never reached, are `
        + `itemised in outputs/payout-coverage.json; the whole committed table is covered analytically by step 17.`,
    {
      configsCovered: Object.keys(configCounts).length,
      configsExpected: allConfigs.length,
      minBetsPerConfig: MIN_BETS_PER_CONFIG,
      leanestConfigBets: Math.min(...allConfigs.map(({ risk, picks }) => configCounts[`${risk}|${picks}`] ?? 0)),
      totalPayoutCells: totalCells,
      cellsExercisedByLivePlay: observedCells,
      cellsNeverExercised: uncoveredCells.length,
      uncoveredRtpShareOfTotal: uncoveredRtpShare,
      // KENO-15 asks Phase A ALONE to cover every configuration at the floor. This capture plan put
      // picks 2–9 in Phase A and picks 1 / picks 10 in Phases B / C, so Phase A covers 32 of the 40.
      // Measured and printed, not scored (captured 2026-04-11, before the standard; limitation DL-6).
      phaseAConfigsCovered: Object.keys(phaseConfigCounts.A ?? {}).length,
      phaseALeanestConfigBets: Math.min(...Object.values(phaseConfigCounts.A ?? { none: 0 })),
      phaseACoversAllConfigs: Object.keys(phaseConfigCounts.A ?? {}).length === allConfigs.length,
      configsPerPhase: Object.fromEntries(Object.entries(phaseConfigCounts).map(([p, m]) => [p, Object.keys(m).length])),
      hitsCountedFrom: 'recomputed draw (Step 5)',
    },
  ));

  // ── Step 11: Captured edge fields ─────────────────────────────────────────────
  // The claim is "no scaling edge in the pinned config — one flat edge on every captured bet". Two
  // sources can contradict it:
  // the pinned config (a non-empty scaling_edge table) and the operator's own per-bet
  // effective_edge. Either is a FAIL: a scaling edge changes the RTP the report publishes. The
  // detail prints what was measured, not the conclusion. That the flat edge IS 0.1% of RTP is
  // proven from the table by step 17, not asserted here.
  const scalingEdge = configRaw.data.scaling_edge;
  const hasNoEdge   = Array.isArray(scalingEdge) && scalingEdge.length === 0;
  const edgeCounts: Record<string, number> = {};
  for (const b of bets) {
    const k = String(b.response.effective_edge);
    edgeCounts[k] = (edgeCounts[k] ?? 0) + 1;
  }
  const offEdge = bets.filter(b => b.response.effective_edge !== SERVED_EDGE).length;
  // The stakes the capture placed. The step can speak only for these: a ladder that starts above
  // the highest one would leave every captured bet at the flat edge (MANIFEST DL-9).
  const capturedStakes = [...new Set(bets.map(b => b.request.amount))].sort((a, b) => Number(a) - Number(b));
  const s11Issues: string[] = [];
  if (!hasNoEdge) s11Issues.push(`kenoConfig.json scaling_edge is ${JSON.stringify(scalingEdge)}, not []`);
  if (offEdge > 0) s11Issues.push(`${offEdge} bet(s) served an effective_edge other than ${SERVED_EDGE}`);
  if (bets.length !== EXPECTED_BETS) s11Issues.push(`${bets.length} bets examined != ${EXPECTED_BETS}`);
  results.push(step(11, 'Captured Edge Fields (pinned scaling_edge empty)',
    s11Issues.length === 0 ? 'PASS' : 'FAIL',
    s11Issues.length > 0
      ? `Scaling edge present: ${s11Issues.join('; ')}. Served effective_edge values: ${JSON.stringify(edgeCounts)}`
      : `pinned config scaling_edge field: ${JSON.stringify(scalingEdge)}; served effective_edge = ${SERVED_EDGE} on all `
        + `${EXPECTED_BETS} bets, at the captured stakes only (${capturedStakes.map(s => '$' + s).join(' and ')}) — no edge change `
        + `between them. No stake above $${capturedStakes[capturedStakes.length - 1]} was captured, so this says nothing `
        + `about the edge above it (DL-9). The flat edge's size (RTP 99.9% on every config) is proven from the table `
        + `in step 17.`,
    { scalingEdgeEntries: Array.isArray(scalingEdge) ? scalingEdge.length : -1, servedEdgeCounts: edgeCounts, offEdgeBets: offEdge },
  ));

  // ── Step 12: Consolation payout disclosure ────────────────────────────────────
  const consolation = [
    { risk: 'LOW'    as RiskLevel, picks: 1, expected: 0.71 },
    { risk: 'MEDIUM' as RiskLevel, picks: 1, expected: 0.41 },
  ];
  // The detail prints the MEASURED table value beside the expected one, so a FAIL says what the
  // table actually holds instead of repeating the claim it just refuted.
  let ok = true;
  const measured: string[] = [];
  const measuredData: Record<string, number | null> = {};
  for (const { risk, picks, expected } of consolation) {
    let m: number | null = null;
    try { m = cfg.multiplier(risk, picks, 0); } catch { m = null; }
    if (m === null || !Number.isFinite(m) || Math.abs(m - expected) > moneyTol(expected)) ok = false;
    measured.push(`${risk} picks=${picks}: table ${m === null ? 'ABSENT' : `${m}×`} on 0 hits (expected ${expected}×)`);
    measuredData[`${risk}_picks${picks}_hits0`] = m;
  }
  // KENO-14 — EVERY non-monotone cell of the whole table is enumerated, not only the two the report
  // names: a consolation payout on 0 hits, a zero sitting between two paying cells, and a cell that
  // pays less than the one below it. The enumeration must equal the DECLARED list below exactly; a
  // table that grows a new non-monotone cell, or loses one, FAILs here.
  const DECLARED_NON_MONOTONE = ['consolation LOW/1/0', 'consolation MEDIUM/1/0'];
  const nonMonotone: string[] = [];
  for (const { risk, picks } of cfg.allConfigs()) {
    const row = Array.from({ length: picks + 1 }, (_, k) => cfg.multiplier(risk, picks, k));
    if (row[0] > 0) nonMonotone.push(`consolation ${risk}/${picks}/0`);
    row.forEach((v, k) => {
      if (v === 0 && row.slice(0, k).some(x => x > 0) && row.slice(k + 1).some(x => x > 0)) nonMonotone.push(`zero-between ${risk}/${picks}/${k}`);
      if (k > 0 && v < row[k - 1]) nonMonotone.push(`decrease ${risk}/${picks}/${k}`);
    });
  }
  const nmOk = nonMonotone.length === DECLARED_NON_MONOTONE.length
    && nonMonotone.every(x => DECLARED_NON_MONOTONE.includes(x));
  if (!nmOk) ok = false;

  // Caps. Under proposed rule R2 a cap applies to SERVED
  // multipliers and an undeclared cap makes the cap half n/a with evidence. The pinned config carries
  // no max-odds / max-payout / max-profit key (its data keys are listed below), and the package
  // declares none, so the cap is DECLARED UNDECLARED; the largest cell and the largest served
  // multiplier are printed as the evidence.
  // Any key naming a payout / odds / profit / win / bet limit. `max_picks` is the pick-count bound, not a cap.
  const LIMIT_KEY = /(max|min)_?(odds|payout|profit|win|bet|multiplier)|limit|cap|exposure/i;
  const configKeys = Object.keys(configRaw.data);
  const limitKeys = configKeys.filter(k => LIMIT_KEY.test(k));
  // EVERY cell holding the largest value is listed: the April table has more than one (a tie must not
  // be reported as a single "largest cell").
  let maxCell = 0, maxCellAt: string[] = [];
  for (const { risk, picks } of cfg.allConfigs()) for (let k = 0; k <= picks; k++) {
    const m = cfg.multiplier(risk, picks, k);
    if (m > maxCell) { maxCell = m; maxCellAt = []; }
    if (m === maxCell) maxCellAt.push(`${risk}/${picks}/${k}`);
  }
  const maxServed = Math.max(...bets.map(b => Number(b.response.multiplier)));
  if (limitKeys.length > 0) ok = false;   // a declared cap would have to be checked, not declared n/a

  results.push(step(12, 'Consolation Payout Disclosure (LOW/MEDIUM picks=1 zero-hit)',
    ok ? 'PASS' : 'FAIL',
    ok ? `${measured.join('; ')} — confirmed in multiplier table. Every non-monotone cell of the 260-cell table enumerated: `
         + `exactly the ${DECLARED_NON_MONOTONE.length} declared consolation cells, no zero between paying cells, no cell below `
         + `the one before it. No max-odds / max-payout / max-profit cap is declared by the package or carried by the pinned `
         + `config (${limitKeys.length} limit keys among its ${configKeys.length} data keys) — cap half n/a under proposed rule R2; largest cell value `
         + `${maxCell}×, held by ${maxCellAt.length} cell${maxCellAt.length === 1 ? '' : 's'} (${maxCellAt.join(', ')}).`
       : `Consolation / non-monotone cells or caps NOT as declared: ${measured.join('; ')}; enumerated ${JSON.stringify(nonMonotone)} `
         + `vs declared ${JSON.stringify(DECLARED_NON_MONOTONE)}; limit keys in the config ${JSON.stringify(limitKeys)} (declared none)`,
    { ...measuredData, nonMonotoneCells: nonMonotone, declaredNonMonotoneCells: DECLARED_NON_MONOTONE,
      configDataKeys: configKeys, limitKeysInConfig: limitKeys, capDeclared: false,
      largestTableCell: maxCell, largestTableCellCount: maxCellAt.length, largestTableCellAt: maxCellAt,
      largestServedMultiplier: maxServed },
  ));

  return results;
}

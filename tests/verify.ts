/**
 * Keno audit verification suite — 23 scored steps + informational context.
 * Run: npm run verify
 * Expected: 22 PASS + 1 capture-origin FLAG (Step 4, verdict-neutral), verdict PROVABLY FAIR —
 * Full Pass, exit 0.
 */

import * as fs   from 'fs';
import * as path from 'path';

import { KenoConfig }                              from '../src/config';
import { loadDataset, checkDatasetHash, checkConfigHash, buildSeedMap, groupByHash } from '../src/loader';
import type { KenoConfigFile }                     from '../src/types';
import type { VerifyContext }                      from './steps/context';

import * as commitment     from './steps/commitment';
import * as determinism    from './steps/determinism';
import * as payouts        from './steps/payouts';
import * as statistical    from './steps/statistical';
import * as dataset        from './steps/dataset';
import * as simulation     from './steps/simulation';
import * as artifacts      from './steps/artifacts';
import * as bias           from './steps/bias';
import * as parity         from './steps/parity';
import { labelFor, profileCoverageBlock } from '../src/profile-map';
import { runRtpClaimGate, RTP_CLAIM_STEP } from '../src/rtp-settings';
import { rtpClaimVerdict, RTP_FIGURE_OVERSTATED, RTP_FIGURE_OVERSTATED_EXIT } from '../src/rtp-claim';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from '../src/diff';

// ── Pre-flight: dataset hash ───────────────────────────────────────────────────

const hashCheck = checkDatasetHash();
console.log('\n  Dataset hash check (EC-25):');
console.log(`    Expected: ${hashCheck.expected}`);
console.log(`    Actual:   ${hashCheck.actual}`);
console.log(`    Status:   ${hashCheck.match ? 'MATCH ✓' : 'MISMATCH ✗ — abort'}\n`);
if (!hashCheck.match) { process.exit(1); }

// ── Pre-flight: config hash ────────────────────────────────────────────────────
// The multiplier table is the other input every payout figure is conditioned on.

const configHashCheck = checkConfigHash();
console.log('  Config hash check (kenoConfig.json):');
console.log(`    Expected: ${configHashCheck.expected}`);
console.log(`    Actual:   ${configHashCheck.actual}`);
console.log(`    Status:   ${configHashCheck.match ? 'MATCH ✓' : 'MISMATCH ✗ — abort'}\n`);
if (!configHashCheck.match) { process.exit(1); }

// ── Setup ─────────────────────────────────────────────────────────────────────

const configRaw: KenoConfigFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../kenoConfig.json'), 'utf-8'),
);
const cfg     = new KenoConfig(configRaw.data);
const ds      = loadDataset();
const seedMap = buildSeedMap(ds.seeds);

const bets   = ds.bets;
const seeds  = ds.seeds;
const byHash = groupByHash(bets);
const phaseA = bets.filter(b => b.phase === 'A');
const phaseB = bets.filter(b => b.phase === 'B');
const phaseC = bets.filter(b => b.phase === 'C');
const phaseD = bets.filter(b => b.phase === 'D');

const outputsDir = path.join(__dirname, '../outputs');

console.log('══════════════════════════════════════════════════════════');
console.log('  KENO AUDIT — VERIFICATION SUITE');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Dataset: ${bets.length} bets  |  Seeds: ${seeds.length}`);
console.log(`  Phase A: ${phaseA.length}  Phase B: ${phaseB.length}  Phase C: ${phaseC.length}  Phase D: ${phaseD.length}\n`);

// ── Build context ─────────────────────────────────────────────────────────────

const ctx: VerifyContext = {
  bets, seeds, cfg, seedMap, byHash,
  phaseA, phaseB, phaseC, phaseD,
  configRaw, outputsDir,
  step5Mismatches: 0,
  step5Skipped:    0,
  chiResultsLog:   [],
  payoutCoverage:  null,
  recomputedDraws: [],
  drawCensus:      null,
};

// ── Run scored steps ─────────────────────────────────────────────────────────

const scored = [
  ...commitment.run(ctx),   // Steps  1– 4
  ...determinism.run(ctx),  // Steps  5– 6
  ...payouts.run(ctx),      // Steps  7–12
  ...dataset.run(ctx),      // Steps 13–18
  ...simulation.run(ctx),   // Steps 19–20
  ...artifacts.run(ctx),    // Step  21
  ...bias.run(ctx),         // Step  22
  ...parity.run(ctx),       // Step  23
];
// Each scored step says which ProvablyFair.org Keno profile check it implements (src/profile-map.ts),
// so the conformance matrix is read from this artifact rather than typed by hand. The label is
// attached to the emitted record only: it cannot change what any step asserts.
const results = scored.map(r => ({ ...r, ...labelFor(r.step) }));

// ── Informational context (not scored) ───────────────────────────────────────

const infoItems = statistical.run(ctx);

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Informational Context (live dataset — not scored)');
console.log('══════════════════════════════════════════════════════════');
for (const item of infoItems) {
  console.log(`  [INFO] ${item.label} — ${item.detail}`);
}

// ── RTP-CLAIM rule (1.2.0, Methodology v1.1; 1.1.0 2026-10-01) ─────────────────
// The per-setting exact RTP table held to the published claim (src/rtp-settings.ts; kind 'tiered':
// each row held to the edge Duel's game settings state for its stake tier). The package switch
// RTP_CLAIM_RULE_ENFORCED (src/rtp-claim-switch.ts) is true (D3, 2026-10-14). Status OVERSTATED (a
// house-side miss) is scored on the step carrying KENO-19 as an operator-origin FLAG (the profile's
// policy) and the verdict becomes RTP FIGURE OVERSTATED, exit 5 (rtpClaimVerdict) — never NOT
// PROVABLY FAIR: the draws themselves pass. Status FAIL means the committed table no longer equals
// this run (or its pin): a reproduction failure, exit 1, whether or not the rule is enforced; no
// step moves for it.
const rtpClaim = runRtpClaimGate();
console.log('');
for (const line of rtpClaim.lines) console.log(`  ${line}`);
const rtpOverstated = rtpClaim.status === 'OVERSTATED';
// The rule's outcome is RECORDED on the step it is scored on, pass or miss, so the results file
// shows what Step 17 was held to rather than leaving the RTP claim to the console. Labels and counts
// only: nothing here moves a status (that is the block below).
{
  const s = (results as any[]).find(r => r.step === RTP_CLAIM_STEP);
  const r = rtpClaim.result;
  if (s) s.data = { ...(s.data ?? {}), rtpClaim: {
    rule: r.rule, ruleVersion: r.ruleVersion, enforced: r.enforced, status: rtpClaim.status, outcome: r.outcome,
    claimKind: r.claim.kind, bandPp: r.bandPp, settings: r.settings, houseSideBeyondBand: r.houseSideFailures,
    playerFavourableBeyondBand: r.playerFavourable, unstated: r.unstated, worst: r.worst,
    trueMin: { setting: r.trueMin.setting, rtpPct: r.trueMin.rtpPct }, trueMax: { setting: r.trueMax.setting, rtpPct: r.trueMax.rtpPct },
    table: 'outputs/rtp-claim-table.json', tableMatchesRunAndPin: rtpClaim.tableMatches,
  } };
}
if (rtpOverstated) {
  const s = (results as any[]).find(r => r.step === RTP_CLAIM_STEP);
  if (s && s.status !== 'FAIL') {
    s.status = 'FLAG'; s.origin = 'operator';
    s.detail += ` — ${RTP_FIGURE_OVERSTATED} (RTP-CLAIM enforced): ${rtpClaim.result.minimalFix}`;
    // The step printed its own line when it ran, before this rule was scored. Print it again at the
    // status it is now counted at, so the console agrees with the summary and the emitted record.
    console.log(`  [FLAG] Step ${s.step} — ${s.name} (re-scored: RTP-CLAIM enforced, ${RTP_FIGURE_OVERSTATED})`);
    console.log(`         ${s.detail}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

const passed   = results.filter(r => r.status === 'PASS').length;
const flags    = results.filter(r => r.status === 'FLAG').length;
const hardFail = results.filter(r => r.status === 'FAIL').length;
// A capture-origin FLAG (an auditor-side capture retry reconstructed via commit-reveal) is disclosed
// but verdict-neutral; only an operator-origin FLAG downgrades to Conditional Pass (profile
// policies.FLAG, decided 2026-09-17; ported from Duel Dice for KENO-04).
const captureFlags  = results.filter(r => r.status === 'FLAG' && r.origin === 'capture').length;
const operatorFlags = results.filter(r => r.status === 'FLAG' && r.origin !== 'capture').length;
// Ranked by the rule's rtpClaimVerdict: a failed draw check (NOT PROVABLY FAIR) > RTP FIGURE
// OVERSTATED > Conditional Pass > Full Pass. This suite has no INCOMPLETE state.
const ruled    = rtpClaimVerdict({ fails: hardFail, complete: true, overstated: rtpOverstated, opFlags: operatorFlags });
const verdict  = ruled.verdict;

console.log('\n══════════════════════════════════════════════════════════');
console.log('  RESULTS SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Passed:     ${passed}/${results.length}`);
console.log(`  Hard fails: ${hardFail}`);
console.log(`  Flags:      ${flags} (${operatorFlags} verdict-affecting, ${captureFlags} capture-origin / verdict-neutral)`);
console.log(`\n  VERDICT: ${verdict}`);
console.log('══════════════════════════════════════════════════════════\n');

// ── Write output ──────────────────────────────────────────────────────────────

// NO RUN METADATA in any artifact this suite writes (KENO-27, rules.reproduction): the reproduction
// gate below excludes no field, so a timestamp that crept back in would show up as a difference.
const verificationOutput = {
  totalBets:   bets.length,
  totalSeeds:  seeds.length,
  datasetHash: { expected: hashCheck.expected, actual: hashCheck.actual, match: hashCheck.match },
  configHash:  { expected: configHashCheck.expected, actual: configHashCheck.actual, match: configHashCheck.match },
  steps:       results,
  informational: infoItems,
  summary:     { passed, flags, operatorFlags, captureFlags, hardFail, verdict },
  profileCoverage: profileCoverageBlock(),
};

// determinism-log.json and chi-squared-results.json are pinned artifacts of record (Step 21), so
// they carry NO `generatedAt`: a timestamp inside a pinned file means a legitimate regeneration
// with every figure identical still changes its bytes and breaks its pin, and a re-pin taken
// from such a run is a pin on the clock. verification-results.json is not pinned (it carries
// Step 21's own verdict) and, since 2026-09-25, carries no timestamp either.
const determinismOutput = {
  verified:    bets.length,
  mismatches:  ctx.step5Mismatches,
  skipped:     ctx.step5Skipped,
};

const chiSquaredOutput = {
  configs:     ctx.chiResultsLog,
};

// Which entries of the committed multiplier table live play actually landed on, and how much
// theoretical RTP rests on the ones it never reached. NO `generatedAt`: this is an artifact of
// record derived wholly from the pinned dataset and the pinned config, so a timestamp inside it
// would mean a regeneration could never reproduce the pinned bytes even when every figure is
// identical. Step 10 fills it; the reproduction gate below scores it.
const payoutCoverageOutput = ctx.payoutCoverage ?? { error: 'step 10 did not run' };

// A VERIFICATION RUN MUST NOT REWRITE THE ARTIFACT IT SCORES. A run that disagrees with the
// committed evidence would otherwise destroy the evidence of the disagreement, and the next run
// would compare the repo against what the failing run had just written. This run writes under
// outputs/run/ — gitignored, a run record rather than audit evidence. The committed copies in
// outputs/ are refreshed only by PF_EMIT=1.
const PF_EMIT = process.env.PF_EMIT === '1';
const RUN_DIR = path.join(outputsDir, 'run');
const RESULTS_DIR = PF_EMIT ? outputsDir : RUN_DIR;
fs.mkdirSync(outputsDir, { recursive: true });
fs.mkdirSync(RUN_DIR, { recursive: true });

fs.writeFileSync(path.join(RESULTS_DIR, 'verification-results.json'), JSON.stringify(verificationOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'determinism-log.json'), JSON.stringify(determinismOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'chi-squared-results.json'), JSON.stringify(chiSquaredOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'payout-coverage.json'), JSON.stringify(payoutCoverageOutput, null, 2));

const WROTE_TO = PF_EMIT ? 'outputs' : 'outputs/run';
console.log(`  Outputs written to: ${WROTE_TO}/verification-results.json`);
console.log(`  Outputs written to: ${WROTE_TO}/determinism-log.json`);
console.log(`  Outputs written to: ${WROTE_TO}/chi-squared-results.json`);
console.log(`  Outputs written to: ${WROTE_TO}/payout-coverage.json`);
if (!PF_EMIT) console.log('  Committed artifacts NOT modified.');

// ── Reproduction gate ─────────────────────────────────────────────────────────
// THE GATE IS "BEYOND TOLERANCE", NOT "ANY FIELD". Byte identity is the right bar for exact
// content — the dataset, hash-guarded above. It is the wrong bar for a DERIVED statistic:
// recomputed on other hardware a floating-point figure can move by a unit in the last place.
// Scoring that as a disagreement trains a reader to ignore the diff, which is the one outcome
// that makes it useless. The bound is declared in src/diff.ts, far below the precision of any
// figure this audit publishes; outside it is a DIFFERENT result, and the run exits 1.
let reproductionFailures = 0;
if (!PF_EMIT) {
  const readJsonOrNull = (p: string): unknown => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  };
  const targets: { file: string; fresh: unknown }[] = [
    { file: 'verification-results.json', fresh: verificationOutput },
    { file: 'determinism-log.json',      fresh: determinismOutput },
    { file: 'chi-squared-results.json',  fresh: chiSquaredOutput },
    { file: 'payout-coverage.json',      fresh: payoutCoverageOutput },
  ];
  // test:full regenerates the simulation into outputs/run/ (`npm run simulate` writes there unless
  // PF_EMIT=1). When that regeneration is present it is field-diffed against the pinned committed
  // artifact at the same tolerance, so a regeneration that drifts is caught (KENO-28). Plain
  // `npm test` does not regenerate it; Steps 19–21 then score the pinned census as-is.
  const runSim = readJsonOrNull(path.join(RUN_DIR, 'simulation-results.json'));
  if (runSim !== null) targets.push({ file: 'simulation-results.json', fresh: runSim });
  const perFile = targets.map(t => {
    const committed = readJsonOrNull(path.join(outputsDir, t.file));
    // No field is excluded: run metadata is ABSENT from every artifact, not skipped by the diff.
    const diffs = fieldDiff(committed, t.fresh, []);
    return { file: t.file, readable: committed !== null, diffs, real: beyondTolerance(diffs) };
  });
  const allDiffs  = perFile.flatMap(p => p.diffs);
  const realTotal = perFile.reduce((n, p) => n + p.real.length, 0);
  const gap       = maxima(allDiffs);

  fs.writeFileSync(path.join(RUN_DIR, 'diff.json'), JSON.stringify({
    runtime: process.versions.node,
    verdict,
    tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL, rule: '|a-b| <= atol + rtol*max(|a|,|b|); two distinct integers never agree' },
    reproduced: realTotal === 0,
    beyondToleranceCount: realTotal,
    withinToleranceCount: allDiffs.length - realTotal,
    largestGap: gap,
    note: 'Field-level diff between the COMMITTED artifacts and THIS RUN. No field is excluded: the '
      + 'artifacts of record carry no run metadata. Entries marked `withinTolerance` are the '
      + 'same result computed on different hardware and are recorded, not scored. Any entry NOT '
      + 'so marked means this run disagrees with the committed evidence — investigate it; do not '
      + 're-run until it goes away, and do not regenerate the committed artifact to make it go away.',
    files: perFile.map(p => ({ file: `outputs/${p.file}`, committedReadable: p.readable, differences: p.diffs })),
  }, null, 2));

  console.log(`  Reproduction vs the committed artifacts on Node ${process.versions.node}: `
    + `${realTotal === 0 ? 'REPRODUCED' : `${realTotal} field(s) BEYOND TOLERANCE`}`
    + `${allDiffs.length - realTotal > 0 ? ` (${allDiffs.length - realTotal} within tolerance` + (gap ? `, largest ${gap.absDiff.toExponential(2)} at ${gap.path}` : '') + ')' : ''}`);
  console.log(`  Diff written to: outputs/run/diff.json`);
  if (realTotal > 0) {
    console.log('  ⚠ THIS RUN DISAGREES WITH THE COMMITTED EVIDENCE:');
    for (const p of perFile) {
      if (!p.readable) { console.log(`      outputs/${p.file}: committed copy absent or unreadable`); continue; }
      for (const d of p.real.slice(0, 4)) {
        console.log(`      ${p.file} ${d.path}: committed ${JSON.stringify(d.committed)} vs this run ${JSON.stringify(d.thisRun)}`);
      }
    }
  }
  reproductionFailures = realTotal;
} else {
  console.log('  REPORT GENERATION (PF_EMIT=1): the committed artifacts in outputs/ were rewritten.');
}

// ── Exit contract ─────────────────────────────────────────────────────────────
// FAIL -> 1, RTP FIGURE OVERSTATED -> 5, FLAG -> 2, otherwise 0, so an automated caller reads the
// verdict from the exit status. A reproduction beyond tolerance is a FAIL, not a warning: a gate
// that only prints is not a gate.
// A capture-origin FLAG is disclosed but verdict-neutral: it does not move the exit off 0.
if (hardFail > 0 || reproductionFailures > 0 || !rtpClaim.tableMatches) process.exit(1);
if (ruled.exit === RTP_FIGURE_OVERSTATED_EXIT) process.exit(RTP_FIGURE_OVERSTATED_EXIT);
if (operatorFlags > 0) process.exit(2);

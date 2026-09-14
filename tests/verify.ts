/**
 * Keno audit verification suite — 20 scored steps + informational context.
 * Run: npm run verify
 * Expected: 20/20 PASS, verdict PROVABLY FAIR — Full Pass
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
import * as artifacts   from './steps/artifacts';

// ── Pre-flight: dataset hash ───────────────────────────────────────────────────

const hashCheck = checkDatasetHash();
console.log('\n  Dataset hash check (EC-25):');
console.log(`    Expected: ${hashCheck.expected}`);
console.log(`    Actual:   ${hashCheck.actual}`);
console.log(`    Status:   ${hashCheck.match ? 'MATCH ✓' : 'MISMATCH ✗ — abort'}\n`);
if (!hashCheck.match) { process.exit(1); }

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
};

// ── Run scored steps ─────────────────────────────────────────────────────────

const results = [
  ...commitment.run(ctx),   // Steps  1– 4
  ...determinism.run(ctx),  // Steps  5– 6
  ...payouts.run(ctx),      // Steps  7–12
  ...dataset.run(ctx),      // Steps 13–18
  ...simulation.run(ctx),   // Steps 19–20
  ...artifacts.run(ctx),    // Step 21
];

// ── Informational context (not scored) ───────────────────────────────────────

const infoItems = statistical.run(ctx);

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Informational Context (live dataset — not scored)');
console.log('══════════════════════════════════════════════════════════');
for (const item of infoItems) {
  console.log(`  [INFO] ${item.label} — ${item.detail}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

const passed   = results.filter(r => r.status === 'PASS').length;
const flags    = results.filter(r => r.status === 'FLAG').length;
const hardFail = results.filter(r => r.status === 'FAIL').length;
const verdict  = hardFail > 0
  ? 'NOT PROVABLY FAIR'
  : flags > 0
    ? 'PROVABLY FAIR — Conditional Pass'
    : 'PROVABLY FAIR — Full Pass';

console.log('\n══════════════════════════════════════════════════════════');
console.log('  RESULTS SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Passed:     ${passed}/${results.length}`);
console.log(`  Hard fails: ${hardFail}`);
console.log(`\n  VERDICT: ${verdict}`);
console.log('══════════════════════════════════════════════════════════\n');

// ── Write output ──────────────────────────────────────────────────────────────

if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

fs.writeFileSync(path.join(outputsDir, 'verification-results.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalBets:   bets.length,
  totalSeeds:  seeds.length,
  datasetHash: { expected: hashCheck.expected, actual: hashCheck.actual, match: hashCheck.match },
  configHash:  { expected: configHashCheck.expected, actual: configHashCheck.actual, match: configHashCheck.match },
  steps:       results,
  informational: infoItems,
  summary:     { passed, flags, hardFail, verdict },
}, null, 2));

fs.writeFileSync(path.join(outputsDir, 'determinism-log.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  verified:    bets.length,
  mismatches:  ctx.step5Mismatches,
  skipped:     ctx.step5Skipped,
}, null, 2));

fs.writeFileSync(path.join(outputsDir, 'chi-squared-results.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  configs:     ctx.chiResultsLog,
}, null, 2));

console.log(`  Outputs written to: outputs/verification-results.json`);
console.log(`  Outputs written to: outputs/determinism-log.json`);
console.log(`  Outputs written to: outputs/chi-squared-results.json`);

if (hardFail > 0) process.exit(1);

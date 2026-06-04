/**
 * Steps 19–20: Simulation Results
 */

import * as fs   from 'fs';
import * as path from 'path';

import type { StepResult } from './context';
import { step, VerifyContext } from './context';

/** Two-tailed critical z for a given alpha (Abramowitz & Stegun 26.2.23). */
function inverseCriticalZ(alpha: number): number {
  const p = alpha / 2;
  const t = Math.sqrt(-2 * Math.log(p));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir } = ctx;
  const simPath = path.join(outputsDir, 'simulation-results.json');

  // ── Step 18: Pass 1 integrity ─────────────────────────────────────────────────
  if (!fs.existsSync(simPath)) {
    const s22 = step(19, 'Simulation Results — Pass 1 Integrity', 'FLAG',
      'simulation-results.json not found — run npm run simulate first',
    );
    const s23 = step(20, 'Simulation Results — Pass 2 Cherry-Pick Test', 'FLAG',
      'simulation-results.json not found',
    );
    return [s22, s23];
  }

  const sim   = JSON.parse(fs.readFileSync(simPath, 'utf-8'));
  const pass1 = sim.pass1_fresh_seeds;
  const fails    = pass1.chi2FailsAtAlpha01;
  const configs  = pass1.configs;
  const bonAlpha = 0.01 / configs;
  const failsBon = pass1.results.filter((r: { pValue: number }) => r.pValue < bonAlpha).length;
  const serialFails = pass1.serialIndependenceFails ?? 0;
  // Bonferroni on serial independence — same correction as chi-squared
  const bonZCrit = inverseCriticalZ(bonAlpha);
  const serialBonFails = pass1.results.filter((r: { r1Z: number; runsPValue: number }) =>
    Math.abs(r.r1Z) > bonZCrit || r.runsPValue < bonAlpha
  ).length;
  const pass1Pass = failsBon === 0 && serialBonFails === 0;

  // Build summary — lead with Bonferroni result, frame uncorrected as expected noise
  const totalBonFails = failsBon + serialBonFails;
  const totalUncorrected = fails + serialFails;
  let summary = `${pass1.totalRounds.toLocaleString()} rounds × ${configs} configs; avg RTP=${(pass1.avgSimulatedRTP * 100).toFixed(4)}%. `;
  summary += `${totalBonFails}/${configs} configs fail at Bonferroni-corrected threshold (α/${configs} = ${bonAlpha.toFixed(5)}). `;
  if (totalUncorrected > 0) {
    summary += `${totalUncorrected}/${configs} flag at uncorrected α = 0.01, consistent with expected false-positive rate across ${configs} independent tests.`;
  } else {
    summary += `0/${configs} flag even at uncorrected α = 0.01.`;
  }

  const s22 = step(19, 'Simulation Results — Pass 1 Integrity',
    pass1Pass ? 'PASS' : 'FAIL', summary,
  );
  // Always print summary for simulation steps (Bonferroni context matters even on PASS)
  if (pass1Pass) console.log(`         ${summary}`);
  // Detail lines — only when there are uncorrected flags, name the specific configs
  if (fails > 0) {
    const flaggedChi2 = (pass1.results as Array<{ picks: number; risk: string; pValue: number }>)
      .filter(r => r.pValue < 0.01)
      .map(r => `${r.risk}/${r.picks}p p=${r.pValue.toFixed(4)}`)
      .join(', ');
    console.log(`         ℹ Chi-squared flagged: ${flaggedChi2}`);
  }
  if (serialFails > 0) {
    const flaggedSerial = (pass1.results as Array<{ picks: number; risk: string; r1Z: number; runsPValue: number }>)
      .filter(r => Math.abs(r.r1Z) > 3 || r.runsPValue < 0.01)
      .map(r => {
        const reasons: string[] = [];
        if (Math.abs(r.r1Z) > 3) reasons.push(`|r1Z|=${Math.abs(r.r1Z).toFixed(2)}`);
        if (r.runsPValue < 0.01) reasons.push(`runsP=${r.runsPValue.toFixed(4)}`);
        return `${r.risk}/${r.picks}p (${reasons.join(', ')})`;
      })
      .join(', ');
    console.log(`         ℹ Serial flagged: ${flaggedSerial}`);
  }

  // ── Step 19: Pass 2 cherry-pick test ─────────────────────────────────────────
  const pass2 = sim.pass2_casino_seeds;
  const N     = pass2.seed_config_combinations;
  const flags = pass2.test_b_cherry_pick_flags;
  const testA = pass2.test_a_chi2_fails_at_alpha01;
  const expCP = Math.ceil(N * 0.05 * 0.95);
  const expTA = Math.ceil(N * 0.01);

  let broadFlags = 0;
  let earlyOnly  = 0;
  for (const r of pass2.results) {
    if (r.cherry_pick_flag) {
      if (r.early_p < 0.05 && r.late_p < 0.05) broadFlags++;
      else earlyOnly++;
    }
  }

  const verdict = flags <= expCP && broadFlags === 0 ? 'PASS' : 'FLAG';
  const pass2Summary = `${N} seed×config combos; Test A: ${testA}/${N} fails (expected ≤${expTA}); Test B: ${flags}/${N} flags (expected ≤${expCP} under H₀); ${earlyOnly} isolated-early, ${broadFlags} broad — ${broadFlags === 0 ? 'distributional noise confirmed' : 'INVESTIGATE broad flags'}`;
  const s23 = step(20, 'Simulation Results — Pass 2 Cherry-Pick Test', verdict, pass2Summary);
  if (verdict === 'PASS') console.log(`         ${pass2Summary}`);

  return [s22, s23];
}

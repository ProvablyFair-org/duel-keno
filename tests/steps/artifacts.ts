/**
 * Step 21 — Artifact Integrity.
 *
 * Recompute the SHA-256 of every artifact of record and compare it with the pin in
 * src/artifact-pins.ts. A missing or altered artifact is a HARD FAIL, not a flag: the figures in
 * these files are published, and a flag exits 0.
 *
 * The check reads the COMMITTED copies in outputs/, never outputs/run/: the run products of the
 * current invocation are not evidence and are not what the report quotes.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { ARTIFACT_PINS } from '../../src/artifact-pins';
import { validateDomains } from '../../src/domains';

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir } = ctx;

  const notes: string[] = [];
  let bad = 0;

  for (const [file, expected] of Object.entries(ARTIFACT_PINS)) {
    const fp = path.join(outputsDir, file);
    if (!fs.existsSync(fp)) {
      bad++;
      notes.push(`${file} ABSENT — a pinned artifact of record is missing`);
      continue;
    }
    const actual = createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    if (actual !== expected) {
      bad++;
      notes.push(`${file} sha256 ${actual.slice(0, 16)}… != pin ${expected.slice(0, 16)}… — the scored artifact is not the committed one`);
    } else {
      notes.push(`${file} matches its pin`);
    }
  }

  // VALUE DOMAINS (KENO-27). A re-pinned forgery passes the pin; it cannot pass a bound derived from
  // src/ (src/domains.ts). Both directions: every numeric leaf inside its domain, and every numeric
  // leaf path covered by a declared rule — an undeclared numeric field FAILs.
  const domainFiles = ['simulation-results.json', 'chi-squared-results.json', 'determinism-log.json', 'payout-coverage.json'];
  let leaves = 0, violations = 0, uncovered = 0;
  const domainNotes: string[] = [];
  for (const f of domainFiles) {
    let json: unknown;
    try { json = JSON.parse(fs.readFileSync(path.join(outputsDir, f), 'utf8')); }
    catch { violations++; domainNotes.push(`${f}: absent or unreadable`); continue; }
    const r = validateDomains(f, json);
    leaves += r.leaves; violations += r.violations.length; uncovered += r.uncovered.length;
    for (const v of r.violations.slice(0, 3)) domainNotes.push(`${f}: ${v}`);
    for (const u of r.uncovered.slice(0, 3)) domainNotes.push(`${f}: numeric leaf ${u} has no declared domain`);
  }
  if (leaves === 0) { violations++; domainNotes.push('0 numeric leaves checked'); }
  const ok = bad === 0 && violations === 0 && uncovered === 0;

  return [step(21, 'Artifact Integrity (pinned artifacts of record)',
    ok ? 'PASS' : 'FAIL',
    `${Object.keys(ARTIFACT_PINS).length} artifact(s) checked against src/artifact-pins.ts; ` +
    notes.join('; ') +
    `. Value domains (src/domains.ts): ${leaves} numeric leaves in ${domainFiles.length} artifacts, ${violations} outside `
      + `their domain, ${uncovered} without a declared domain` + (domainNotes.length ? ` — ${domainNotes.join('; ')}` : ''),
    { artifactsPinned: Object.keys(ARTIFACT_PINS).length, mismatches: bad,
      domainLeavesChecked: leaves, domainViolations: violations, leavesWithoutDomain: uncovered })];
}

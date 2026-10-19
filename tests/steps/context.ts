import type { KenoBet, SeedEntry, KenoConfigFile } from '../../src/types';
import { KenoConfig } from '../../src/config';

export interface StepResult {
  step:   number;
  name:   string;
  status: 'PASS' | 'FLAG' | 'FAIL';
  detail: string;
  /**
   * The step's measurements, as numbers.
   *
   * A MEASURED FLOAT MUST NEVER BE EMBEDDED IN `detail`. A string leaf cannot be
   * tolerance-compared: the reproduction gate in tests/verify.ts can only ask whether two
   * strings are identical, so a p-value or an RTP printed into the sentence turns ordinary
   * last-place drift on another machine into a permanent, unfixable disagreement — and the
   * first thing a reader does with a diff that always fails is stop reading it.
   *
   * The split: `detail` states the BOUND the step tested against, which is a constant and
   * compares exactly. The measurement goes here, where the tolerance applies.
   */
  data?:  Record<string, unknown>;
  /**
   * For a FLAG only. `capture` = an auditor-side capture artefact (a capture retry reconstructed
   * via commit-reveal): disclosed as a limitation row and verdict-neutral — a Full Pass survives it
   * and verify exits 0. `operator` (the default when a FLAG carries no origin) = a residual about
   * the game itself → Conditional Pass, exit 2. Rule decided 2026-09-17 (profile policies.FLAG),
   * ported from Duel Dice Step 4 for KENO-04.
   */
  origin?: 'capture' | 'operator';
  /** Profile labels, attached by tests/verify.ts from src/profile-map.ts. They never change a status. */
  profileIds?: string[];
  profileChecks?: unknown[];
  profileNote?: string;
}

export interface InfoItem {
  label:  string;
  detail: string;
}

export interface VerifyContext {
  bets:       KenoBet[];
  seeds:      SeedEntry[];
  cfg:        KenoConfig;
  seedMap:    Map<string, string>;
  byHash:     Map<string, KenoBet[]>;
  phaseA:     KenoBet[];
  phaseB:     KenoBet[];
  phaseC:     KenoBet[];
  phaseD:     KenoBet[];
  configRaw:  KenoConfigFile;
  outputsDir: string;
  // Mutable accumulators
  step5Mismatches: number;
  step5Skipped:    number;
  chiResultsLog:   Record<string, unknown>[];
  /** Filled by step 10; written to outputs/payout-coverage.json and scored by the reproduction gate. */
  payoutCoverage:  Record<string, unknown> | null;
  /**
   * Filled by step 5: bet index → the draw RECOMPUTED from the revealed seed (null when the seed is
   * unrevealed). Hits are counted from THIS set in steps 7–10 (KENO-10), never from the served
   * drawn_numbers, which are compared, not trusted.
   */
  recomputedDraws: Array<number[] | null>;
  /** Filled by step 5: rejection census of the draw over the whole capture (KENO-08, Step 22). */
  drawCensus: { hmacCalls: number; chunksScanned: number; chunksRejected: number; cursorAdvances: number } | null;
}

export function step(
  num: number,
  name: string,
  status: 'PASS' | 'FLAG' | 'FAIL',
  detail: string,
  data?: Record<string, unknown>,
  origin?: 'capture' | 'operator',
): StepResult {
  const tag = status === 'PASS' ? '[PASS]'
    : status === 'FLAG' ? (origin === 'capture' ? '[FLAG⚑]' : '[FLAG]')
    : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  const base: StepResult = { step: num, name, status, detail };
  if (data !== undefined) base.data = data;
  if (origin !== undefined) base.origin = origin;
  return base;
}

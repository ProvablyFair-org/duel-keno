import type { KenoBet, SeedEntry, KenoConfigFile } from '../../src/types';
import { KenoConfig } from '../../src/config';

export interface StepResult {
  step:   number;
  name:   string;
  status: 'PASS' | 'FLAG' | 'FAIL';
  detail: string;
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
}

export function step(
  num: number,
  name: string,
  status: 'PASS' | 'FLAG' | 'FAIL',
  detail: string
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'FLAG' ? '[FLAG]' : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  return { step: num, name, status, detail };
}

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { KenoDataset, KenoBet, SeedEntry } from './types';

const DATASET_PATH = path.join(__dirname, '../data/keno-master-5100bets.json');
const EXPECTED_HASH = '841755fdfb268d7796017212f08a18bfea7615c30a4590dd29793b34c5e6bcf9';

const CONFIG_PATH = path.join(__dirname, '../kenoConfig.json');
const KENO_CONFIG_HASH = 'efd3c645c4b3956199fde62dd65446c08e4605763d2d0f34c97a226bdbae4f91';

export function getDatasetPath(): string { return DATASET_PATH; }

export function loadDataset(): KenoDataset {
  const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
  return JSON.parse(raw) as KenoDataset;
}

export function loadDatasetBuffer(): Buffer {
  return fs.readFileSync(DATASET_PATH);
}

export function checkDatasetHash(): { expected: string; actual: string; match: boolean } {
  const raw = fs.readFileSync(DATASET_PATH);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  return { expected: EXPECTED_HASH, actual, match: actual === EXPECTED_HASH };
}

export function checkConfigHash(): { expected: string; actual: string; match: boolean } {
  const raw = fs.readFileSync(CONFIG_PATH);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  return { expected: KENO_CONFIG_HASH, actual, match: actual === KENO_CONFIG_HASH };
}

/**
 * Build O(1) map: serverSeedHashed → serverSeed (plaintext).
 *
 * In the v3 dataset, seeds[N].seed.serverSeed is the PREVIOUS epoch's
 * revealed seed. The plaintext for seeds[N].serverSeedHashed is in
 * seeds[N+1].seed.serverSeed. We verify the hash before adding.
 */
export function buildSeedMap(seeds: SeedEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < seeds.length - 1; i++) {
    const next = seeds[i + 1];
    if (next.seed.serverSeed) {
      const h = crypto.createHash('sha256')
        .update(Buffer.from(next.seed.serverSeed, 'hex'))
        .digest('hex');
      if (h === seeds[i].seed.serverSeedHashed) {
        m.set(seeds[i].seed.serverSeedHashed, next.seed.serverSeed);
      }
    }
  }
  return m;
}

/** Group bets by serverSeedHashed (epoch). */
export function groupByHash(bets: KenoBet[]): Map<string, KenoBet[]> {
  const m = new Map<string, KenoBet[]>();
  for (const b of bets) {
    const hash = b.seed.serverSeedHashed;
    const arr = m.get(hash) ?? [];
    arr.push(b);
    m.set(hash, arr);
  }
  return m;
}

/** Count hits: intersection of selected_positions and drawn_numbers. */
export function countHits(bet: KenoBet): number {
  const drawn = new Set(bet.response.drawn_numbers);
  return bet.request.selected_positions.filter(p => drawn.has(p)).length;
}

// ── POPULATION OF RECORD ─────────────────────────────────────────────────────────
// The capture plan, stated as CODE so a shrunken dataset cannot pass by agreeing with
// itself. Deleting rounds and doctoring the header to match leaves a file that is
// internally consistent and re-pins cleanly — and re-pinning is exactly what a forger
// does, so EXPECTED_HASH cannot see it. The counts have to be asserted from somewhere
// the dataset does not control, and a step that finds them wrong must HARD FAIL.
export const EXPECTED_BETS  = 5100;
export const EXPECTED_SEEDS = 106;
export const EXPECTED_PHASE_BETS: Readonly<Record<string, number>> =
  Object.freeze({ A: 3000, B: 1000, C: 1000, D: 100 });

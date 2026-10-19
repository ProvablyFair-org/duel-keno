import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { KenoDataset, KenoBet, SeedEntry } from './types';

const DATASET_PATH = path.join(__dirname, '../data/keno-master-5100bets.json');
const EXPECTED_HASH = '841755fdfb268d7796017212f08a18bfea7615c30a4590dd29793b34c5e6bcf9';

// The multiplier table is the second input the whole payout proof is conditioned on. It is
// pinned exactly like the dataset: a run against an altered kenoConfig.json aborts at start-up.
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
 *
 * Exception: seeds[0].seed.serverSeed is not a captured value. The capture rig wrote null there
 * (capture/capture-auto.reference.js fills serverSeed only from the previous epoch's last
 * transaction, and the first rotation has none). The as-captured file (SHA-256 563464f3…541d,
 * pre-publication commit 34e59d02b9cebece5c8d149b47c6cbde74425ce9, 11 Apr 2026) holds null.
 * Pre-publication commit 8efb2167e9eb2f3cd4dc7a012f66e997e761d6c4 (17 Apr 2026) set it to
 * seeds[1]'s reveal (revealedFrom tx 518502617) as a one-line dataset edit (no script in that
 * commit) and re-pinned the dataset hash to the current 841755fd…bcf9. Both commits are
 * pre-publication history: neither is reachable from the published duel-keno repository (main
 * and v1.0.0 start at 4fc06ec), so `git show` on them needs the auditor's pre-publication copy of
 * that history, not a clone of the release. Nothing reads the field: this map and Step 1 both
 * start from seeds[1].
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

/**
 * Group bets by the CAPTURE TIMELINE, not by their own hash.
 *
 * A bet belongs to the last rotation record whose `at` precedes (or equals) the bet's `at`.
 * This source never reads the bet's serverSeedHashed, so a step that then asserts "every bet in
 * window i carries record i's committed hash" can actually fail. Grouping BY the hash and then
 * asserting one hash per group — the old Step 3 — is true of any input whatsoever.
 * Bets captured before the first rotation record are returned as orphans.
 */
export interface EpochWindow { index: number; record: SeedEntry; bets: KenoBet[] }
export function groupByEpochWindow(
  bets: KenoBet[],
  seeds: SeedEntry[],
): { epochs: EpochWindow[]; orphans: KenoBet[] } {
  const epochs: EpochWindow[] = seeds.map((record, index) => ({ index, record, bets: [] }));
  const orphans: KenoBet[] = [];
  for (const b of bets) {
    // ISO-8601 UTC timestamps compare correctly as strings; a linear scan keeps it obvious.
    let idx = -1;
    for (let j = 0; j < seeds.length; j++) {
      if (seeds[j].at <= b.at) idx = j; else break;
    }
    if (idx < 0) { orphans.push(b); continue; }
    epochs[idx].bets.push(b);
  }
  return { epochs, orphans };
}

/**
 * Count hits from the SERVED drawn_numbers. Kept for the informational live-sample context only;
 * every scored payout step counts hits with countHitsIn() against the RECOMPUTED draw (KENO-10).
 */
export function countHits(bet: KenoBet): number {
  const drawn = new Set(bet.response.drawn_numbers);
  return bet.request.selected_positions.filter(p => drawn.has(p)).length;
}

/** hits = |picks ∩ drawn|, for any drawn set — the scored steps pass the recomputed draw. */
export function countHitsIn(picks: number[], drawn: number[]): number {
  const d = new Set(drawn);
  return picks.filter(p => d.has(p)).length;
}

// ── POPULATION OF RECORD ─────────────────────────────────────────────────────────
// The capture plan, stated as CODE, beside the dataset pin above.
//
// A dataset that agrees with its own header proves nothing: delete rounds, shrink the
// header to match, and the file is internally consistent and re-pins cleanly — and
// re-pinning is what a forger does, so EXPECTED_HASH cannot see it either. The counts
// have to be asserted from somewhere the dataset does not control, and a step that finds
// them wrong must FAIL rather than report.
//
// Reconciling meta/header figures AGAINST these constants is a good check. Reading the
// header AS the constants is the defect these replace.
export const EXPECTED_BETS   = 5100;
export const EXPECTED_SEEDS  = 106;
export const EXPECTED_EPOCHS = 102;
export const EPOCH_SIZE      = 50;

// The nonce every epoch starts at, DECLARED — not the minimum observed. Duel's client-seed rotation
// resets the nonce to 0 (rotation records carry nonce 0 on all 106 entries). Step 4 asserts each
// epoch runs NONCE_BASE … NONCE_BASE + EPOCH_SIZE − 1 against this constant.
export const NONCE_BASE      = 0;

export const EXPECTED_PHASE_BETS: Readonly<Record<string, number>> =
  Object.freeze({ A: 3000, B: 1000, C: 1000, D: 100 });
export const EXPECTED_PHASE_SEEDS: Readonly<Record<string, number>> =
  Object.freeze({ A: 61, B: 21, C: 21, D: 3 });

// Every epoch that carries bets has its plaintext revealed by the following rotation, so
// 100% of captured bets are recomputable. Binding the commitment steps to this number is
// what stops "0 mismatches" passing on an empty or truncated seed list.
export const EXPECTED_REVEALED_EPOCHS = 102;

// Phase-start rotations (the first record of Phases B, C and D) whose plaintext does not reveal the
// preceding entry's commitment: the rig rotated at the end of the phase and again at the start of
// the next, and both rotations read the same last transaction, so the phase-start record repeats
// the plaintext of the record before it and the bet-less end-of-phase epoch's seed is never
// revealed. They are a property of the capture plan — one per phase change — not a licence to
// skip an arbitrary number of seeds.
export const EXPECTED_PHASE_BOUNDARY_SKIPS = 3;

// Forward commitment links: seeds[i].nextServerSeedHash === seeds[i+1].serverSeedHashed.
export const EXPECTED_CHAIN_LINKS = EXPECTED_SEEDS - 1;

// The smallest number of live bets any one of the 40 (risk × picks) configurations must
// carry before this audit will claim to have exercised it.
export const MIN_BETS_PER_CONFIG = 50;

/**
 * PROVENANCE (header added on integration, 20 Oct 2026; everything below this comment is the
 * clean-room module byte for byte).
 *
 * This module was REBUILT FROM A WRITTEN SPECIFICATION, not ported from Duel's code:
 *   spec      docs/ALGORITHM.md, a copy of games/keno/ALGORITHM.md in the ProvablyFair.org audit
 *             framework (SHA-256 f0f70652…df235d35). Written from Duel's public pages, the
 *             Verify-page result grids, the standard provably-fair construction and the 5,100 live
 *             bets, without opening Duel's code (its §8 lists every file read).
 *   rebuild   written by an implementer who read ONLY that spec and a module-interface file, and
 *             never opened Duel's code, its Verify-tab file, or this package's earlier src/rng.ts.
 *   self-test tests/keno/RngSpecTests.ts (the spec's §5 vectors, §2.1 Verify-page grids, properties).
 *
 * Duel's published Verify-tab code (evidence/verify-tab/duel-verify-tab-keno-2026-09-25.js, E13) is
 * NOT the source of this module. It is run byte for byte as a SECOND CHECK, by Step 23 and the unit
 * tests (src/operator-verifier.ts), next to the ProvablyFair.org docs-site and live-site verifiers.
 *
 * Three-way agreement measured on integration (20 Oct 2026, the 5,100-bet capture): this module vs
 * the live bets, commitment 5,100/5,100 and drawn set 5,100/5,100 (the served list's order is not
 * the shuffle order: 0/5,100 in order, spec §2.3 / O1); vs Duel's Verify-tab code 5,100/5,100 as a
 * set and 5,100/5,100 in order; vs the provablyfair.org live verifier 5,100/5,100 as a set and in
 * order. Steps 1, 5 and 23 of `npm run verify` re-measure them on every run.
 *
 * Known divergences from Duel's Verify-tab code, off the captured data (MANIFEST.md, "Where the draw
 * code comes from"): (1) for the power-of-two ranges 2, 4, 8, 16, 32 Duel's ceiling is 2^32 - r and
 * this module's (spec §2 Step 2) is 2^32, so a first chunk in the top r values is rejected by Duel
 * and accepted here; (2) when all eight chunks of a step are rejected Duel hashes the next cursor and
 * this module throws (spec O2, unspecified). Neither occurred in the 198,900 captured shuffle steps.
 */
// Duel.com Keno draw, rebuilt from ALGORITHM.md alone (clean room).
// Exports exactly the names fixed by INTERFACE.md. Node `crypto` only.

import { createHash, createHmac } from "crypto";

/** Board size: numbers 1..40 (ALGORITHM.md §1.1, `picks` row; §2 Step 2). */
export const GRID_SIZE = 40;

/** How many numbers a round draws: the first 10 of the shuffled array (§2 Step 2). */
export const DRAWN_COUNT = 10;

const TWO_POW_32 = 0x1_0000_0000; // 2^32, exact in a double
const CHUNK_BYTES = 4; // §2 Step 2: 4-byte chunks
const DIGEST_BYTES = 32; // §2 Step 1: HMAC-SHA256 gives 32 bytes

/**
 * Exclusive upper end of the accepted 32-bit window for one draw over `range`
 * outcomes: LIMIT = floor(2^32 / r) * r (§2 Step 2). A chunk value v is kept
 * only when v < LIMIT, so `v mod r` is exactly uniform.
 */
export function maxFairFor(range: number): number {
  if (!Number.isSafeInteger(range) || range < 1 || range > TWO_POW_32) {
    throw new RangeError(`maxFairFor: range must be an integer in 1..2^32, got ${range}`);
  }
  return Math.floor(TWO_POW_32 / range) * range;
}

/** Optional counter; passing one changes nothing computed. */
export interface DrawCensus {
  hmacCalls: number; // HMAC digests computed
  chunksScanned: number; // 4-byte chunks examined
  chunksRejected: number; // chunks rejected by the acceptance rule
  cursorAdvances: number; // times a step needed a further digest beyond its first (always 0 here: the spec never does this)
}

function assertNonce(nonce: number): void {
  // §1.1: nonce is a non-negative integer; §2 Step 1 prints it in plain base 10.
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new RangeError(`nonce must be a non-negative safe integer, got ${nonce}`);
  }
}

/**
 * The drawn numbers (values 1..gridSize), in the order the shuffle leaves them
 * in a[0..drawnCount-1], from the already hex-decoded server-seed bytes.
 *
 * gridSize / drawnCount default to 40 / 10 (the only values the spec covers);
 * other values run the same construction on 1..gridSize.
 */
export function computeDrawFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  gridSize: number = GRID_SIZE,
  drawnCount: number = DRAWN_COUNT,
  census?: DrawCensus,
): number[] {
  assertNonce(nonce);
  if (!Number.isSafeInteger(gridSize) || gridSize < 1) {
    throw new RangeError(`gridSize must be a positive integer, got ${gridSize}`);
  }
  if (!Number.isSafeInteger(drawnCount) || drawnCount < 0 || drawnCount > gridSize) {
    throw new RangeError(`drawnCount must be an integer in 0..gridSize, got ${drawnCount}`);
  }

  // §2 Step 2: a = [1, 2, ..., gridSize], 0-indexed.
  const a: number[] = [];
  for (let n = 1; n <= gridSize; n++) a.push(n);

  // §2 Steps 1+2: steps s = 0 .. gridSize-2; step s fixes index i = (gridSize-1) - s.
  for (let s = 0; s <= gridSize - 2; s++) {
    const i = gridSize - 1 - s;
    const r = i + 1; // range size for this step
    const limit = maxFairFor(r);

    // §2 Step 1: one HMAC-SHA256 per step, key = raw seed bytes,
    // message = UTF-8 of "clientSeed:nonce:s" (decimal, no padding). UTF-8 per §2 Step 1 / O6.
    const message = `${clientSeed}:${nonce}:${s}`;
    const digest = createHmac("sha256", keyBuffer).update(message, "utf8").digest();
    if (census) census.hmacCalls++;

    // §2 Step 2: walk the digest in 4-byte big-endian chunks, accept the first below LIMIT.
    let accepted: number | undefined;
    for (let offset = 0; offset + CHUNK_BYTES <= DIGEST_BYTES; offset += CHUNK_BYTES) {
      const v = digest.readUInt32BE(offset);
      if (census) census.chunksScanned++;
      if (v < limit) {
        accepted = v;
        break;
      }
      if (census) census.chunksRejected++;
    }
    if (accepted === undefined) {
      // Open point O2: the spec does not say what follows when all 8 chunks are
      // rejected (probability < 1e-60 per step). Refuse rather than invent a rule.
      throw new Error(
        `computeDrawFromBuffer: all ${DIGEST_BYTES / CHUNK_BYTES} chunks rejected at step ${s} (ALGORITHM.md O2, unspecified)`,
      );
    }

    // §2 Step 2: j = v mod r, then swap a[i] and a[j].
    const j = accepted % r;
    const tmp = a[i] as number;
    a[i] = a[j] as number;
    a[j] = tmp;
  }

  // §2 Step 2: drawn = the first drawnCount entries of the shuffled array.
  return a.slice(0, drawnCount);
}

/** §1.2 seed form: 64 hex characters encoding 32 bytes. */
function decodeServerSeed(serverSeed: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(serverSeed)) {
    throw new TypeError("serverSeed must be 64 hexadecimal characters (ALGORITHM.md §1.1)");
  }
  return Buffer.from(serverSeed, "hex");
}

/** Same as computeDrawFromBuffer, taking the server seed as the casino publishes it (64 hex, §1.1). */
export function computeDraw(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  gridSize: number = GRID_SIZE,
  drawnCount: number = DRAWN_COUNT,
): number[] {
  // §2 Step 1: key = hex_decode(serverSeed), the 32 raw bytes, not the ASCII text.
  return computeDrawFromBuffer(decodeServerSeed(serverSeed), clientSeed, nonce, gridSize, drawnCount);
}

/**
 * §1.2: the commitment is lowercase hex of SHA-256 over the 32 hex-decoded seed
 * bytes. True when it equals `serverSeedHashed` (compared case-insensitively);
 * false for a malformed seed or hash.
 */
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(serverSeed)) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(serverSeedHashed)) return false;
  const commitment = createHash("sha256").update(Buffer.from(serverSeed, "hex")).digest("hex");
  return commitment === serverSeedHashed.toLowerCase();
}

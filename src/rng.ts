import * as crypto from 'crypto';

/**
 * Keno RNG — Duel.com provably fair algorithm.
 *
 * PORTED FROM THE OPERATOR'S OWN SOURCE: the Keno code panel of duel.com → Provably Fair → Verify
 * (Expand → Copy), copied verbatim by Paulo on 2026-09-25 to
 * evidence/verify-tab/duel-verify-tab-keno-2026-09-25.js (SHA-256 b75c1ca2…4930b, pinned in
 * src/operator-verifier.ts). "Lxx" is a line of that file. Every citation is listed in
 * OPERATOR_SOURCE_CITES and checked against the pinned bytes by Step 23 and the unit tests — a cited
 * line that does not carry the quoted text FAILs. Step 23 also EXECUTES that file on every captured
 * bet and requires its draw to equal this module's, in order, and the served set.
 *
 * Algorithm: backward Fisher-Yates shuffle with per-step rejection sampling.
 *   positions = [0, 1, ..., gridSize-1]                                           L52
 *   for i from gridSize-1 downto 1:                                               L55
 *     cursor = gridSize - 1 - i                                                   L58
 *     range  = i + 1                                                              L56
 *     maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range)   ← bias-free ceiling           L51, L57
 *     loop:
 *       hash = HMAC-SHA256(key=hex_bytes(serverSeed), msg=clientSeed:nonce:cursor)   L32, L38, L64
 *       scan 4-byte chunks of hash:                                               L68, L69
 *         if chunk < maxFair → j = chunk % range; swap positions[i] ↔ positions[j]; break   L70–L72
 *       else cursor++ and retry                                                   L79
 *   drawn = positions[0..drawnCount-1] + 1   (1-indexed, shuffled order)          L85
 *   grid 40, 10 drawn                                                             L9, L10
 *
 * Key encoding: Buffer.from(serverSeed, 'hex') — hex-decoded bytes, NOT UTF-8 string.
 * Message format: `${clientSeed}:${nonce}:${cursor}` — colon-separated, no spaces.
 * Output: drawn number SET is deterministic; display order in API response is presentation-only.
 */

// ── Operator source citations (checked, not decorative) ────────────────────
/**
 * Each entry: a line of evidence/verify-tab/duel-verify-tab-keno-2026-09-25.js and text that line
 * must contain verbatim. src/operator-verifier.ts checkOperatorCites reads the pinned file and FAILs
 * any entry whose line does not carry its text.
 */
export const OPERATOR_SOURCE_CITES: ReadonlyArray<{ line: number; text: string; ports: string }> = Object.freeze([
  { line: 9, text: 'const drawnCount = 10;', ports: 'DRAWN_COUNT' },
  { line: 10, text: 'const gridSize = 40;', ports: 'GRID_SIZE' },
  { line: 32, text: 'const keyBytes = hexToBytes(keyHex);', ports: 'the server seed is hex-decoded to the HMAC key' },
  { line: 38, text: "{ name: 'HMAC', hash: 'SHA-256' },", ports: 'HMAC-SHA256' },
  { line: 51, text: 'const MAX_UINT32 = 0xFFFFFFFF;', ports: 'MAX_UINT32' },
  { line: 52, text: 'const positions = Array.from({ length: gridSize }, (_, i) => i);', ports: 'positions = [0 … gridSize − 1]' },
  { line: 55, text: 'for (let i = gridSize - 1; i > 0; i--) {', ports: 'backward Fisher-Yates, i = 39 … 1' },
  { line: 56, text: 'const range = i + 1;', ports: 'range = i + 1' },
  { line: 57, text: 'const maxFair = MAX_UINT32 - (MAX_UINT32 % range);', ports: 'maxFairFor' },
  { line: 58, text: 'let cursor = gridSize - 1 - i;', ports: 'cursor starts at gridSize − 1 − i for every i' },
  { line: 64, text: 'new TextEncoder().encode(`${clientSeed}:${nonce}:${cursor}`)', ports: 'the HMAC message' },
  { line: 68, text: 'for (let off = 0; off + 8 <= hash.length; off += 8) {', ports: 'eight 4-byte chunks, first to last' },
  { line: 69, text: 'const value = parseInt(hash.slice(off, off + 8), 16);', ports: 'chunk read as a big-endian uint32 (8 hex chars)' },
  { line: 70, text: 'if (value < maxFair) {', ports: 'accept below maxFair' },
  { line: 71, text: 'const j = value % range;', ports: 'j = value mod range' },
  { line: 72, text: '[positions[i], positions[j]] = [positions[j], positions[i]];', ports: 'the swap' },
  { line: 79, text: 'cursor++; // otherwise try a new cursor', ports: 'all 8 chunks rejected → next cursor' },
  { line: 85, text: 'return positions.slice(0, drawnCount).map(pos => pos + 1);', ports: 'first 10, 1-indexed, shuffled order' },
]);

export const GRID_SIZE   = 40;   // operator L10
export const DRAWN_COUNT = 10;   // operator L9
const MAX_UINT32  = 0xFFFFFFFF;

/**
 * The rejection ceiling the draw uses for one shuffle step of width `range`: a 32-bit chunk is
 * accepted iff chunk < maxFairFor(range). Exported so Step 22 (KENO-08) enumerates the bias bound
 * from the SAME expression the draw executes, not from a copy of it.
 */
export function maxFairFor(range: number): number {
  return MAX_UINT32 - (MAX_UINT32 % range);   // operator L57
}

/** Optional tally of what the draw actually did (Step 22 rejection census). */
export interface DrawCensus { hmacCalls: number; chunksScanned: number; chunksRejected: number; cursorAdvances: number }

export function computeDrawFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  gridSize  = GRID_SIZE,
  drawnCount = DRAWN_COUNT,
  census?: DrawCensus,
): number[] {
  const positions: number[] = Array.from({ length: gridSize }, (_, i) => i);   // operator L52

  for (let i = gridSize - 1; i > 0; i--) {   // operator L55
    const range   = i + 1;                   // operator L56
    const maxFair = maxFairFor(range);       // operator L57
    let cursor    = gridSize - 1 - i;        // operator L58

    while (true) {
      const message = `${clientSeed}:${nonce}:${cursor}`;   // operator L64
      const hmac    = crypto.createHmac('sha256', keyBuffer).update(message).digest('hex');   // operator L31–L45
      let found     = false;
      if (census) census.hmacCalls++;

      for (let off = 0; off + 8 <= hmac.length; off += 8) {           // operator L68
        const value = parseInt(hmac.substring(off, off + 8), 16);   // operator L69
        if (census) census.chunksScanned++;
        if (value < maxFair) {                                           // operator L70
          const j = value % range;                                       // operator L71
          [positions[i], positions[j]] = [positions[j], positions[i]];   // operator L72
          found = true;
          break;
        }
        if (census) census.chunksRejected++;
      }

      if (found) break;
      if (census) census.cursorAdvances++;
      cursor++;   // operator L79
    }
  }

  return positions.slice(0, drawnCount).map(p => p + 1);   // operator L85 (shuffled order)
}

export function computeDraw(
  serverSeed: string,
  clientSeed: string,
  nonce:      number,
  gridSize  = GRID_SIZE,
  drawnCount = DRAWN_COUNT,
): number[] {
  const key = Buffer.from(serverSeed, 'hex');
  return computeDrawFromBuffer(key, clientSeed, nonce, gridSize, drawnCount);
}

/** SHA-256 commit-reveal: verify that SHA-256(hex_bytes(serverSeed)) === serverSeedHashed */
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  const seedBytes = Buffer.from(serverSeed, 'hex');
  const computed  = crypto.createHash('sha256').update(seedBytes).digest('hex');
  return computed === serverSeedHashed;
}

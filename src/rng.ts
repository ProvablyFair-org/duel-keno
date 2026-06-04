import * as crypto from 'crypto';

/**
 * Keno RNG — Duel.com provably fair algorithm.
 *
 * Source: duel.com/fairness/verify (game selector → Keno)
 *
 * Algorithm: backward Fisher-Yates shuffle with per-step rejection sampling.
 *   positions = [0, 1, ..., gridSize-1]
 *   for i from gridSize-1 downto 1:
 *     cursor = gridSize - 1 - i
 *     range  = i + 1
 *     maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range)   ← bias-free ceiling
 *     loop:
 *       hash = HMAC-SHA256(key=hex_bytes(serverSeed), msg=clientSeed:nonce:cursor)
 *       scan 4-byte chunks of hash:
 *         if chunk < maxFair → j = chunk % range; swap positions[i] ↔ positions[j]; break
 *       else cursor++ and retry
 *   drawn = positions[0..drawnCount-1] + 1   (1-indexed)
 *
 * Key encoding: Buffer.from(serverSeed, 'hex') — hex-decoded bytes, NOT UTF-8 string.
 * Message format: `${clientSeed}:${nonce}:${cursor}` — colon-separated, no spaces.
 * Output: drawn number SET is deterministic; display order in API response is presentation-only.
 */

const GRID_SIZE   = 40;
const DRAWN_COUNT = 10;
const MAX_UINT32  = 0xFFFFFFFF;

export function computeDrawFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  gridSize  = GRID_SIZE,
  drawnCount = DRAWN_COUNT,
): number[] {
  const positions: number[] = Array.from({ length: gridSize }, (_, i) => i);

  for (let i = gridSize - 1; i > 0; i--) {
    const range   = i + 1;
    const maxFair = MAX_UINT32 - (MAX_UINT32 % range);
    let cursor    = gridSize - 1 - i;

    while (true) {
      const message = `${clientSeed}:${nonce}:${cursor}`;
      const hmac    = crypto.createHmac('sha256', keyBuffer).update(message).digest('hex');
      let found     = false;

      for (let off = 0; off + 8 <= hmac.length; off += 8) {
        const value = parseInt(hmac.substring(off, off + 8), 16);
        if (value < maxFair) {
          const j = value % range;
          [positions[i], positions[j]] = [positions[j], positions[i]];
          found = true;
          break;
        }
      }

      if (found) break;
      cursor++;
    }
  }

  return positions.slice(0, drawnCount).map(p => p + 1);
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

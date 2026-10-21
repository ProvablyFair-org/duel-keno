# Module interface the audit package expects (written by the auditor, not from the casino)

Write `rng.ts` (TypeScript, strict, Node `crypto` only, no dependencies) exporting exactly these names.
Semantics come from ALGORITHM.md; this file only fixes names, types and the package's own conventions.
Board numbers are 1..GRID_SIZE.

```ts
export const GRID_SIZE: number;     // 40
export const DRAWN_COUNT: number;   // 10
// Exclusive upper end of the accepted 32-bit window for one draw over `range` outcomes.
export function maxFairFor(range: number): number;

// Optional counter; passing one changes nothing computed.
export interface DrawCensus {
  hmacCalls: number;       // HMAC digests computed
  chunksScanned: number;   // 4-byte chunks examined
  chunksRejected: number;  // chunks rejected by the acceptance rule
  cursorAdvances: number;  // times a step needed a further digest beyond its first (0 if the spec never does this)
}

// The drawn numbers (DRAWN_COUNT of them, values 1..gridSize) in the order the spec's shuffle yields them,
// from the HMAC key bytes already decoded from the server seed.
export function computeDrawFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number, gridSize?: number, drawnCount?: number, census?: DrawCensus): number[];
// Same, taking the server seed as the casino publishes it.
export function computeDraw(serverSeed: string, clientSeed: string, nonce: number, gridSize?: number, drawnCount?: number): number[];
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean;
```
Paytable lookup and payout are NOT part of this module (the package has its own); implement only the above.

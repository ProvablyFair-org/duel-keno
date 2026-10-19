/**
 * PLAYER-VERIFIER PARITY (profile KENO-24) — the ProvablyFair.org docs-site verifier.
 *
 * The docs site ships a player-facing verifier for Duel Keno: the VerifyBets component, whose Keno
 * derivation is `src/components/VerifyBets/games/keno/derive.js`. It imports
 * `../../lib/hmac-sha256.js` (the pure-JS HMAC) and `./paytables.js` (the multiplier table it
 * shows a player). A player who pastes a round into that page is trusting THAT code, not this
 * package's src/rng.ts. Until 2026-09-25 the two were related only by a comment in derive.js
 * ("Source of truth (audit repo): … src/rng.ts").
 *
 * WHAT THIS FILE DOES (ported from Duel Mines src/site-verifier.ts, 2026-09-24).
 *   1. PINS the SHA-256 of all three site files (SITE_VERIFIER_PINS).
 *   2. Holds a VENDORED copy of those exact bytes under verifier-parity/, laid out as on the site so
 *      the relative imports name the same files. The vendored bytes must hash to the pins or the
 *      parity step (Step 23) FAILs before anything runs.
 *   3. EXECUTES the vendored derive.js — not a re-typing of it — on every captured bet. Step 23
 *      requires its drawn set to equal the one src/rng.ts recomputes on every bet, and records,
 *      bet by bet, whether the multiplier it prints equals the one the casino served.
 *   scripts/check-site-verifier.mjs compares a checkout of the site with the pins (exit 1 on any
 *   difference), so a site edit that was never re-vendored is caught at release time.
 *
 * HOW THE VENDORED ES MODULES ARE RUN. The suite is synchronous CommonJS and derive.js is an ES
 * module with extensionless relative imports. So the bytes are evaluated with node:vm, each file
 * wrapped in its own function scope, after exactly two textual rewrites applied to the in-memory
 * copy only, never to the hashed file: the import lines (which must equal IMPORT_LINES byte for
 * byte — any other import set FAILs, because it would be code this check does not vendor) are
 * replaced by bindings to the vendored modules, and `export ` is dropped from each top-level
 * declaration. No other character is touched.
 *
 * PROVENANCE OF THE PINNED BYTES (read 2026-09-25, read-only, via `git cat-file -p origin/main:<path>` —
 * the local checkout was not switched or modified):
 *   repository  qa-workspace/duel/docusaurus (mikepforg/pf-audit-duel), origin/main
 *               @ bd4d59cd9a3e75146f2575c5218a3fb9a8b2692d (2026-09-19). The keno paytables.js on main
 *               was last changed in 4aaa1b2 (2026-06-07). The local checkout sits on branch
 *               repotree-sync @ 2ad89bc (NOT an ancestor of main), whose keno paytables.js is an older
 *               table: it differs from kenoConfig.json on 106 of 260 cells and prints a multiplier other
 *               than the one Duel paid on 1,472 of the 5,100 captured bets (measured 2026-09-25 by this
 *               step against the repotree-sync bytes, since superseded here — MANIFEST PV-1).
 *   The LIVE page (www.provablyfair.org/verify-bets) is a separate Next.js build: see
 *   src/live-site-verifier.ts.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

export const SITE_VERIFIER_DIR = path.join(__dirname, '../verifier-parity');

/** Site-relative path → SHA-256 of the exact bytes. The vendored copies live at the same relative paths. */
export const SITE_VERIFIER_PINS: Readonly<Record<string, string>> = Object.freeze({
  'games/keno/derive.js':    'eb5a0c1c0162d885574f87416268d052a9d072450009527ecfb382d853da9749',
  'games/keno/paytables.js': '5bce2fd2e6551d7c1f8a8124d6bcf9b842aef656a9fe3cde022ef397c27838f5',
  'lib/hmac-sha256.js':      'bc30bfe9ef202905ece93de33440d41851abf16e910f90c2a567774a2b79d889',
});

export const SITE_VERIFIER_PROVENANCE = Object.freeze({
  siteRoot: 'qa-workspace/duel/docusaurus/src/components/VerifyBets',
  repository: 'mikepforg/pf-audit-duel',
  ref: 'origin/main',
  head: 'bd4d59cd9a3e75146f2575c5218a3fb9a8b2692d',
  headDate: '2026-09-19',
  readVia: 'git cat-file -p origin/main:<path>',
  readOn: '2026-09-25',
});

/** The only import lines derive.js may carry. Anything else is code this check does not vendor. */
export const IMPORT_LINES: readonly string[] = Object.freeze([
  "import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';",
  "import { paytable, GRID_SIZE, DRAWN_COUNT } from './paytables';",
]);

export interface SiteKenoResult { drawnNumbers: number[]; hitCount: number; multiplier: number | null }
export type SiteDeriveKeno = (p: { clientSeed: string; serverSeed: string; nonce: number; picks: number[]; risk: string }) => SiteKenoResult;

export interface SiteVerifierLoad {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  deriveKeno: SiteDeriveKeno | null;
  /** The site's PAYOUT_TABLES, for the cell-by-cell comparison with the pinned kenoConfig.json. */
  payoutTables: Record<string, Record<string, number[]>> | null;
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
const stripExports = (src: string): string => src.replace(/^export (function|const|let|class) /gm, '$1 ');

/**
 * Hash the vendored files against the pins and, only if every one matches, evaluate them.
 * Never throws: a failure is returned as `error` so Step 23 reports it as a FAIL.
 */
export function loadSiteVerifier(dir = SITE_VERIFIER_DIR): SiteVerifierLoad {
  const files = Object.entries(SITE_VERIFIER_PINS).map(([file, pinned]) => {
    const p = path.join(dir, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  const none = { deriveKeno: null, payoutTables: null };
  if (!hashesMatch) return { files, hashesMatch, ...none, error: 'vendored site verifier does not match its pinned SHA-256' };
  try {
    // runInThisContext, not a new context: the pure-JS SHA-256 runs ~30x slower in a fresh context
    // (measured on Duel Mines, 2026-09-24), which would force a sample instead of every bet.
    const libSrc = fs.readFileSync(path.join(dir, 'lib/hmac-sha256.js'), 'utf8');
    const lib = (vm.runInThisContext(
      `(function () {\n${stripExports(libSrc)}\n;return { hmacSha256Hex, hexToBytes };\n})`,
      { filename: 'verifier-parity/lib/hmac-sha256.js' },
    ) as () => { hmacSha256Hex: unknown; hexToBytes: unknown })();

    const ptSrc = fs.readFileSync(path.join(dir, 'games/keno/paytables.js'), 'utf8');
    if (ptSrc.split('\n').some(l => /^\s*import\b/.test(l))) {
      return { files, hashesMatch, ...none, error: 'paytables.js carries an import this check does not vendor' };
    }
    const pt = (vm.runInThisContext(
      `(function () {\n${stripExports(ptSrc)}\n;return { paytable, GRID_SIZE, DRAWN_COUNT, PAYOUT_TABLES };\n})`,
      { filename: 'verifier-parity/games/keno/paytables.js' },
    ) as () => { paytable: unknown; GRID_SIZE: number; DRAWN_COUNT: number; PAYOUT_TABLES: Record<string, Record<string, number[]>> })();

    const deriveSrc = fs.readFileSync(path.join(dir, 'games/keno/derive.js'), 'utf8');
    const importLines = deriveSrc.split('\n').filter(l => /^\s*import\b/.test(l));
    if (importLines.length !== IMPORT_LINES.length || importLines.some((l, i) => l !== IMPORT_LINES[i])) {
      return { files, hashesMatch, ...none,
        error: `derive.js imports ${JSON.stringify(importLines)}; the vendored imports are ${JSON.stringify(IMPORT_LINES)}` };
    }
    let body = deriveSrc;
    for (const l of IMPORT_LINES) body = body.replace(l, '');
    const mod = (vm.runInThisContext(
      `(function (hmacSha256Hex, hexToBytes, paytable, GRID_SIZE, DRAWN_COUNT) {\n${stripExports(body)}\n;return { deriveKeno };\n})`,
      { filename: 'verifier-parity/games/keno/derive.js' },
    ) as (...a: unknown[]) => { deriveKeno: SiteDeriveKeno })(lib.hmacSha256Hex, lib.hexToBytes, pt.paytable, pt.GRID_SIZE, pt.DRAWN_COUNT);
    if (typeof mod.deriveKeno !== 'function') return { files, hashesMatch, ...none, error: 'derive.js does not define deriveKeno' };
    return { files, hashesMatch, deriveKeno: mod.deriveKeno, payoutTables: pt.PAYOUT_TABLES, error: null };
  } catch (e) {
    return { files, hashesMatch, ...none, error: `vendored site verifier failed to evaluate: ${(e as Error).message}` };
  }
}

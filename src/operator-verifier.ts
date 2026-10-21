/**
 * THE OPERATOR'S OWN VERIFIER CODE (profile KENO-09; Step 23, third leg).
 *
 * Duel.com's Provably Fair → Verify page, with Keno selected, shows a JavaScript code panel behind an
 * "Expand" control (evidence E03 shows the page with the panel collapsed). That code is the operator's
 * published algorithm for Keno.
 *
 * ROLE (since 20 Oct 2026, v1.2.0). This file is a SECOND CHECK, not the source of src/rng.ts. src/rng.ts is
 * rebuilt from the written specification docs/ALGORITHM.md by an implementer who never opened Duel's code;
 * Duel's file is run here, byte for byte, to show that it agrees with that rebuild and with the served
 * draws. Through v1.1.0 src/rng.ts was a port of this file and, from 25 Sep 2026, cited 18 of its lines;
 * the port and that citation table were removed on 20 Oct 2026.
 *
 * PROVENANCE. Copied by Paulo from duel.com → Provably Fair → Verify (Keno) → Expand → Copy on
 * 2026-09-25, and saved verbatim as evidence/verify-tab/duel-verify-tab-keno-2026-09-25.js
 * (3,138 bytes, 95 lines, file mtime 2026-09-25T13:36:08-03:00). The file is never edited. What this
 * does NOT establish: that the Verify button on the live page runs exactly the code its panel
 * displays, or that Duel's server runs it — the panel is what the operator publishes as its
 * algorithm, and that is what is pinned and executed here.
 *
 * WHAT THIS FILE DOES.
 *   1. PINS the SHA-256 of that file and of the runner that executes it (OPERATOR_VERIFIER_PINS).
 *      A file that does not hash to its pin FAILs Step 23 before anything runs.
 *   2. EXECUTES the file — not a re-typing of it — in a child Node process
 *      (verifier-parity/operator/run-operator-verifier.cjs; its header lists the whole harness
 *      surface: a function wrapper that hands the file Node's WebCrypto, TextEncoder and a console
 *      recorder, and the call to the file's own generateKenoDrawnNumbers). Not one character of the
 *      file is rewritten, even in memory. The child process is used because the file awaits
 *      WebCrypto and the suite is synchronous; spawnSync keeps it synchronous with no install.
 *      The file returns the drawn numbers 1-indexed in SHUFFLED order ("Keep in shuffled order (not
 *      sorted)", L84) — the same order src/rng.ts computeDraw returns (spec §2 Step 2, a[0..9]), so the
 *      two are compared in order; the served drawn_numbers are compared as a set (their order is not the
 *      shuffle order, spec §2.3 / O1).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

export const PACKAGE_ROOT = path.join(__dirname, '..');
export const OPERATOR_VERIFIER_FILE = 'evidence/verify-tab/duel-verify-tab-keno-2026-09-25.js';
export const OPERATOR_VERIFIER_RUNNER = 'verifier-parity/operator/run-operator-verifier.cjs';

/** Package-relative path → SHA-256 of the exact bytes. */
export const OPERATOR_VERIFIER_PINS: Readonly<Record<string, string>> = Object.freeze({
  'evidence/verify-tab/duel-verify-tab-keno-2026-09-25.js': 'b75c1ca2667dceef790b574decff8a91506b0bce829b0af47fb1cb22e254930b',
  'verifier-parity/operator/run-operator-verifier.cjs':     '11d84eda568dde7d5db4063af7c0257f0bbfc394ac1c0c05d82a038c571948c4',
});

export const OPERATOR_VERIFIER_PROVENANCE = Object.freeze({
  copiedBy: 'Paulo',
  copiedOn: '2026-09-25',
  from: 'duel.com → Provably Fair → Verify, game Keno, Expand → Copy on the code panel (evidence E03 shows the page, panel collapsed)',
  savedAs: OPERATOR_VERIFIER_FILE,
  sha256: 'b75c1ca2667dceef790b574decff8a91506b0bce829b0af47fb1cb22e254930b',
  bytes: 3138,
  lines: 95,
});

/** The only thing the file prints when it runs as shipped (its inputs are empty strings). */
export const OPERATOR_EXPECTED_LOGS: readonly string[] = Object.freeze([
  'Please provide valid serverSeed, clientSeed, nonce (>=0), gridSize (>1), and drawnCount (>0 and < gridSize).',
]);

export interface OperatorRound { id: string; serverSeed: string; clientSeed: string; nonce: number; gridSize: number; drawnCount: number }
export interface OperatorRun {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  /** id → the drawn numbers (1-indexed, shuffled order) the operator's code returned, or null if it threw. */
  drawn: Map<string, number[] | null> | null;
  logs: string[];
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');


/**
 * HOW THE PINNED RUNNER IS STARTED (since 2026-09-25). Its stdin and stdout are temp FILES, not pipes, and
 * the run has a hard timeout. On 2026-09-25 a pipe-based run inside the Duel Blackjack mutation battery sat
 * for ~1 h 54 min with the runner idle at 0 % CPU and its pipe descriptors open, until it was killed by hand.
 * A file cannot fill, so the child never blocks on output nobody is reading; and a runner that does not exit
 * within OPERATOR_RUNNER_TIMEOUT_MS is SIGKILLed and reported as a failed run — the calling step FAILs, it
 * never waits. The runner itself (pinned) is unchanged.
 */
export const OPERATOR_RUNNER_TIMEOUT_MS = 300_000;
function runPinnedRunner(root: string, input: string): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-operator-runner-'));
  const inPath = path.join(dir, 'jobs.json');
  const outPath = path.join(dir, 'out.json');
  fs.writeFileSync(inPath, input);
  const inFd = fs.openSync(inPath, 'r');
  const outFd = fs.openSync(outPath, 'w');
  try {
    const r = spawnSync(process.execPath, [path.join(root, OPERATOR_VERIFIER_RUNNER), path.join(root, OPERATOR_VERIFIER_FILE)], {
      stdio: [inFd, outFd, 'pipe'],
      encoding: 'utf8',
      timeout: OPERATOR_RUNNER_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 1 << 24,
    });
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL';
    return {
      status: timedOut ? null : r.status,
      stdout: fs.readFileSync(outPath, 'utf8'),
      stderr: timedOut ? `runner killed after ${OPERATOR_RUNNER_TIMEOUT_MS} ms (hard timeout)` : (r.stderr || ''),
      error: r.error,
    };
  } finally {
    fs.closeSync(inFd);
    fs.closeSync(outFd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Hash the pinned files and, only if every one matches, run the operator's code on `rounds`.
 * Never throws: a failure is returned as `error` so the calling step reports a FAIL.
 */
export function runOperatorVerifier(rounds: OperatorRound[], root = PACKAGE_ROOT): OperatorRun {
  const files = Object.entries(OPERATOR_VERIFIER_PINS).map(([file, pinned]) => {
    const p = path.join(root, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  if (!hashesMatch) return { files, hashesMatch, drawn: null, logs: [], error: 'operator Verify-tab code or its runner does not match its pinned SHA-256' };
  const r = runPinnedRunner(root, JSON.stringify({ rounds }));
  if (r.status !== 0) {
    return { files, hashesMatch, drawn: null, logs: [],
      error: `operator verifier runner exited ${r.status}: ${(r.stderr || String(r.error || '')).trim().slice(0, 400)}` };
  }
  try {
    const out = JSON.parse(r.stdout) as { logs: string[]; results: Array<{ id: string; drawn: number[] | null }> };
    const drawn = new Map<string, number[] | null>();
    for (const x of out.results) drawn.set(String(x.id), x.drawn);
    return { files, hashesMatch, drawn, logs: out.logs, error: null };
  } catch (e) {
    return { files, hashesMatch, drawn: null, logs: [], error: `operator verifier output unreadable: ${(e as Error).message}` };
  }
}

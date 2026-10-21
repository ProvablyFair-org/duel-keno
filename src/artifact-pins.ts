/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence.
 *
 * Every file here is TRACKED in git — a pin on an ignored file would be a pin on nothing.
 *
 * outputs/verification-results.json is deliberately NOT pinned. It is this verifier's own output
 * and it carries Step 21's own verdict, so a pin on it would be a pin on itself; the reproduction
 * gate in tests/verify.ts scores it field by field against a fresh run instead, which is the
 * stronger check — a forged copy cannot be made to pass by re-pinning it.
 *
 * Regenerating an artifact legitimately (`PF_EMIT=1 npm run verify`, or `PF_EMIT=1 npm run
 * simulate`) means re-pinning it here, in the same commit, with the run that produced it.
 *
 * rtp-convergence.html RE-PINNED 2026-09-28 (previous pin f978eeaa…): Chart.js 4.4.7 is inlined verbatim
 * instead of loaded from cdn.jsdelivr.net. Regenerated with `PF_EMIT=1 npm run simulate`;
 * simulation-results.json came back byte-identical (574f961b…) and the html diff is the one <script> tag.
 *
 * simulation-results.json RE-PINNED 2026-10-19 (previous pin 574f961b…): the Pass 1 description no longer
 * says "Validates independent implementation" (the draw code was then ported from Duel's Verify-tab code,
 * decision-19). Regenerated with `PF_EMIT=1 npm run simulate`; the diff is that one description string,
 * and rtp-convergence.html came back byte-identical (3c34df21…).
 *
 * simulation-results.json and rtp-convergence.html RE-PINNED 2026-10-20 (v1.2.0, clean-room src/rng.ts; previous
 * pins 1401c862… and 3c34df21…). Regenerated with `PF_EMIT=1 npm run simulate`. The Pass 1 description now says
 * the draw code is rebuilt from docs/ALGORITHM.md. Two of the 40,000,000 Pass 1 rounds drew a different set
 * (config 8 nonce 261486, config 13 nonce 628473): in each, the step-8 (range 32) first chunk is in
 * [2^32 − 32, 2^32), which the port (Duel's ceiling, 2^32 − 32) rejected and the rebuilt module (the spec's
 * ceiling, 2^32) accepts. The fields of configs 8 and 13 that depend on those two rounds, Pass 1's
 * avgSimulatedRTP and convergence[6] moved; Pass 2 and every other field are unchanged. The chart's data line
 * moved with them. chi-squared-results.json, determinism-log.json and payout-coverage.json are byte-identical.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'chi-squared-results.json':
    '2af4ae85b381b8eebca9e7ab664b49f412a50f75e8646c2c205538d66a3e6e13',
  'determinism-log.json':
    '081193bc8e2965dd7f4bf1b82b2bd232ba2cedb5783f9cd1b96111218500604b',
  'payout-coverage.json':
    'e627bc8bc49ff0f8efb0a64a4516c9638c2af1de8f2e7842cd96ffcf0e5e8570',
  'rtp-convergence.html':
    'ceb2f732a43da4439fa36af88c33f79acf177e50cb9309d06ceafaf98616e77f',
  'simulation-results.json':
    'c8543cce21bef6707099b0f29676abe2712fdb3ce0c85f46e3c9a014f12f0de7',
});

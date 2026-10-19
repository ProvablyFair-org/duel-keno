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
 * says "Validates independent implementation" (the draw code is ported from Duel's Verify-tab code,
 * decision-19). Regenerated with `PF_EMIT=1 npm run simulate`; the diff is that one description string,
 * and rtp-convergence.html came back byte-identical (3c34df21…).
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'chi-squared-results.json':
    '2af4ae85b381b8eebca9e7ab664b49f412a50f75e8646c2c205538d66a3e6e13',
  'determinism-log.json':
    '081193bc8e2965dd7f4bf1b82b2bd232ba2cedb5783f9cd1b96111218500604b',
  'payout-coverage.json':
    'e627bc8bc49ff0f8efb0a64a4516c9638c2af1de8f2e7842cd96ffcf0e5e8570',
  'rtp-convergence.html':
    '3c34df21b9782760161f41d4c00fec420bb0bb0215774b2460d0ea3ea432d63d',
  'simulation-results.json':
    '1401c862fb9a65639050ec8e704440cffc12485c96a4c3420c2c36d827d5ccfb',
});

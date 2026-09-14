/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence.
 *
 * outputs/verification-results.json is deliberately NOT pinned — it is this verifier's own
 * output and is rewritten on every run by construction.
 *
 * Regenerating an artifact legitimately means re-pinning it here, in the same commit, with the
 * run that produced it.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'chi-squared-results.json':
    '193f866e271c26c3ff578209d7ac2c06bdc3c6b6a05c882e015ddcfee617c03f',
  'determinism-log.json':
    '89362ed920cc452b6dd322bd49eab3889e4099083d91aac5e0d9314319cbeadc',
  'rtp-convergence.html':
    'f978eeaa55b168a6c400e9f05f4de7490942a796e05f6d9bb4f9aa5f872297de',
  'simulation-results.json':
    '78931bc5e73239b97ac3525be9eb9964d79d7911b3e1123d3573a0a850dc86b3',
});

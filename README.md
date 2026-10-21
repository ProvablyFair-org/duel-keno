# Duel Keno — Provably Fair Audit

**Auditor:** [ProvablyFair.org](https://www.provablyfair.org) · **Audit ID:** PF-2026-DL03 · **Release:** `v1.2.0` · **Capture:** 11 April 2026

**Result: PROVABLY FAIR — Full Pass for the captured configuration.** All 5,100 recorded draws and payouts reproduce. The verifier reports 22 passing steps, one disclosed capture-origin flag and no hard failures. The flag concerns two missed responses during capture retries; it does not identify an operator defect.

**Scope:** The captured April 2026 base-tier configuration has **99.9% theoretical RTP across all 40 configurations** (four risk levels × pick counts 1–10). Stake-scaling configurations are outside this audit. **Current game, as of 5 October 2026:** in the duel.com Keno configuration as fetched that day in a logged-in session (read-only GET), the house edge rises with bet size. Each configuration starts with a 0.1% tier; above a threshold, 35 of the 40 configurations step up, to as much as 1.0%. The 0.1% tier matches the audited table except for 24 of 260 multipliers, which are rounded to 8 decimal places. Thresholds run from about $90 (HIGH, 6 picks) to about $99,500 (LOW, 1 pick). In 15 configurations the tiers end where the top payout's profit reaches $3m, five of them inside the 0.1% tier. This audit certifies the audited 0.1% table only; see [current live configuration as of 5 October 2026](MANIFEST.md#current-live-configuration-as-of-5-october-2026). This result does not certify the current casino at every stake, and theoretical RTP is not a promise about an individual session's return.

## What was verified

| Check | Captured evidence |
|---|---|
| Draws | 5,100 of 5,100 drawn sets reproduced from server seed, client seed and nonce. The RNG code (`src/rng.ts`) was rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened Duel's code; Duel's published Verify-tab code is run as a second check, not used as the source ([where it comes from](MANIFEST.md#commitment-inputs-and-shuffle)) |
| Payouts | 5,100 of 5,100 matched the captured paytable and exact settlement rule |
| Seed records | 106 records; 102 bet-bearing epochs; revealed seeds and recorded commitment links checked |
| Configurations | All 40 represented; 190 of 260 payout cells observed in live play |
| Theoretical RTP | 99.9000% after rounding, calculated independently from the captured paytable |
| Observed return | 91.3853% across the finite capture; reported separately from theoretical RTP |
| Simulation evidence | 40 million Pass 1 rounds in total across 40 configurations, plus Pass 2 seed comparisons |
| Player verification | Duel's own Verify-tab code (the second check) and both ProvablyFair.org verifiers reproduce all 5,100 drawn sets |

Hash matching and captured chronology establish consistency of the supplied records; they are not independent historical timestamp attestation. Coverage gaps, screenshot provenance and residual operator trust are retained in the [overview's limitations](MANIFEST.md#limitations-and-trust).

## Run the audit

Extract this package and open a terminal in its `duel-keno` directory. Use **Node 22.x**, as declared in [.nvmrc](.nvmrc) and [package.json](package.json).

```sh
npm ci
npm test
```

Expected: **30 unit tests pass; 22 PASS + 1 capture-origin FLAG; zero hard failures; REPRODUCED; exit 0.** This replays every captured bet, checks the pinned evidence and compares fresh verification results with the committed artifacts. It scores the stored simulation and replays its specified sample windows; it does not rerun the full simulation. The exit code is the verdict: `0` PROVABLY FAIR — Full Pass · `2` PROVABLY FAIR — Conditional Pass · `5` RTP FIGURE OVERSTATED (the RTP-CLAIM rule 1.2.0 found a published RTP figure above the game's real RTP; the draws pass) · `1` NOT PROVABLY FAIR, or a reproduction difference.

**RTP claim (RTP-CLAIM 1.2.0, switched on).** Each of 2,712 rows (the 40 audited configurations and the 2,672 stake tiers of Duel's 5 October 2026 configuration) is held to the edge Duel's game settings state for its stake tier (claim kind `tiered`, 91 tiers from 0.1% to 1.0%). Scored on Step 17: PASS, 0 rows beyond the 0.1 pp band ([table](outputs/rtp-claim-table.json)). The help page's site-wide 99.9% line is noted, not tested.

```sh
npm run test:full                 # optional full simulation regeneration and verification
node scripts/release-manifest.mjs --check
```

The full simulation previously took 44–47 minutes on the recorded machine. Ordinary runs write to `outputs/run/` and leave the evidence of record intact. See [reproduction details](MANIFEST.md#reproduce-the-audit) for the comparison rules, mutation checks, live-verifier check and deliberate artifact-refresh procedure.

## Verify a bet

Save the commitment (the active server-seed hash) shown before betting. After seed rotation reveals the server seed, check that the SHA-256 of the hex-decoded seed equals that saved value: a match is hash equality, and the assurance that the seed was fixed before your bet comes from your saved record, not from the match. Then use the [ProvablyFair.org verifier](https://www.provablyfair.org/verify-bets) to reproduce the draw, or follow the [complete verification instructions](MANIFEST.md#verify-a-bet). Those instructions cover seed encoding, number order, hits and payouts. The bundled paytable applies to this capture; use the configuration applicable to your own bet when checking its payout.

## Files and evidence

There are two documentation files: this README and [MANIFEST.md — consolidated audit overview](MANIFEST.md). The overview contains the game rules, algorithm, RTP calculation, verification results, evidence, limitations and release history.

- [Captured bets](data/keno-master-5100bets.json) — SHA-256 `841755fdfb268d7796017212f08a18bfea7615c30a4590dd29793b34c5e6bcf9`.
- [Captured configuration](kenoConfig.json) — SHA-256 `efd3c645c4b3956199fde62dd65446c08e4605763d2d0f34c97a226bdbae4f91`.
- [Verification results](outputs/verification-results.json), [RTP claim table](outputs/rtp-claim-table.json) and [release manifest](RELEASE-MANIFEST.json).
- [Audit report](https://audit.provablyfair.org/casino/duel/games/keno/overview) · [Public repository](https://github.com/ProvablyFair-org/duel-keno) · [MIT license](LICENSE).

The consolidation and the publication corrections are recorded in the [release history](MANIFEST.md#release-history).

# Duel Keno — Consolidated Audit Overview

**Audit ID:** PF-2026-DL03 · **Auditor:** ProvablyFair.org · **Release:** `v1.2.1` · **Framework:** 1.1

Original audit: March 2026. Dataset of record: recapture on **11 April 2026**, from `2026-04-11T00:02:36.113Z` to `2026-04-11T01:35:29.880Z`. Original publication: 4 June 2026. This revision is release `v1.2.1`, an errata release that adds `.gitattributes` to `v1.2.0`, which rebuilt the draw code from a written specification; `v1.1.0` was the October 2026 re-certification. This overview consolidates the package documentation and records the publication corrections of 4 October 2026. The machine-readable release identity remains in [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json).

## Conclusion and scope

**PROVABLY FAIR — Full Pass for the supplied capture:** all 5,100 recorded drawn sets and payouts reproduce; 22 of 23 scored steps pass, with one disclosed capture-origin flag and no hard failures. The flag concerns two capture retries, not a demonstrated operator-side fault. The result supports the published draw algorithm and captured settlement rules for this evidence.

**The captured April 2026 base-tier configuration has 99.9% theoretical RTP across all 40 configurations. Stake-scaling configurations are outside this audit.** The configuration contains `scaling_edge: []`, and each captured bet reports `effective_edge` 0.1 (percent). This is a statement about that snapshot, not a certification of every stake or a later live version. An algorithm replay cannot establish the operator's current configuration or undisclosed internal processes. The duel.com Keno configuration as fetched on 5 October 2026 in a logged-in session (read-only GET) carries stake scaling; see [Current live configuration as of 5 October 2026](#current-live-configuration-as-of-5-october-2026).

The stored theoretical result is independently calculated from the captured multiplier table, rather than the operator's probability field. Observed return over 5,100 bets is 91.3853%; finite-sample returns differ from theoretical expectation, particularly with rare high-paying outcomes. The distinction is preserved throughout this overview.

Hash checks and the recorded forward-commitment chain support consistency of the captured records. They do not independently attest the historical time a commitment was published. That each commitment was recorded before its bets rests on the capture's recorded pre-bet observations, conditional on capture integrity, which this package assumes (K1). Scope limitations, unreached payout cells and residual trust are recorded below rather than treated as proof of a defect.

## Contents

- [Dataset and capture](#dataset-and-capture)
- [Game and algorithm](#game-and-algorithm)
- [Payouts and RTP](#payouts-and-rtp)
- [Verification results](#verification-results)
- [Reproduce the audit](#reproduce-the-audit)
- [Verify a bet](#verify-a-bet)
- [Evidence](#evidence)
- [Limitations and trust](#limitations-and-trust)
- [Terms](#terms)
- [Release history](#release-history)

## Dataset and capture

The capture recorded live production API responses from a test account on Duel.com. [The capture reference](capture/capture-auto.reference.js) shows the rig's requests and rotation sequence. Each bet retains its request (`amount`, `difficulty`, `selected_positions`), response (`drawn_numbers`, `multiplier`, `amount_won`) and seed identifiers (`serverSeedHashed`, `clientSeed`, `nonce`). One field was edited after capture. The rig recorded `seeds[0].seed.serverSeed` as null, since the first rotation has no earlier bet to reveal from. On 17 April 2026 it was set to the seed revealed by `seeds[1]` (transaction 518502617). No verification step reads it. Setting it back to null reproduces the file as captured, SHA-256 `563464f300c26ccbf06cf2f35c64884dbc2e19c0ed1c88ca13125c91531f541d`.

| Phase | Bets | Stake | Configuration and purpose |
|---|---:|---:|---|
| A | 3,000 | $0.01 | Picks 2–9 × four risk levels; 32 configurations |
| B | 1,000 | $0.01 | Picks 1 × four risk levels |
| C | 1,000 | $0.01 | Picks 10 × four risk levels |
| D | 100 | $10 | MEDIUM/picks=10, two auditor-set client seeds; captured stake comparison |

Total wagered: $1,050. Across A–D, all 40 configurations have at least 73 captured bets. Phase D has 43 paying bets and does not establish behaviour at every stake. The population comprises 106 rotation records: 102 bet-bearing epochs with 50 recorded bets each and four bet-less end-of-phase records. Records 1–105 carry a server-seed plaintext, 102 of them distinct; each bet-bearing epoch's seed is revealed by the record after it. The first rotations of Phases B, C and D (`seeds[61]`, `seeds[82]` and `seeds[103]`) repeat the plaintext and source transaction of the record before them: the rig rotated at the end of each phase and again at the start of the next, and both rotations read the same last transaction. So the seeds of the bet-less epochs at the ends of Phases A, B and C (`seeds[60]`, `seeds[81]` and `seeds[102]`) are not in the dataset. Nor is the seed of the last record, `seeds[105]`, at the end of Phase D: no rotation followed it. Two epochs contain a missed response and nonce 50; see DL-1.

The rig, not Duel's Autopick, generated every selected-number set. It also chose the captured client seeds: 100 distinct 16-character `Math.random()` strings in Phases A–C, and two predictable `pfaudit` plus timestamp strings in Phase D. The operator UI's separate browser generator is documented by E12; it was not the generator used for this capture.

| Input | Identity |
|---|---|
| [data/keno-master-5100bets.json](data/keno-master-5100bets.json) | SHA-256 `841755fdfb268d7796017212f08a18bfea7615c30a4590dd29793b34c5e6bcf9` |
| [kenoConfig.json](kenoConfig.json) | SHA-256 `efd3c645c4b3956199fde62dd65446c08e4605763d2d0f34c97a226bdbae4f91` |

The config is a captured `{success, data}` endpoint response. Its fetch URL was not retained. The verifier checks both hashes before running the scored steps; changing an input does not preserve the identity of this audit.

## Game and algorithm

This section describes the **April 2026 captured base-tier configuration**. The game draws 10 distinct numbers from a grid numbered 1–40. Before a round, the player selects 1–10 numbers and a risk level: CLASSIC (`difficulty=1`), LOW (`2`), MEDIUM (`3`) or HIGH (`4`). These produce 40 risk/pick-count configurations. Hits are the intersection of the selected and drawn sets; risk and pick count select the payout table. Neither risk, selected positions nor stake enters the documented draw function. That property of the draw does not establish identical payout pricing at all stakes or under later configurations.

### Commitment, inputs and shuffle

The commitment is `SHA-256(hexDecode(serverSeed))`. The revealed server seed is a 64-character hexadecimal string, decoded to 32 bytes for both the commitment check and HMAC key. Using the hex text itself as a UTF-8 key produces a different result. The HMAC message is `clientSeed:nonce:cursor`; the client seed is a player-selectable input, the nonce identifies the round, and the cursor identifies the shuffle step.

The draw is specified in [`docs/ALGORITHM.md`](docs/ALGORITHM.md), written from Duel's public pages, the result grids its Verify page shows, the standard provably-fair construction and the 5,100 live bets, without Duel's code; each step there names its source. [src/rng.ts](src/rng.ts) was rebuilt from that specification by an implementer who never opened Duel's code (see "Where the draw code comes from" below). It starts with `[1,2,…,40]` and performs a backward Fisher–Yates shuffle:

1. For each step `s` from 0 to 38, fix array index `i=39−s` with `range=i+1`.
2. Compute `HMAC-SHA256(hexDecode(serverSeed), clientSeed:nonce:s)` and scan its eight four-byte chunks as big-endian unsigned integers.
3. Accept the first value below `LIMIT = floor(2³² / range) × range`, then swap positions `i` and `value % range`.
4. What follows when all eight chunks of a step are rejected is not specified (specification open point O2; probability below 10⁻⁶⁰ per step); `src/rng.ts` throws rather than invent a rule.
5. Take the first ten entries of the shuffled array.

The accepted interval is a whole multiple of each shuffle range, so modulo reduction has equal accepted counts for every index under the uniform-chunk model. Step 22 enumerates all 39 ranges. At range 40 the ceiling rejects 16 of 2³² values; the largest per-chunk rejection count is 22 at range 39, and the five power-of-two ranges reject none. No rejected chunk or retry occurred across the 198,900 shuffle steps in the 5,100 captured draws. Rare-branch analysis and tests are distinct from observed live coverage.

Settlement uses the **set of ten numbers**, not their display order. Step 5 reports 5,100/5,100 set matches, zero mismatches and zero skipped captured bets. Step 6's substituted client seed changed the set on every captured bet; different inputs are not a mathematical guarantee of different sets in every possible future round. The results are recorded in [outputs/determinism-log.json](outputs/determinism-log.json).

**Where the draw code comes from.** Since v1.2.0, `src/rng.ts` is rebuilt from the written specification [`docs/ALGORITHM.md`](docs/ALGORITHM.md) by an implementer who read only that specification and an interface file and never opened Duel's code, its Verify-tab file or the earlier `src/rng.ts`; its body is that implementer's file byte for byte, and its self-test runs as `tests/keno/RngSpecTests.ts` (79/79). Through v1.1.0 it was ported from Duel's published Keno Verify-tab code and cited 18 of its lines; the port and the citation table are gone. Duel's published Verify-tab code, copied on 25 September 2026 as E13 and retained in [evidence/verify-tab](evidence/verify-tab/), is run as a second check, not used as the source: Step 23 executes it unmodified on all 5,100 captured bets, with 0 differences in draw order from `src/rng.ts` and 0 differences from the served sets. Off the captured data the two differ in two places. (1) On the five power-of-two ranges (2, 4, 8, 16, 32) Duel's ceiling is `0xFFFFFFFF − (0xFFFFFFFF % range) = 2³² − range` and the specification's is 2³², so a first chunk among the top `range` values is rejected by Duel's code and accepted by `src/rng.ts`. The specification takes its ceiling from the standard construction; the data cannot choose, because no captured chunk fell in that window (expected about 62/2³² per bet). On four inputs found by search with a step-8 (range 32) first chunk in that window, Duel's code and `src/rng.ts` drew a different set on 2 and the same set on 2 (a unit test in `tests/keno/KenoTests.ts` re-runs the four on every `npx mocha`); the ProvablyFair.org live verifier agreed with Duel's code on all four (measured once on 20 October 2026, not part of the suite). (2) When all eight chunks of a step are rejected, Duel's code hashes the next cursor and `src/rng.ts` throws (specification open point O2); probability below 10⁻⁶⁰ per step. Neither case occurred in the 198,900 captured shuffle steps. The theoretical RTP does not depend on the draw code: it is calculated from hypergeometric probabilities and the paytable. Agreement with published code does not establish which implementation the live server or Verify button currently executes. No drand or other external randomness input is needed to reproduce this dataset.

### Seed lifecycle and recorded coverage

The capture contains 102 bet-bearing epochs of 50 recorded bets, within 106 seed entries. 102 of the 106 committed seeds are revealed; the four that are not belong to the bet-less epochs (see [Dataset and capture](#dataset-and-capture)). Ordinarily an epoch used nonces 0–49. Two retry-affected epochs instead include nonce 50 and omit one earlier capture; the missing draws can be reconstructed, but their live responses are not captured. The limitation register preserves those exceptions.

Steps 1–3 check revealed-seed hashes, epoch consistency and commitment linkage. The 106 checked promotions comprise 105 forward links plus the pre-capture anchor. A matching hash shows consistency with a commitment; timing evidence is needed to establish when that commitment was recorded. Hash matching alone neither explains seed selection nor eliminates operator selection before commitment.

The recorded rotation interface is `POST /api/v2/client-seed/rotate`. Browser evidence E11 describes client-seed submission, while the April capture used its own generators: `Math.random()` in phases A–C and two predictable timestamp-derived seeds in Phase D. Reproduction verifies their influence, not their unpredictability. [capture/capture-auto.reference.js](capture/capture-auto.reference.js) preserves the capture method; [src/loader.ts](src/loader.ts) binds the recorded population and seed timeline.

## Payouts and RTP

All figures below apply to the **pinned April 2026 base-tier paytable** in [kenoConfig.json](kenoConfig.json). Stake-scaling configurations are outside this audit. The pinned response has `scaling_edge=[]`; all 5,100 captured bets report `effective_edge=0.1`. These observations support the captured pricing, not a claim about every stake or today's game.

### Exact settlement and coverage

For the recomputed hit count, look up `multipliers[risk][picks][hits]`, round that table cell to the served 13-decimal multiplier, and multiply by the stake. Multipliers are **total returns**, including any returned stake; 0× returns nothing. [src/money.ts](src/money.ts) and [tests/steps/payouts.ts](tests/steps/payouts.ts) compare integer-scaled amounts exactly, with no monetary tolerance, and check that `amount_currency` echoes the requested stake.

The recorded result is 5,100 exact settlements: 2,209 paying bets and 2,891 zero-cell bets. All served multiplier strings match the corresponding rounded table cell; 4,662 require no rounding and 438 do. For example, MEDIUM/picks=8/hits=4 has table value `4.035047673782158` and served multiplier `4.0350476737822`; a $0.01 stake returns exactly `$0.040350476737822`.

Only LOW/picks=1 and MEDIUM/picks=1 pay on zero hits, returning 0.71× and 0.41× respectively. These are partial stake returns. The remaining configurations pay zero on no hits.

All 40 configurations have live witnesses, the leanest with 73 bets against the scored floor of 50. Live play exercised **190 of 260 payout cells**. The other 70 carry **14.92% of summed theoretical RTP** across the configurations; [outputs/payout-coverage.json](outputs/payout-coverage.json) lists their probabilities and multipliers. Analytical inclusion of these cells verifies the declared table's expectation, not their unobserved live payment paths. Phase D supplies 100 $10 bets on MEDIUM/picks=10, of which 43 paid; it does not establish settlement at every stake/configuration combination.

### Theoretical expectation

For `n` selected numbers and `k` hits, the uniform-without-replacement model gives:

```text
P(hits=k) = C(n,k) × C(40−n,10−k) / C(40,10)
RTP(risk,n) = Σ(k=0…n) P(hits=k) × multiplier(risk,n,k)
```

Here `C(40,10)=847,660,528`. The non-selected population is **40−n**, which equals 30 only when ten numbers are selected. Probabilities are derived independently from combinatorics; the operator's supplied probability field is not used. The expectation remains conditional on the pinned paytable and draw model.

For this April base-tier table, all 40 configurations round to **99.9000% theoretical RTP**, or **0.1% house edge**. Exact rational calculation on table literals equals `999/1000` on 16 configurations; the other 24 differ by at most `1.125×10⁻¹⁶`. Using the 13-decimal multipliers actually served changes the maximum difference from `999/1000` to `7.21×10⁻¹⁵`, with no change to the printed RTP. The full paid-multiplier results are the `april-2026` rows of [outputs/rtp-claim-table.json](outputs/rtp-claim-table.json); the RTP-CLAIM rule is switched on and its claim comparison is scored on Step 17 (see [RTP claim as shown to players](#rtp-claim-as-shown-to-players)).

[src/exact.ts](src/exact.ts) uses integer binomial coefficients and rational arithmetic. Step 17 checks probability sums and means, the 40 RTPs and negative controls for corrupted probabilities/table cells. [src/rtp-settings.ts](src/rtp-settings.ts) generates the claim table. Risk and pick count change volatility within this captured configuration while preserving the rounded expected return.

### Captured returns and simulation

| Phase | Bets | Stake total | Returned, rounded | Observed RTP | Configuration coverage |
|---|---:|---:|---:|---:|---|
| A | 3,000 | $30 | $35.54 | 118.478% | Picks 2–9, all risks |
| B | 1,000 | $10 | $10.54 | 105.378% | Picks 1, all risks |
| C | 1,000 | $10 | $9.58 | 95.821% | Picks 10, all risks |
| D | 100 | $1,000 | $903.88 | 90.388% | MEDIUM/picks=10 |
| Total | 5,100 | $1,050 | $959.55 | 91.385% | Mixed |

Percentages use unrounded returns. The total is rounded from the unrounded sum ($959.5457), so it is one cent above the sum of the rounded phase figures. The $10 phase dominates the monetary total, and rare large payouts produce substantial variance; these finite captured returns are informational, not a replacement for the mathematical expectation. Likewise, passing small-sample distribution checks does not prove every possible bias absent.

The recorded simulation uses **40 million total rounds**, one million for each configuration, with seed pairs generated once and pinned in [src/sim-seeds.ts](src/sim-seeds.ts). Its average simulated RTP is 99.970% against the captured table's 99.9000% theoretical value. No configuration flags in the recorded goodness-of-fit or serial battery; eight runs tests are degenerate and provide no independent evidence. Pass 2 uses 102 captured seeds and 1,666 seed/config combinations: 13 Test A flags (binomial tail 0.848) and 57 Test B flags (tail 0.9992). The tests use fixed selections `1…picks` and do not rule out every selection strategy. Detailed finite-sample results remain in [outputs/simulation-results.json](outputs/simulation-results.json).

### Current live configuration as of 5 October 2026

The duel.com `/api/v2/keno/config` response as fetched on 5 October 2026 in a logged-in session (read-only GET; E14) carries a populated `scaling_edge`: for each of the 40 configurations, a contiguous list of bet-size tiers, 2,672 tiers in all. Each list starts with a 0.1% tier. That tier equals the audited table on 236 of 260 cells; the other 24, one in each of 24 configurations, are the audited multiplier rounded to 8 decimal places, at most 4.49×10⁻⁹ away. The response's own `multipliers` field equals the audited table on all 260 cells. Above a per-configuration threshold the edge rises in 0.01% steps to at most 1.0%, an RTP of 99.0%. Thresholds run from $90.20 (HIGH/picks=6) to $99,546.07 (LOW/picks=1). The response has no maximum-profit field, but in 15 configurations the last tier ends where the top payout's profit reaches $3,000,000. LOW/picks=8–10 and MEDIUM/picks=9–10 reach that point inside the 0.1% tier, so those configurations never scale. Each tier's exact RTP differs from 1 minus its stated edge by less than 3.31×10⁻⁹. [outputs/live-config-scaling.json](outputs/live-config-scaling.json) lists every threshold, tier and RTP. This audit certifies the audited 0.1% table. Settlement on scaled tiers was not captured, and neither was which of the two 0.1% tables paid a bet as of 5 October 2026.

### RTP claim as shown to players

RTP-CLAIM rule 1.2.0 ([src/rtp-claim.ts](src/rtp-claim.ts), Methodology v1.1, agreed 14 October 2026) ties the claim to a figure shown in one of six places: the game page, the fairness page, the help page, the bet panel, the rules, or the game settings the site loads. Under decision D2 a stake tier is held to the edge the casino states for it, and the edge in Duel's game settings counts (Mike, 14 October 2026: "D2: as written. The edge in Duel's game settings counts, no screenshot needed."). The duel.com Keno configuration as fetched on 5 October 2026 (E14) states a `house_edge` for every bet-size tier of every (risk, picks) configuration: 91 distinct edges, 0.1% to 1.0%. So the claim is **kind `tiered`, sourced to the game settings** ([src/rtp-settings.ts](src/rtp-settings.ts)): every row carries the stake tier it is priced at, keyed by the edge E14 states for it, and is held to 1 minus that edge within the rule's 0.1 pp band. The 40 audited April configurations are held to the 0.1% tier, the tier every captured bet was priced at (`effective_edge` 0.1 on all 5,100; DL-9).

[outputs/rtp-claim-table.json](outputs/rtp-claim-table.json) holds 2,712 exact RTPs: the 40 audited April configurations on their 13-decimal served multipliers, and all 2,672 tiers of the 5 October 2026 configuration (E14) on the multipliers that response lists. **Outcome: pass, 0 of 2,712 rows beyond the band**; every row has a stated tier (0 unstated). Each tier's exact RTP differs from 1 minus its stated edge by less than 3.31×10⁻⁹, so every scaled tier sits on its own figure. The rule is switched on (decision D3): the outcome is scored on Step 17, the step carrying KENO-19, and a house-side miss would make the verdict RTP FIGURE OVERSTATED (exit 5), never NOT PROVABLY FAIR, because the draws themselves pass. The Zero Edge allowance is not part of the configuration and is not modelled, and settlement on scaled tiers was not captured.

**Noted, not tested.** Until 14 October 2026 the claim was flat 99.9%, the site-wide line on the help page duel.com/wtf-duel ("wtf Duel?", under About): "At the moment we stand at 99.9%", which names no game and no stake range (E15, read 5 October 2026 in a logged-in session). Against that flat figure 2,294 of the 2,632 scaled tiers fell more than 0.1 pp below it. Under decision D3 a site-wide line is noted, not tested, so it is recorded here and no longer the claim. E15 also records the keno game page's Zero Edge panel (0% edge within the daily allowance, then "a house edge based on your bet size", with no number) and no figure on the fairness page duel.com/provably-fair; the Zero Edge line is likewise noted, not tested. `outputs/live-config-scaling.json` (informational, not scored) still carries its comparison of every tier with the flat 99.9% line, unchanged.

## Verification results

The audit evaluates the **5,100 rounds captured on 11 April 2026 and the supplied April configuration**. Its 23 scored steps report **22 PASS, one capture-origin FLAG and zero hard failures**. The package's `PROVABLY FAIR — Full Pass` label treats the disclosed capture flag as verdict-neutral. It does not certify later paytables, current stake scaling, uncaptured outcomes or every possible API attack.

The rig records each bet timestamp after receiving its response and querying seed state. Its rotation-before-play source order supports the captured chronology; it is not independent timestamp attestation.

| Step | Check | Result and scope |
|---:|---|---|
| 1 | Seed hash integrity | PASS: 102 used seeds hash to their commitments; all 105 transitions accounted for, including three phase-start records that repeat the record before them |
| 2 | Commitment linkage | PASS: 105 forward links recomputed from raw hashes, plus the recorded initial anchor; 106 promotion records agree |
| 3 | Epoch consistency | PASS: timeline-defined windows bind every bet to its commitment and client seed; zero orphans; 106 distinct committed hashes |
| 4 | Nonces | FLAG: no repeats or reordering in captured rounds; two missing outcomes remain unverified, as detailed below |
| 5 | Draw reproduction | PASS: 5,100/5,100 drawn sets match; exactly ten distinct integers in 1–40; legal picks and echoed difficulty; no stake, risk, pick-set or drand input required |
| 6 | Client-seed influence | PASS: wrong and empty client-seed controls each change all 5,100 draws; this does not establish seed unpredictability |
| 7 | Settlement | PASS: all 5,100 payouts equal stake × independently selected, 13-decimal multiplier exactly; zero-paying cells credit zero |
| 8 | Multiplier provenance | PASS: all served multipliers match reached cells of the pinned April table; hits are counted on recomputed draws |
| 9 | Elevated stake | PASS: all 100 Phase D $10 bets reproduce and settle by the same April rules; only 43 paid, below the profile's 100-paying-bet floor |
| 10 | Configuration coverage | PASS: 40/40 configurations exceed the 50-round floor; live play reached 190/260 payout cells |
| 11 | Captured edge fields | PASS: April `scaling_edge=[]`; all 5,100 `effective_edge` values are 0.1; this is not a current-game claim |
| 12 | Consolation payments | PASS: LOW/picks 1 pays 0.71× on zero hits, MEDIUM/picks 1 pays 0.41×; remaining zero-hit cells pay zero |
| 13 | Population and phases | PASS: 5,100 bets and 106 seed records match declared population and phase counts |
| 14 | Dataset identity | PASS: dataset SHA-256 matches its pin |
| 15 | Epoch size | PASS: 102 epochs × 50 captured bets; this count does not erase the two missing nonce outcomes |
| 16 | Hit distribution model | PASS: picks-10 hypergeometric mode is 2 and mean is 2.5 |
| 17 | Independent probability calculation | PASS: independently derived hypergeometric weights give 99.9000% RTP on all 40 April rows; exact rational checks and negative controls also pass. RTP-CLAIM 1.2.0 is scored here and its outcome recorded in this step's `rtpClaim` field of the results file: pass, 0 of 2,712 rows beyond the band |
| 18 | Phase D seeds | PASS: all 100 rounds use the two recorded auditor-set client seeds, on MEDIUM/picks 10 |
| 19 | Simulation Pass 1 | PASS: 40 million rounds **total**, one million per configuration; histogram, grid and serial checks rescore; first 1,000 rounds per configuration replay |
| 20 | Simulation Pass 2 | PASS under the declared thresholds: 1,666 seed/configuration combinations rescore; their early windows replay; limited detection power remains |
| 21 | Artifact integrity | PASS: five artifacts match SHA-256 pins; 53,196 numeric leaves meet declared domains |
| 22 | Range mapping | PASS: all 39 shuffle ranges have equally many accepted values per index; 198,900 accepted chunks, zero observed rejections |
| 23 | Saved verifier parity | PASS: both pinned ProvablyFair.org verifiers reproduce all 5,100 sets; docs-site table matches all 260 April cells; Duel's pinned Verify-tab code, run as a second check (not the source of `src/rng.ts`), reproduces every set and the shuffle order of `src/rng.ts` |

**The nonce flag:** Phase B epoch `505951bc32b6b0de…` lacks nonce 7; Phase C epoch `5169f71b50f18b74…` lacks nonce 43. Each contains nonce 50 and 50 captured bets. Revealed, commitment-matching seeds allow theoretical draws at the missing nonces to be calculated, but no captured response or payout exists to compare. Those **two outcomes are unverified**. They must not be counted as verified simply because deterministic draws can be generated.

**Payout and boundary coverage:** 2,209 captured bets paid and 2,891 hit zero-paying cells. Of 260 table cells, 70 were not reached and account for 14.92% of summed theoretical RTP across configurations. Analytical table checks include them; live payment checks do not. The all-ten-hit jackpot for picks 10 has probability `1 / C(40,10) = 1 / 847,660,528` and was not observed. No payout cap is declared in the April configuration. The duel.com Keno configuration as fetched on 5 October 2026 in a logged-in session (read-only GET; E14) has no maximum-profit field either, but in 15 configurations its last tier ends where the top payout's profit reaches $3,000,000.

Step 22's calculation covers ranges 40 down to 2. Range 40 rejects the top 16 uint32 values; the largest rejection is 22 values at range 39, and the five power-of-two ranges reject none. Equality with `maxFair` is rejected. No rejection or exhaustion retry was witnessed in the capture; boundary behavior is supported by code/vector tests and the arithmetic bound.

**Statistical interpretation:** live hit-distribution tests find no configuration below p=0.01 (minimum 0.1168); pooling by pick count gives minimum p=0.4798. The without-replacement-corrected drawn-number test gives p=0.5832. These are informational finite-sample checks. Aggregate hit autocorrelation (r₁=0.320) and runs results are confounded by phase changes in expected hits; they neither establish a defect nor prove live independence.

Pass 1's recorded average RTP is 99.970%, with no configurations failing its Bonferroni checks. On eight picks-1/picks-2 configurations the median-split runs test is degenerate, so its passing value adds no evidence; the lag-1 check remains. Pass 2 records Test A 13/1,666, binomial p≈0.848, and Test B 57/1,666, p≈0.9992. A Test B flag needs the early window significant at 0.05 and the late window not; the windows use disjoint nonces, so the nominal flag rate under the null is 0.05 × 0.95 = 0.0475 (79.1 expected flags). The recorded tail is computed at 0.05, the early-window rate alone, which is the more lenient choice; at 0.0475 the tail for 57 flags is p≈0.9968. The served-return screen gives z≈+1.49 and lower-tail bootstrap p≈0.919. Its stated 80%-power deficit is 0.234× per bet, so passing excludes neither subtle nor partial preselection. Simulation tests evaluate the model and saved streams; they are not additional live casino observations.

S5: fairness-integrity matrix; game-integrity testing not commissioned.

**Framework attack coverage:** these checks are offline analysis and replay, not attempted manipulation of the live API.

<!-- S5-MATRIX:START -->

| ID | Category | Recorded result and limit |
|---|---|---|
| S5-1 | Seed substitution | PASS: revealed seeds and forward commitments match (Steps 1–2); publication timing remains a separate evidential question |
| S5-2 | Client-seed manipulation | PASS: wrong/empty-seed controls change all draws (Step 6); predictable capture seeds do not demonstrate unpredictability |
| S5-3 | Stake-conditional outcome | PASS within April scope: 100 $10 draws/settlements match; 43 paying witnesses fall below the profile floor (Step 9) |
| S5-4 | Server-seed cherry-picking | PASS under limited-power statistical thresholds (Step 20); does not exclude subtle selection |
| S5-5 | Concurrent rotation/betting race | NOT TESTED: sequential capture cannot establish race behavior |
| S5-6 | Multiplier tampering | PASS on captured cells: multipliers and exact returns match the April table (Steps 7–8); 70 cells have no live payout witness |
| S5-7 | Nonce manipulation | PASS, two capture-retry gaps disclosed: no repeat or reorder in the captured rounds; Step 4 is a capture-origin FLAG for two unrecorded outcomes (DL-1); forced API nonce reuse was not attempted |
| S5-8 | Range-mapping bias | PASS: equal accepted counts in all 39 ranges (Step 22); rejection branch not witnessed live |

<!-- S5-MATRIX:END -->

Supplementary S5-K1 confirms the replay needs no pick-set/risk/stake input; S5-K2 Autopick and S5-S1 cross-account isolation were not tested. Malformed requests and general production race handling were not demonstrated. Phase A–C client seeds came from `Math.random()` and Phase D seeds from timestamps, so this capture does not demonstrate an unpredictable-client-seed defence.

The verifier comparisons execute saved code, including Duel's copied Verify-tab source, which is a second check and not the source of `src/rng.ts`. They do not prove which code today's Verify button or server runs. The saved docs-site verifier prints the **April** multiplier; the captured live-site verifier prints drawn numbers without a Keno multiplier. Neither establishes correct pricing under stake scaling.

## Reproduce the audit

Use **Node.js 22.x**, as pinned by `.nvmrc` and `package.json`. Dependencies come from the included lockfile; no global TypeScript installation is needed. Run from the extracted repository directory:

```sh
npm ci
npm test
```

This runs **30 Mocha tests**, then the 23-step verifier. It replays captured draws, checks payouts, rescores the committed simulation statistics and performs the verification suite's limited simulation replays. It does **not** regenerate the full simulation. Expected summary: 22 PASS, one capture-origin FLAG, zero hard failures, `PROVABLY FAIR — Full Pass` and `REPRODUCED`.

The recorded `npm test` timing is **18.864 seconds** on an Apple M2 Max with Node 22.23.1, on 28 September 2026. Runtime varies by machine.

| Command | Purpose |
|---|---|
| `npx mocha` | Unit tests only, including known draw vectors, encoding, exact money/probability arithmetic and boundary checks, Duel's own Verify-tab code executed as a second check, and the specification's own vectors and properties (`tests/keno/RngSpecTests.ts`, 79 checks) against `src/rng.ts` |
| `npm run verify` | Verification and comparison against committed evidence |
| `npm run simulate` | Regenerate simulation into `outputs/run/` |
| `npm run test:full` | Unit tests → full simulation → verification/comparison |
| `npm run mutate` | Run the declared mutation battery in disposable copies |
| `npm run live-config` | Informational: recompute the live configuration's scaling tiers (E14) into `outputs/run/` and compare them with the committed `outputs/live-config-scaling.json`. Not scored. |

The optional full simulation has **40 million Pass 1 rounds total**, using 40 independently generated seed pairs pinned in `src/sim-seeds.ts`. Pass 2 evaluates the configurations observed on each of 102 revealed casino seeds: 1,666 seed/configuration combinations, each over 10,000 nonces. Recorded full regenerations on 25 September took approximately **44–47 minutes**. Fixed seeds make these runs reproducible; they are not fresh randomness on every run.

The mutation registry (`tests/mutations.json`) holds **53 planted bugs, and all 53 were caught** in one run of the whole registry (`npm run mutate` on 20 October 2026, Apple M2 Max, 12 cores, Node v22.23.1, on the tree carrying the rebuilt `src/rng.ts`): 53/53 killed, 23/23 scored steps covered, MC3a and MC3b ending with exit 5 as declared. The release manifest records the same figures. Mutation tests check whether deliberate defects trigger their intended checks; they do not establish exhaustive attack coverage.

Verify the two input identities independently:

```sh
shasum -a 256 data/keno-master-5100bets.json kenoConfig.json
```

| Input | SHA-256 |
|---|---|
| `data/keno-master-5100bets.json` | `841755fdfb268d7796017212f08a18bfea7615c30a4590dd29793b34c5e6bcf9` |
| `kenoConfig.json` | `efd3c645c4b3956199fde62dd65446c08e4605763d2d0f34c97a226bdbae4f91` |

Verification exits on a mismatch before scoring. Ordinary runs write only below `outputs/run/`; they preserve the committed evidence in `outputs/`.

The five SHA-256-pinned artifacts in `src/artifact-pins.ts` are `chi-squared-results.json`, `determinism-log.json`, `payout-coverage.json`, `simulation-results.json` and `rtp-convergence.html`, all under `outputs/`. The verification result itself is compared field by field instead of hash-pinned. `outputs/run/diff.json` records reproduction differences and runtime. Floating-point tolerance is **1e-14 absolute plus 1e-12 relative**; distinct integers never agree by tolerance.

| Exit | Meaning |
|---:|---|
| 0 | No hard failure or operator-origin flag, and committed evidence reproduced |
| 1 | Hard failure, reproduction mismatch beyond tolerance, or RTP claim-table mismatch |
| 2 | Operator-origin FLAG / Conditional Pass; the disclosed Step 4 capture flag does not trigger this exit |
| 5 | `RTP FIGURE OVERSTATED`: no draw check failed, but the RTP-CLAIM rule (1.2.0, switched on) found rows beyond the 0.1 pp band on the house side of their stated tier figure. It outranks a Conditional Pass; a hard failure (exit 1) outranks it |

For deliberate artifact maintenance only:

```sh
PF_EMIT=1 npm run simulate
PF_EMIT=1 npm run verify
```

These overwrite committed outputs. Review any changes, update affected hashes in `src/artifact-pins.ts`, and run normal verification again until the intended evidence reproduces. Step 21 checks the artifacts present when verification begins, so a refresh performed with stale pins must be followed by another verification after the pins are corrected. Do not change dataset pins or tolerances merely to silence a mismatch.

To refresh only the RTP claim table after a reviewed metadata or calculation change:

```sh
npm run rtp-claim:write
# update RTP_CLAIM_TABLE_SHA256 in src/rtp-settings.ts with the printed digest
npm run verify
npm run release-manifest
node scripts/release-manifest.mjs --check
```

The release generator requires both README.md and MANIFEST.md and checks their audit ID. This consolidated overview keeps that contract. If profile-coverage documentation references change, deliberately regenerate the verification result after reviewing those metadata changes, then confirm normal reproduction; numerical results should not change for a documentation-only edit.

To compare the current ProvablyFair.org player verifier with the saved bytes:

```sh
node scripts/check-site-verifier.mjs --live
```

This read-only network check retrieves the player-verification page and the three pinned JavaScript chunks. A mismatch means live parity has not been established for that deployment; it does not automatically establish an incorrect draw. An unavailable network is a check limitation. A local site checkout can be compared by passing its `src/components/VerifyBets/games/keno/derive.js` path instead. These checks supplement the offline comparisons in Step 23.

## Verify a bet

**Before betting, save the commitment** (the active server-seed hash shown in the fairness modal) somewhere you control. After rotation, obtain the revealed server seed. In the captured flow, the fairness modal displayed the client seed, nonce and server-seed hashes; the transaction detail later exposed `server_seed`. Save the round's `selected_positions`, difficulty, stake, `drawn_numbers`, multiplier and return. Difficulty maps 1=CLASSIC, 2=LOW, 3=MEDIUM, 4=HIGH.

1. Decode the 64-character server seed as 32 bytes. Its SHA-256 must equal the commitment **you saved before betting**; hashing the hex text is different. A PASS here means hash equality: the revealed seed is consistent with that commitment. Assurance that the seed was fixed before your bet comes from your earlier saved record, not from the match; a hash read only after the round supports consistency without that timing assurance.
2. Start `a=[1,2,…,40]`. For step `s=0` to `38`, set `i=39−s`, `range=i+1` and `LIMIT=floor(2³²/range)×range` ([`docs/ALGORITHM.md`](docs/ALGORITHM.md) §2).
3. Compute HMAC-SHA256 with the decoded seed as key and `clientSeed:nonce:s` as message. Read eight big-endian uint32 chunks. Take the first value strictly below `LIMIT`, set `j=value % range`, and swap `a[i]` and `a[j]`. (Duel's own Verify-tab code uses the ceiling `0xFFFFFFFF−(0xFFFFFFFF % range)`, which is `range` lower on the ranges 2, 4, 8, 16 and 32, and moves to the next counter value if every chunk rejects; see "Where the draw code comes from". No captured bet reaches either case.)
4. Take the first ten entries of `a`. Compare these ten numbers with the served draw **as a set**, not an ordered list. Count hits from the intersection with your selected positions.
5. For a round governed by the **captured April configuration**, select `kenoConfig.json → data.multipliers[RISK][picks][hits]`, round the multiplier to 13 decimal places, and compare stake × multiplier exactly with the recorded gross return. That saved table must not price an arbitrary current bet with stake scaling; current payout verification requires the configuration and scaling rules applicable to that round.

Worked captured vector: server seed `94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9`, client seed `dAn1wtkuDAXxQOKP`, nonce `0`. Commitment: `111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a`. Expected drawn set: **{1, 7, 8, 9, 11, 22, 25, 27, 29, 32}**. Bet 34309684 selected {6, 7, 20, 22, 30, 32, 35, 37}; three hits on HIGH/picks 8 select the April table's zero multiplier.

`src/rng.ts`, `src/loader.ts` and `src/money.ts` implement draw generation, hit counting and exact settlement. A matching draw verifies that recorded round against the supplied inputs; it does not, by itself, establish that its commitment was published before betting or that every other round is fair.

## Evidence

The primary evidence is the **11 April 2026 capture of 5,100 bets**, its revealed seeds and pinned base-tier configuration. Screenshots illustrate particular interface states; they do not replace the recorded responses or establish current live behavior. **E03 and E05–E10 come from the original March capture, not the April dataset.** E05–E10 have file timestamps of 23 March 2026; their seeds and E10's bet ID do not occur in the April dataset. E05–E08 were separately recomputed on 25 September 2026 and matched the highlighted draws. Their historical “Phase A–D start” filenames are retained for provenance.

| ID | Preserved file | Evidence and limits |
|---|---|---|
| E01 | [Keno game UI](evidence/E01-keno-game-ui.png) | Forty-number board, risk and stake controls, Autopick and Manual/Auto tabs. The capture did not exercise Autopick. |
| E02 | [Fairness overview](evidence/E02-fairness-page-overview.png) | Player-facing fairness interface and location of seed information. |
| E03 | [Operator verification page](evidence/E03-fairness-verify-keno.png) | March illustration using E05's inputs. The Code panel is collapsed; this image does not expose the shuffle implementation. Full source is E13. |
| E04 | [Active commitment](evidence/E04-active-commitment.png) | Illustrative only: shows where the fairness panel displays the active and next hashed server seeds. Its seed (client `6DeoGbx4RooE2dgA`, active hash `1ae051af…`, nonce 81) has no recorded bets in the April dataset, so it is not pre-bet evidence for any recorded round. |
| E05 | [Historical Phase A start](evidence/E05-phase-a-start.png) | March verifier example: client `WEDPt3bHwL`, nonce 0; draw 6, 8, 9, 12, 17, 19, 24, 28, 30, 36. |
| E06 | [Historical Phase B start](evidence/E06-phase-b-start.png) | March example: client `eLrBcz85Ij`, nonce 0; draw 3, 6, 12, 13, 18, 25, 29, 37, 38, 40. |
| E07 | [Historical Phase C start](evidence/E07-phase-c-start.png) | March example: client `zNIRkEg0tQ`, nonce 0; draw 4, 7, 17, 21, 24, 25, 30, 34, 35, 38. |
| E08 | [Historical Phase D start](evidence/E08-phase-d-start.png) | March example: client `enjQ9TTeg2`, nonce 0; draw 3, 5, 7, 12, 26, 27, 29, 31, 35, 39. |
| E09 | [Seed rotation](evidence/E09-seed-rotation.png) | March modal: active client seed, truncated active and next server hashes, nonce 0, prefilled 16-character replacement seed and Rotate control. It does not show full hashes or a revealed previous seed. |
| E10 | [Historical bet detail](evidence/E10-bet-history.png) | March bet **467277923**, absent from the April dataset: High risk, picks 17/25/33/37/38, zero hits and zero payout. Illustrates access to a bet's picks, draw, multiplier and fairness fields. |
| E11 | [Rotation response](evidence/E11-client-seed-rotation-response.png) | Illustrative only. Its footer reads duel.com/dice, 2 April 2026, and its seeds (client `ZoSxIKDtqSCyw69T`, active hash `497818ad…`) have no recorded bets in the April Keno dataset. It shows the response shape: the endpoint echoes the submitted client seed and returns active/next commitments and nonce 0. The pass annotation and commitment-timing statements printed beneath the response are not timing evidence for any audited round; forward-chain equality is a consistency check, and timing rests on the capture's recorded pre-bet observations (see [Limitations and trust](#limitations-and-trust)). |
| E12 | [Browser generator source](evidence/client-seed-origin.png) | Captured **3 June 2026**, after the audit dataset: the replacement-seed UI generates 16 characters from a 63-character alphabet using rejection-sampled `crypto.getRandomValues`. The capture rig used its own different generator. |
| E13 | [Operator Verify-tab source](evidence/verify-tab/duel-verify-tab-keno-2026-09-25.js) | Copied verbatim by Paulo on **25 September 2026**, 3,138 bytes/95 lines. Pinned and executed unmodified on all 5,100 captured bets as a second check; shuffled draw order matches `src/rng.ts`, and the drawn set matches the capture. Not the source of `src/rng.ts`, which is rebuilt from `docs/ALGORITHM.md`; through v1.1.0 `src/rng.ts` was ported from it and cited it line by line. This does not establish execution by the live Verify button or game server. |
| E14 | [Live configuration response](evidence/keno-config-live-2026-10-05.json) | Live `/api/v2/keno/config` response, fetched from duel.com on 5 October 2026 at 12:16:02 UTC in a logged-in session (read-only GET); HTTP 200; saved byte for byte, SHA-256 `787f9bad764a1cf5a8db9b7d166582b072c197a7ffd8eda6019d6c3817478d84`. The [fetch record](evidence/keno-config-live-2026-10-05.meta.json) holds the request path, status, response headers and fetch time, SHA-256 `71a685bb12afab19a2acfb2177b4012be37840174a5e03c6ff2fcca4dbbf64da`. Not part of the scored capture. Since 14 October 2026 it is the source of the RTP claim: the `house_edge` it states for each stake tier (kind `tiered`, decision D2), scored on Step 17 through the claim table. |
| E15 | [Edge/RTP claim page read](evidence/keno-edge-claim-read-2026-10-05.md) | Record of Duel's keno game page, fairness page, /wtf-duel help page and /about/zero-edge, read on 5 October 2026 (about 19:10 UTC) in a logged-in session, read-only, no bet, with the relevant page text quoted. The only numeric figure shown is the site-wide "we stand at 99.9%" on /wtf-duel. SHA-256 `ac45a8142bb18a4f7a9ccad86e46585e840d87dc93be451bba9e7a1a8206780e`. Source of the site-wide 99.9% line, noted and not tested (decision D3); it was the source of the flat RTP claim from 5 to 14 October 2026. Informational, not part of the scored capture. |

The full server seeds for the four historical verifier examples are preserved here for reproduction:

| Exhibit | Server seed |
|---|---|
| E05 | `6a20372a41fc09c8586db11f000a86cc9be2571c94ff967293d9deadb5d8d8c9` |
| E06 | `412c28eeab8fcdd2ca764c8a9f4cb6ffadefedd2f6466e8f835409791fee0c6d` |
| E07 | `57fa7368fa3ef962fbe1b17ffcddb020d2708a305be31165411d12a40840a68e` |
| E08 | `f54ab4cffcd36a462fc5727264c2060dceecb76fd66d9a3e1208a21283bd0741` |

E05's server-seed field is truncated in the image; its tail is taken from the visible Code panel. The earlier description incorrectly substituted an April client seed for the one shown.

E10's username and avatar were masked on **1 October 2026** with a solid box; the recorded pixel comparison found no changes outside it. Original SHA-256: `263b61445ded96c62c6e79d912c7f898026468b79cdcd91874f4fcec49bac531`; retained masked image: `e0d54796ca6a69abf48c6fdd2691c873876908e94c26a240687c79a2bcb5d3c4`. Verification steps do not read or hash screenshots. E13's SHA-256 is `b75c1ca2667dceef790b574decff8a91506b0bce829b0af47fb1cb22e254930b`; `src/operator-verifier.ts` pins both it and [its runner](verifier-parity/operator/run-operator-verifier.cjs).

### Files supporting the recorded result

| File | Role |
|---|---|
| [April dataset](data/keno-master-5100bets.json) | 5,100 bets and 106 seed records, all of which carry a plaintext (102 distinct; `seeds[0]`'s was added after capture); identity checked before verification. |
| [Captured configuration](kenoConfig.json) | Forty risk/pick configurations at the captured base tier; the package retains no record of the original fetch URL. |
| [Verification results](outputs/verification-results.json) | Twenty-three scored results with origins, profile mappings and informational statistics; compared field by field with fresh output. |
| [Determinism log](outputs/determinism-log.json) | 5,100 verified draws, zero mismatches and zero skipped captured bets. |
| [Live distribution results](outputs/chi-squared-results.json) | Observed and expected hit counts and goodness-of-fit statistics by configuration. |
| [Payout coverage](outputs/payout-coverage.json) | The 190 exercised cells and 70 unobserved cells, including their contribution to theoretical RTP. |
| [Simulation results](outputs/simulation-results.json) | Pinned Pass 1 streams and Pass 2 casino-seed results; distinct from live bet observations. |
| [Convergence chart](outputs/rtp-convergence.html) | Self-contained presentation of the recorded Pass 1 series. |
| [RTP claim table](outputs/rtp-claim-table.json) | Exact RTPs, each held to the edge Duel's game settings (E14) state for its stake tier: the 40 audited configurations (0.1% tier) on the 13-decimal served multipliers and the 2,672 tiers of E14; RTP-CLAIM 1.2.0, scored on Step 17. |
| [Release manifest](RELEASE-MANIFEST.json) | Release identity, artifact hashes, recorded score and mutation-run record. |

Dataset SHA-256: `841755fdfb268d7796017212f08a18bfea7615c30a4590dd29793b34c5e6bcf9`. Configuration SHA-256: `efd3c645c4b3956199fde62dd65446c08e4605763d2d0f34c97a226bdbae4f91`. Five supporting artifacts are pinned in `src/artifact-pins.ts`; the RTP claim table has its own pin. Ordinary runs write to `outputs/run/`, preserving the committed evidence. The release manifest records hashes for all nine primary data/result files, and for four further files: the E14 live configuration response (the source of the RTP claim), its fetch record, `outputs/live-config-scaling.json` (informational) and the E15 page-read record.

## Limitations and trust

The recorded **Full Pass** describes reproduction and consistency within the captured April base-tier rules. It does not establish the present live configuration, every stake or account, unseen payout cells, or the operator's original seed entropy. Stake scaling is outside this audit. A commitment makes substitution detectable when the original commitment is retained; it does not prove unbiased seed selection. No public-randomness beacon participates in this Keno draw.

The forward-link checks establish consistency within the retained capture: 105 successive links plus the pre-capture anchor, 106/106. Hash matching and forward links show that the seed records fit together; a pair constructed after settlement would also pass them, so they do not show when a commitment was shown. That each commitment was shown before its epoch's bets rests on the capture's recorded pre-bet observations: the capture recorded each epoch's active commitment in the rotation response that opened it, and that rotation record's timestamp precedes the epoch's first bet for 102/102 bet-bearing epochs (measured for this release, not scored). That timestamp dates the recorded commitment only: `seeds[0]`'s plaintext was added on 17 April 2026 (see [Dataset and capture](#dataset-and-capture)). The first rotation record also carries the hash the capture read as "next" before that rotation, equal to the first epoch's active hash. This timing holds only to the extent the capture is a faithful record of what Duel served, which this package assumes (K1). It is distinct from independent timestamped attestation that every commitment was publicly available before betting. The original recommendations included better pre-bet logging; that remains an evidence boundary, not a new failure.

### Declared limitations register

These retain the original IDs and recorded scoring treatment. The source report discloses coverage that predated its September standard; it does not require a new capture to reproduce the existing result.

| ID | Recorded limitation and magnitude |
|---|---|
| **DL-1** | Two capture retries omitted Phase B nonce **7** in epoch `505951bc32b6b0de…` and Phase C nonce **43** in epoch `5169f71b50f18b74…`; each epoch contains nonce 50. Expected missing draws can be derived from commitment-checked revealed seeds, but their unrecorded served responses cannot be compared. Step 4 is a **capture-origin FLAG**, verdict-neutral under the package's policy. |
| **DL-2** | No Autopick witnesses: the rig generated all picks using `Math.random`. UI screenshots show the control, not tested use or settlement. |
| **DL-3** | Phase D's two seeds were predictable `pfaudit` + base-36 timestamps: `pfauditmntnvgkk` (**2026-04-11T01:33:41.924Z**) and `pfauditmntnwjdi` (**01:34:32.214Z**), 50 bets each. Correct replay does not demonstrate protection from an operator anticipating these seeds. |
| **DL-4** | Phases A–C used 100 distinct 16-character seeds generated by the rig's `Math.random`, not a CSPRNG. E12's later browser generator is separate evidence. |
| **DL-5** | Elevated-stake coverage is 100 bets at $10, all MEDIUM/picks=10; **43 paid**, below the profile's 100-paying-bet floor. Extrapolation beyond those witnesses is recorded as **ASSUMED**. |
| **DL-6** | Phase A covers 32 configurations, picks 2–9. Phases B/C supply picks 1/10, yielding all 40 configurations overall with at least **73 bets** each. |
| **DL-7** | Exact table-literal RTP equals 999/1000 on **16/40** configurations. The remaining 24 differ by at most **1.125×10⁻¹⁶**, HIGH/picks=10; no printed RTP figure changes. |
| **DL-8** | Payments use multipliers rounded to **13 decimal places**. The worst exact RTP difference from 999/1000 on those paid multipliers is **7.21×10⁻¹⁵**, LOW/picks=10; no printed figure changes. |
| **DL-9** | The pinned April configuration has `scaling_edge=[]` and every captured bet reports `effective_edge=0.1`. Every captured stake ($0.01 or $10) is also below the lowest threshold ($90.20) in the duel.com Keno configuration as fetched on 5 October 2026 in a logged-in session (read-only GET), and in that configuration MEDIUM/picks=10 reaches its maximum bet before any scaled tier, so the capture alone cannot show whether a ladder was live in April. Scaling is present in that configuration; its start date is unknown. That configuration (E14) is packaged as informational evidence. Settlement on scaled tiers is not witnessed, and this certification does not extend to them. |
| **DL-10** | E03/E05–E10 illustrate the March capture. Their seeds and bet ID are absent from April data; the four March verifier examples were separately checked. |
| **DL-11** | The runs test is degenerate on **eight** simulated configurations, picks 1/2 at each risk: z=0 and p=1 by construction. Their serial check instead relies on the separately re-derived lag-1 statistic. |

### Premises and remaining scope

| ID | What the evidence supports |
|---|---|
| **K1** | Recorded seed hashes, forward links and capture timeline agree. A wrong reveal or broken link fails. Hash and link matches are consistency checks; pre-bet timing rests on the capture's recorded observations, and the capture's integrity as a record of what Duel served is assumed. Retained chronology is not independent timestamp attestation. |
| **K2** | All 5,100 captured draws reproduce from server seed, client seed and nonce; altered-client-seed controls change them. This witnesses the captured algorithm's inputs. |
| **K3** | The configuration matches the **190/260** payout cells reached by live play. The other **70 cells**, carrying **14.92% of theoretical RTP**, remain unobserved payment paths; their use by the operator is assumed. |
| **K4** | E13's published code matches the captured results. Execution of those exact bytes by the operator's live button and server is assumed. |
| **K5** | Elevated-stake settlement is witnessed by 43 paying bets; broader extrapolation is assumed. |
| **K6** | Autopick settlement equivalence is assumed, with zero captured Autopick witnesses. |

The report's **R-MULTI** covers cross-account behavior; **R-SERVER** covers operator seed-generation hardware/entropy. **R-BRACKET** covers adversarial payout/input boundary testing, not certification of scaled stake tiers. **R-CONFIG** separates the conditional mathematical proof from a review of the operator's payout-table business decisions. These are scope boundaries rather than additional findings or a required improvement backlog.

The phase-ordered live sample mixes different hit-count distributions; its aggregate serial correlations are not directly evidence of RNG manipulation. Simulation and the documented seed-selection tests found no signal under their tested rules, not proof that all selection strategies are impossible. High variance remains material to players; 99.9% theoretical RTP is not a promised session return. The 0.71× and 0.41× zero-hit returns for LOW/MEDIUM one-pick bets are partial refunds, still net losses.

## Terms
**RTP:** expected or observed return divided by stake; label which one is meant. **House edge:** one minus theoretical RTP. **Hit:** a selected number present in the draw. **Epoch:** one seed lifecycle; this capture records 50 bets per used epoch, with the disclosed retry exceptions. **Nonce:** round counter. **Cursor:** HMAC/shuffle counter. **Commit-reveal:** commit a hash, later disclose the seed for comparison. **Rejection sampling:** discard values outside the accepted interval. **Hypergeometric distribution:** hit-count probabilities for sampling without replacement. **Chi-squared test:** compare observed and expected counts. **Seed selection:** choosing among candidate server seeds before commitment; outcome replay alone does not test that choice.

## Release history
The original report was published **4 June 2026**, with original March material and the April recapture. The supplied source package labels its expanded release **v1.1.0** (October 2026), superseding v1.0.0. Its recorded result remains **22 PASS, one capture-origin FLAG, zero hard failures across 23 steps**. The release `v1.1.0` and its signature (`SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`) are recorded in the RELEASE-MANIFEST.json of the signed `v1.1.0` tag of ProvablyFair-org/duel-keno. This package's [release manifest](RELEASE-MANIFEST.json) describes `v1.2.1`.

The expanded package adds draw-bias and player-verifier checks, release metadata and a mutation battery. Step 4 now exposes the same two capture-retry gaps as a capture-origin flag, without changing the verdict. The dataset remains byte-identical to the prior release. The RTP claim table holds every row of the audited table and of the 5 October 2026 configuration to the edge Duel's game settings state for its stake tier; since 14 October 2026 the rule is switched on and its outcome is scored on Step 17 (see the 14 October 2026 entries below).

**PV-1 is closed.** On 25 September 2026, a stale local ProvablyFair.org docs-site build (`repotree-sync` at `2ad89bc`) differed from the audited table on **106/260 cells** and **1,472/5,100** captured multipliers. The site's main at `bd4d59c` carried the correct table: **0/260** cell differences, **0/5,100** multiplier differences, and **5,100/5,100** matching draw sets. Its bytes were vendored for Step 23. This was a local site-build finding, never an operator finding; deployment of the stale build to players was not established. On 5 October 2026 at 19:17 UTC the deployed docs-site verifier, audit.provablyfair.org/casino/duel/tools/verify-bets, was fetched read-only with its main bundle and all 26 chunks its runtime lists: the one chunk carrying a Keno paytable (`cacca72b.43f45f69.js`, SHA-256 `290d1304e931e6b64b9c08b4226edee8ee3ceac17a129b2006dc903c20f50ef4`) equals the audited table on 260/260 cells and differs from the stale `repotree-sync` table on 106/260, so the stale table was not being served there that day; earlier deployments were not checked.

On **29 September 2026**, Chart.js **4.4.7** was inlined into the convergence chart from the lockfile-pinned npm package, removing its CDN dependency without changing chart figures. E10's **1 October** privacy masking and both image hashes are preserved in the evidence section above. The September evidence corrections distinguish the collapsed E03 panel from full source E13, and the March screenshot inputs from the April dataset.

### 21 October 2026 — `.gitattributes` (v1.2.1, errata)

- v1.2.1: adds `.gitattributes` (`* -text`) so a Windows git clone keeps every file byte-identical; no audit content changed.

### 21 October 2026 — review corrections (v1.2.0)

No draw check, scored step status, figure, verdict or artifact changed; the dataset, `kenoConfig.json`, the pinned artifacts and the RTP claim table are byte for byte as they were.

- **Release labels.** The README and this overview name `v1.2.0`; `package.json` and `package-lock.json` say 1.2.0; the release manifest's `release` field says `v1.2.0` (was `v1.2.0-draft`). The release history says where v1.1.0's signature is recorded: in the RELEASE-MANIFEST.json of the signed `v1.1.0` tag.
- **Step 22 figures.** The paragraph after the nonce flag still gave the port's ceiling (largest rejection 32 values at range 32). It now gives the rebuilt module's, as Step 22 prints: 22 values at range 39, none on the five power-of-two ranges.
- **Unit-test count.** [Reproduce the audit](#reproduce-the-audit) said 29 Mocha tests; `npm test` runs 30, as the README says.
- **Exhibit roles.** The E14 row called the 5 October configuration informational and the E15 row called the page read the source of the RTP claim. Since 14 October 2026 E14 is the claim's source (kind `tiered`, decision D2) and E15 holds the site-wide line that is noted, not tested; both rows and the release generator's comments now say so.
- **19 October entry.** It said the Pass 1 description in `outputs/simulation-results.json` was left reading "Validates independent implementation". That run had in fact rewritten it and re-pinned the file; the entry now says so.
- The release manifest was refreshed with `npm run release-manifest`.
- **Release wording.** At tagging, the README, this overview and the release manifest stopped describing `v1.2.0` as a draft until tagged. The release manifest records `v1.2.0`, superseding `v1.1.0`, and the fingerprint of the ProvablyFair.org signing key (`signature`, `SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`), as tagged `v1.2.0`; it was refreshed with `npm run release-manifest`. No check, figure or verdict changed.

### 20 October 2026 — RNG rebuilt from a written specification (v1.2.0)

The verdict, the scored-step statuses (22 PASS, 1 capture-origin FLAG, 0 hard fails) and the dataset are unchanged. Through v1.1.0, `src/rng.ts` was ported from Duel's published Verify-tab code (E13). A port can copy the casino's own mistake into the check of it, so the RNG is now rebuilt from a written specification instead.

- **Specification.** [`docs/ALGORITHM.md`](docs/ALGORITHM.md), a copy of the ProvablyFair.org framework's `games/keno/ALGORITHM.md` (SHA-256 `f0f70652…df235d35`) with the spec author's workspace paths replaced by package paths or neutral wording (its header says so). It was written from Duel's public pages, the result grids of Duel's Verify page, the standard provably-fair construction and the 5,100 live bets, without opening Duel's code; its §4 gives the source of every step and its §8 lists every file read.
- **Rebuild.** `src/rng.ts` was written by an implementer who read only that specification and an interface file and never opened Duel's code or the earlier `src/rng.ts`. Its body is that implementer's file byte for byte; only a provenance header was added. Its self-test is now a unit test, `tests/keno/RngSpecTests.ts` (79/79).
- **Duel's code is a second check, not the source.** Step 23 and the unit tests still run Duel's Verify-tab file byte for byte on all 5,100 bets: 5,100/5,100 drawn sets agree with the served draw, and 5,100/5,100 draws agree with `src/rng.ts` in shuffle order. The 18-line citation table of the port (`OPERATOR_SOURCE_CITES`), its check in Step 23 and the unit tests are removed. Mutation M23g, which broke a citation, now returns the draw out of shuffle order, which only the in-order comparison with Duel's code can see; M06, M22 and M22b were retargeted to the same edits in the rebuilt code. The registry still holds 53 entries.
- **Three-way agreement.** Measured on integration over the 5,100 captured bets: `src/rng.ts` against the served bets (commitment 5,100/5,100, drawn set 5,100/5,100; in served order 0/5,100, because the served order is not the shuffle order, specification §2.3), against Duel's Verify-tab code (5,100/5,100 as a set and in order) and against the ProvablyFair.org live verifier (5,100/5,100 as a set and in order). Steps 1, 5 and 23 re-measure it on every `npm test`. No step was added.
- **Two differences from Duel's code, off the captured data.** On the ranges 2, 4, 8, 16 and 32 the specification's ceiling is 2³² where Duel's is `2³² − range`, and when all eight chunks of a step are rejected `src/rng.ts` throws where Duel's code hashes the next counter value (specification O2). Neither occurs in the 198,900 captured shuffle steps; the first changes the drawn set on 2 of 4 searched inputs (see "Where the draw code comes from"), and a new unit test pins those four.
- **Step 22.** The enumeration now reads the rebuilt ceiling: the five power-of-two ranges reject 0 values instead of `range`, the largest per-chunk rejection is 22 values at range 39 (was 32 at range 32), and the expected rejected chunks per draw are 298/2³² (was 360/2³²). Exactness holds on all 39 ranges either way; the step still passes.
- **Artifacts.** `outputs/simulation-results.json` and `outputs/rtp-convergence.html` were regenerated with `PF_EMIT=1 npm run simulate` and re-pinned (`c8543cce…` and `ceb2f732…`, previously `1401c862…` and `3c34df21…`). Besides the Pass 1 description, two of the 40,000,000 Pass 1 rounds drew a different set: configuration 8 nonce 261486 and configuration 13 nonce 628473, in each of which the step-8 (range 32) first chunk lies in the window where Duel's ceiling rejects and the specification's accepts. Only the fields that depend on those two rounds moved (configuration 8's number counts and uniformity statistics; configuration 13's hit and number counts, chi-squared and p values, simulated RTP and serial statistics; Pass 1's average RTP and the 1M point of the convergence chart, 99.97041044% to 99.97041599%); Pass 2 and every other field are unchanged, and `chi-squared-results.json`, `determinism-log.json` and `payout-coverage.json` are byte-identical. `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify`, and the release manifest written by `npm run release-manifest` as `v1.2.0-draft`, unsigned, superseding v1.1.0. The mutation battery was rerun in full: 53/53 killed, 23/23 scored steps covered.

### 4 October 2026 — consolidated documentation and publication corrections

The 20 Markdown documents were reduced to **README.md and this MANIFEST.md**. Repeated explanations and superseded examples were removed; evidence files, the captured dataset, paytable, draw and settlement logic were retained. The overview keeps the verification procedures, evidence register, limitations and historical findings together. Documentation references in the profile-coverage map now point to the retained sections.

The player-facing 99.9% RTP / 0.1% edge statements now identify the **captured April 2026 base-tier configuration** and exclude later stake scaling. The printed RTP method now uses `C(40−n,10−k)`, matching the existing calculation, instead of a constant non-selected population of 30. The RTP table was regenerated and re-pinned; every numerical result row is unchanged. Dependent release hashes were refreshed. The mutation battery now copies the RTP claim table into its workspace and was rerun in full: 49/49. A provenance note for `seeds[0]` was added. No new casino capture or full simulation regeneration is asserted for this update.

### 5 October 2026 — live configuration evidence

The duel.com Keno configuration as fetched on 5 October 2026 in a logged-in session (read-only GET) was added as informational evidence E14, with its fetch record. `npm run live-config` ([src/live-config.ts](src/live-config.ts)) recomputes its tiers into [outputs/live-config-scaling.json](outputs/live-config-scaling.json), and the release manifest now hashes all three files. The README scope, the conclusion, the payout-coverage note, DL-9 and the new [Current live configuration as of 5 October 2026](#current-live-configuration-as-of-5-october-2026) subsection describe that configuration. This update changes no scored step and leaves the dataset and `kenoConfig.json` byte for byte as they were. Two coverage notes in `outputs/verification-results.json` were reworded and the RTP-CLAIM rule moved to version 1.1.0, which adds a no-claim kind; no result changed (the two later 5 October entries below reword the Step 2 and Step 4 detail strings and re-source the RTP claim). The mutation battery was rerun in full on 5 October 2026: 49/49. Apart from that one configuration fetch, no new casino capture or full simulation regeneration is asserted for this update.

### 5 October 2026 — commitment timing wording

Hash matching and forward links are now described as consistency checks, and pre-bet timing is attributed to the capture's recorded observations, conditional on capture integrity (K1). The player procedure now compares the revealed seed with the commitment saved before betting. E04 and E11 are labelled illustrative: their seeds have no recorded bets in the April dataset. The Step 2 and Step 4 detail strings were reworded to match, so `outputs/verification-results.json` was regenerated and its release-manifest hash refreshed. No verdict, step status or number changed.

### 5 October 2026 — RTP claim tied to the figure Duel shows

Under RTP-CLAIM rule 1.1.0 the claim now comes from the figure Duel shows players, not from the captured `effective_edge`. Duel's pages as read on 5 October 2026 were added as E15. The claim is flat 99.9%, sourced to the site-wide figure on the /wtf-duel help page; the keno game page and the fairness page show no figure. The claim table now also covers every tier of the 5 October 2026 configuration (E14): the claim holds on the audited table and on the live 0.1% tier, and 2,294 of the 2,632 scaled tiers fall more than 0.1 pp below it (see [RTP claim as shown to players](#rtp-claim-as-shown-to-players)). The comparison stayed informational until 14 October 2026, when the rule was switched on (see below). The table was regenerated and re-pinned, and the release manifest now also hashes E15. The mutation battery was rerun in full on this state: 49/49. PV-1 gains the 5 October check of the deployed docs-site verifier. No scored step, verdict, dataset, `kenoConfig.json` or `outputs/verification-results.json` changed.

### 6 October 2026 — seed-record and captured-edge wording

Step 1's detail called all 106 seed records revealed and its three skipped records end-of-phase rotations. Step 1 reads the plaintexts of records 1–105, not `seeds[0]`'s, whose 17 April fill stays disclosed under [Dataset and capture](#dataset-and-capture). The three skipped records are the first rotations of Phases B, C and D. Each repeats the plaintext and source transaction of the record before it, because the rig read the same last transaction at the end of one phase and the start of the next, so the seeds of the bet-less epochs at the ends of Phases A, B and C are not in the dataset; nor is the seed of the last record, at the end of Phase D, which no rotation followed. Step 1's detail now says so, and the step also counts those repeats (3 of 3) and the commitments with no revealed plaintext (4, none with bets), without changing its pass condition. The dataset section, seed lifecycle, Step 1 row, file table, the commitment-timing paragraph and the KENO-01 note were reworded to match. Step 11 is renamed Captured Edge Fields, and its detail now limits the flat-edge result to the two captured stakes, $0.01 and $10. The KENO-31 notes no longer date the scaling ladder to after the capture, matching DL-9 (start date unknown), and cite E14 for the 5 October 2026 configuration. The scope sentences in the README, the conclusion, Payouts and RTP, Limitations and trust, and the verifier-comparison paragraph no longer call stake scaling later. `outputs/verification-results.json` was regenerated and its release-manifest hash refreshed. The mutation battery was rerun in full on this state: 49/49. No verdict, step status, dataset, `kenoConfig.json` or pinned artifact changed.

### 19 October 2026 — review corrections

No verdict, scored step status, RTP figure or pinned artifact changed. The dataset, `kenoConfig.json`, the five artifacts pinned in `src/artifact-pins.ts` and the RTP claim table are byte for byte as they were.

- **Draw code provenance.** The overview was changed to say that `src/rng.ts` was then ported from Duel's published Verify-tab code and was not an independent implementation, and the header of `src/simulate.ts` stopped calling it independent. The Pass 1 description in `outputs/simulation-results.json`, which read "Validates independent implementation", was regenerated with `PF_EMIT=1 npm run simulate` to say the draw code was ported from Duel's Verify-tab code, and the file was re-pinned (`574f961b…` to `1401c862…`; that string was the only change). This entry first said the string was left unchanged; that was wrong (corrected 21 October 2026). Since v1.2.0 the draw code is rebuilt from a written specification (20 October above).
- **RTP claim in the results file.** Step 17's record in `outputs/verification-results.json` now carries an `rtpClaim` field with the rule's outcome (pass, 0 of 2,712 rows beyond the band). The text that called the claim comparison informational now says it is scored on Step 17.
- **Largest table cell.** Step 12 now lists every cell holding the largest value: 1,200× is held by four cells (LOW/10/10, MEDIUM/10/10, HIGH/9/9, HIGH/10/10), not one.
- **Smaller corrections.** The captured-returns total is $959.55, rounded from $959.5457; the Test B rate is explained (0.05 used, nominal 0.0475); the S5-7 row carries its result label; the mutation count is given as 53 everywhere, with the two runs it comes from; the KENO-19, KENO-28, KENO-29 and KENO-30 notes were brought up to date; the README's draft-release sentence was removed.
- `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify` and the release manifest refreshed with `npm run release-manifest`. The mutation entries for the two steps whose code changed were rerun on this tree (`--only M12,M17`: 5/5 killed; `--only MC3`: 4/4 killed, MC3a and MC3b exit 5, MC3as and MC3bs exit 1). The whole battery was not rerun.

### 14 October 2026 (second pass) — an RTP miss ends RTP FIGURE OVERSTATED (FIXPASS2 class C3)

No verdict, scored step status, figure or artifact changed.

- **Exit-5 mutations.** `scripts/mutate.mjs` gained `regen` (in the disposable copy: the RTP table rewritten by `src/rtp-settings.ts` and re-pinned, then the committed record re-emitted with `PF_EMIT=1`), `expectExit` (an entry counts as killed only when the run also ends with that exit code) and runner `test` (mocha, then the verifier, as `npm test` runs them). New entries: MC3a (E14 row id 5530's 1-hit cell lowered 3.996 → 3.956, E14 re-pinned: 98.9 % against its tier's 99.9 %) and MC3b (E14 row id 5620's house_edge lowered 0.01 → 0.007, so its stated figure rises to 99.3 % against a paid 99.0 %), each with the table and record regenerated and expected to end RTP FIGURE OVERSTATED, exit 5. MC3as and MC3bs make the same changes without regenerating the table and are expected to end exit 1: a committed RTP table that differs from the run, or from its pin, is a reproduction failure, miss or no miss.
- **Battery (Apple M2 Max, 12 cores, Node v22.23.1).** The whole registry before the C3 entries, 49 entries, on 14 October 2026: 49/49 killed, 23/23 scored steps covered (above). A whole-registry run started on the evening of 14 October with the C3 entries in it was stopped (exit 143) before reaching them and is not counted. On 15 October `--only 'M17,MC3'` ran the four C3 entries and every entry naming Step 17, the RTP-claim step (M17, M17b, M17c): 7/7 killed; MC3a and MC3b ended `VERDICT: RTP FIGURE OVERSTATED`, exit 5; MC3as and MC3bs exit 1 with the committed table reported as differing from the run.

### 14 October 2026 — Methodology v1.1

No draw check, scored step status, figure or verdict changed. The dataset and the artifacts pinned in `src/artifact-pins.ts` are unchanged; the RTP-claim table, pinned in `src/rtp-settings.ts`, was rewritten and re-pinned (below).

- **Framework 1.1.** The audit is re-certified under ProvablyFair.org Framework 1.1 (decision D1); the release manifest's `framework` field and the release row above say 1.1.
- **RTP-CLAIM 1.2.0, switched on.** `src/rtp-claim.ts` is the framework's rule 1.2.0, byte-identical to `core/rtp-claim.ts` (SHA-256 `c9a9c1c4…5f131c`), and `src/rtp-claim-switch.ts` is set to true (decision D3). The claim is now kind `tiered` from the game settings (decision D2): each of the 2,712 rows is held to 1 minus the `house_edge` E14 states for the stake tier it is priced at (91 tiers, 0.1% to 1.0%; the April rows at the 0.1% tier). Outcome: pass, 0 rows beyond the band, where the former flat 99.9% claim had 2,294 house-side rows. The help page's site-wide 99.9% line is now noted, not tested (D3); see [RTP claim as shown to players](#rtp-claim-as-shown-to-players). The outcome is scored on Step 17 (KENO-19): a house-side miss would be an operator-origin FLAG on that step and the verdict RTP FIGURE OVERSTATED, exit 5, never NOT PROVABLY FAIR. In `outputs/rtp-claim-table.json` the `ruleVersion`, the claim, the setting-space text and each row's `tier`, gap, side and outcome changed; no RTP changed.
- **Profile.** The Keno profile version this suite cites is 1.0.2 (decision D6, approved as cited; the `-proposed` suffix is dropped, no check changed). In `outputs/verification-results.json` only `profileCoverage.profileVersion` changed.
- **S5 level.** The adversarial matrix states the S5 level received: the fairness-integrity matrix; game-integrity testing was not commissioned (decision D5).
- **Exit 5** (RTP FIGURE OVERSTATED) is added to the exit codes.
- `outputs/rtp-claim-table.json` was rewritten with `npm run rtp-claim:write` and re-pinned, `outputs/verification-results.json` regenerated with `PF_EMIT=1 npm run verify`, and the release manifest refreshed with `npm run release-manifest`. `npm run live-config` still reproduces `outputs/live-config-scaling.json` byte for byte. The mutation battery was rerun: 49/49 killed, 23/23 scored steps covered.

### Where the former chapters went

| Former documentation | Consolidated location |
|---|---|
| Executive summary and conclusion | Conclusion and scope; README |
| Game rules, system architecture, RNG algorithm and game-logic verifiability | Game and algorithm |
| Payout verification and RTP analysis | Payouts and RTP |
| Live parity, exploit testing, edge cases and findings | Verification results; Limitations and trust; Release history |
| Reproducibility guide and player check instructions | Reproduce the audit; Verify a bet |
| Evidence appendix | Evidence |
| Operator trust, recommendations and original limitations/premises | Limitations and trust |
| Glossary | Terms |
| Original summary/navigation | Contents; README |

/**
 * Which ProvablyFair.org Keno profile check each scored step implements.
 *
 * WHY THIS FILE EXISTS. The Keno profile (KENO-01 … KENO-32, profileVersion 1.0.2 —
 * approved 2026-10-14, Methodology v1.1 D6) declares the checks. This suite scores 23 steps
 * under its own numbering, which every chapter cites and which therefore cannot be renumbered.
 * The mapping is declared here, emitted into outputs/verification-results.json beside the step
 * results, and read back by `pf-audit matrix`.
 *
 * THIS FILE LABELS; IT DOES NOT CHECK. Nothing here can make a step pass or fail. A check is claimed
 * only where the step's assertion actually decides the profile's `asserts` text, read against the
 * CURRENT step code (2026-09-25), not against the profile's hand-read status block.
 *
 * COVERAGE DESCRIBES THE PACKAGE, NOT THE STEP.
 *   full    — nothing the profile's `asserts` requires is unimplemented; where a check is split
 *             across steps each says `full` and its note says which half it carries.
 *   partial — something the profile requires is implemented nowhere in this package; the note says
 *             what, and how it is classified (code / page-read / captured before the standard).
 */

export type Coverage = 'full' | 'partial';
export interface CheckClaim { id: string; coverage: Coverage; note?: string }
export interface StepClaims { claims: CheckClaim[]; reason?: string }

export const PROFILE_GAME = 'keno';
export const PROFILE_VERSION = '1.0.2';

const K06_PARTIAL = 'PARTIAL for one reason: the profile requires the Phase A–C client-seed generator to be a '
  + 'CSPRNG, and the capture rig\'s generateClientSeed (capture/capture-auto.reference.js) is Math.random(). '
  + 'Classified CAPTURED BEFORE THE STANDARD (capture 2026-04-11, dataset meta.createdAt; requirement from the '
  + '2026-09-23 standard); disclosed as MANIFEST DL-4. No verifier change can make the generator a CSPRNG. The '
  + 'predictable Phase D seeds (\'pfaudit\' + base-36 Date.now()) are enumerated with their epochs in Step 6 '
  + 'data.phaseDPredictableSeeds and disclosed as DL-3';

export const STEP_CLAIMS: Record<number, StepClaims> = {
  1: { claims: [
    { id: 'KENO-01', coverage: 'full', note: 'hash half — every revealed seed SHA-256(hexDecode) against the preceding commitment; '
      + '102 verified + 3 declared phase-start rotations = EXPECTED_CHAIN_LINKS 105 over EXPECTED_SEEDS 106 code constants, '
      + '0 records without a plaintext (counted, never skipped); Step 5 binds the verified seed map to EXPECTED_REVEALED_EPOCHS 102' },
    { id: 'KENO-05', coverage: 'full', note: 'seed-population half — seed records bound to EXPECTED_SEEDS 106' },
  ] },
  2: { claims: [{ id: 'KENO-02', coverage: 'full', note: '105/105 nextServerSeedHash → serverSeedHashed links recomputed from '
    + 'raw fields; pre-capture link seeds[0].nextSeedPromotion.previousNextHash verified; an absent link FAILs; the capture '
    + 'script\'s match flags are cross-checked, never trusted' }] },
  3: { claims: [{ id: 'KENO-03', coverage: 'full', note: 'epochs keyed by the capture timeline (groupByEpochWindow), not by the '
    + 'bets\' own hash: every bet in each of the 102 bet-bearing windows carries its rotation record\'s committed hash AND '
    + 'client seed; 0 orphans; 106/106 committed hashes pairwise distinct' }] },
  4: { claims: [{ id: 'KENO-04', coverage: 'full', note: 'nonces checked against the DECLARED base NONCE_BASE = 0 (src/loader.ts) '
    + 'and window EPOCH_SIZE 50: reorder/repeat in CAPTURE order (before any sort), gaps after sorting, one client seed per '
    + 'epoch, epoch count bound to 102 — all HARD FAIL. The capture-retry pattern (nonce 50 present, exactly one of 0–49 '
    + 'absent) is reconstructed from the revealed, commitment-matching seed and emitted as a FLAG with origin = capture: '
    + 'counted, limitation DL-1, verdict-neutral (Full Pass, exit 0) — never PASS. FAIL probed (M04, M04b)' }] },
  5: { claims: [
    { id: 'KENO-07', coverage: 'full', note: '5,100/5,100 recomputed as SETS (orderRecorded false — the API order is '
      + 'presentation-only); recomputed count bound to EXPECTED_BETS; an unrecomputable bet is a FAIL, not an exclusion' },
    { id: 'KENO-10', coverage: 'full', note: 'structure half — every SERVED drawn_numbers and every recomputed draw is exactly '
      + '10 distinct integers in 1–40 (a duplicate-padded served array FAILs even though its Set would compare equal); every '
      + 'pick set legal (1–10 distinct numbers in 1–40, request.picks = its size) and echoed unchanged with its difficulty. '
      + 'Hits counted from the recomputed draw: Steps 7, 8, 10. FAIL probed (M05c, M05d)' },
    { id: 'KENO-17', coverage: 'full', note: 'the derivation declares (key, clientSeed, nonce) as its only required parameters '
      + '(asserted: computeDrawFromBuffer.length === 3; message clientSeed:nonce:cursor) and recomputes every bet with the picks '
      + 'excluded, across the epochs in which bets under ONE seed pair carry different pick sets (counted, must be ≥ 1). '
      + 'FAIL probed (M05e)' },
    { id: 'KENO-01', coverage: 'full', note: 'reveal-coverage half — the verified seed map is bound to EXPECTED_REVEALED_EPOCHS 102' },
    { id: 'KENO-05', coverage: 'full', note: 'bet-population half — bets bound to EXPECTED_BETS 5,100' },
  ] },
  6: { claims: [{ id: 'KENO-06', coverage: 'partial', note: 'client-seed-influence half — a wrong client seed changes the draw '
    + 'on all 5,100 bets (model rate p = 1/C(40,10), E = 6.0e-6, E + 5σ admits 0 collisions, so the exact rule is kept) and '
    + 'the EMPTY-SEED CONTROL (clientSeed = "") changes all 5,100 on the same bound; FAIL probed (M06, M06b). Phase D '
    + 'recomputation: Steps 9, 18. ' + K06_PARTIAL }] },
  7: { claims: [
    { id: 'KENO-11', coverage: 'full', note: 'EXACT ON THE DECLARED SETTLEMENT RULE (measured on 5,100/5,100 before adoption, '
      + 'src/money.ts): amount_won == amount × round13(RECOMPUTED table cell) on integer units, no tolerance; every zero-cell '
      + 'bet credits exactly 0; amount_currency echoes the stake on the 18-dp grid; an off-grid string is an error. Replaces '
      + 'the relative 1e-12 on parsed doubles that multiplied the SERVED multiplier. FAIL probed (M07: a win moved by 1e-16; M07b: a forged win in a re-pinned dataset)' },
    { id: 'KENO-10', coverage: 'full', note: 'hit-counting half — hits = |picks ∩ RECOMPUTED draw|; the served draw is compared (Step 8), not used' },
  ] },
  8: { claims: [
    { id: 'KENO-13', coverage: 'full', note: 'the served multiplier STRING equals Number(cell.toFixed(13)).toString() of '
      + 'paytable[risk][picks][hits] from the pinned kenoConfig.json (display rounding declared: on 4,662 bets the cell is served '
      + 'at full precision, on 438 display-rounded, 0 mismatches), with hits from the recomputed draw; every one of the 40 (risk, picks) '
      + 'rows served is compared; the probabilities field is read by no derivation; origin declared = operator config '
      + 'endpoint (the package holds no fetch record of the URL — stated in the step). FAIL probed (M08)' },
    { id: 'KENO-10', coverage: 'full', note: 'comparison half — hits on the served draw must equal hits on the recomputed draw on every bet' },
  ] },
  9: { claims: [
    { id: 'KENO-12', coverage: 'partial', note: 'what IS asserted: all 100 elevated-stake ($10, 1,000× the $0.01 base) bets '
      + 'recompute, are served the same display-rounded cell as the $0.01 stake on a (risk, picks) row also played at $0.01, '
      + 'and settle by the same exact rule. PARTIAL for one reason: the floor is ≥ 100 elevated-stake PAYING bets and 43 of '
      + 'the 100 paid (MEDIUM picks=10); printed as ASSUMED (phaseDPayingFloorMet false), never silently passed. Searched: '
      + 'the dataset has exactly two stakes (0.01, 10) and 43 paying bets at 10. Classified CAPTURED BEFORE THE STANDARD; DL-5. '
      + 'The profile calls this Phase C; this capture labels it Phase D' },
    { id: 'KENO-06', coverage: 'partial', note: 'Phase D recomputation half — 100/100 Phase D bets on player-set seeds recompute. ' + K06_PARTIAL },
  ] },
  10: { claims: [{ id: 'KENO-15', coverage: 'partial', note: 'what IS asserted: all 40 configurations ≥ MIN_BETS_PER_CONFIG 50 '
    + '(leanest 73), asserted in code against the table; 190/260 cells reached, 14.92% of theoretical RTP on unreached cells '
    + 'printed; hits from the recomputed draw. PARTIAL for one reason: the profile asks PHASE A alone to cover every '
    + 'configuration, and this capture plan put picks 2–9 in Phase A (32 configs, leanest 73) and picks 1 / picks 10 in '
    + 'Phases B / C (printed: phaseACoversAllConfigs false). Classified CAPTURED BEFORE THE STANDARD; DL-6' }] },
  11: { claims: [], reason: 'declarationTruth witness for KENO-31, which is n/a-declared (gameModel.scalingEdge.presentAtCapture = '
    + 'false): the step reads the pinned config (scaling_edge = []) and requires served effective_edge 0.1 on 5,100/5,100 — a '
    + 'populated ladder or any other served edge FAILs it. It witnesses the two captured stakes ($0.01 and $10) only: both are '
    + 'below the lowest threshold ($90.20) of the 5 October 2026 configuration, so the capture cannot show whether a ladder '
    + 'applied above them in April. The ladder in that configuration (E14; start date unknown) is register item DL-9, never '
    + 'read into this population' },
  12: { claims: [{ id: 'KENO-14', coverage: 'full', note: 'every non-monotone cell of all 260 is ENUMERATED (consolation on 0 hits, '
    + 'zero between paying cells, a cell below its predecessor) and must equal the declared list — exactly LOW/1/0 0.71× and '
    + 'MEDIUM/1/0 0.41×; FAIL probed (M12, M12b). Cap half under proposed rule R2: '
    + 'no max-odds / max-payout / max-profit is declared by the package or carried by the pinned config (0 limit keys among its '
    + '8 data keys) — declared undeclared, n/a with that evidence; the largest cell value, 1,200×, held by four cells '
    + '(LOW/10/10, MEDIUM/10/10, HIGH/9/9, HIGH/10/10), every one of them listed, and the largest served multiplier 510 printed' }] },
  13: { claims: [{ id: 'KENO-05', coverage: 'full', note: 'bets / seeds / per-phase A 3000 B 1000 C 1000 D 100 and seeds 61/21/21/3 '
    + 'against src/loader.ts constants; the dataset header is never the denominator; no secondary dataset file exists' }] },
  14: { claims: [{ id: 'KENO-26', coverage: 'full', note: 'dataset AND kenoConfig.json SHA-256 checked before any step '
    + '(process.exit(1), tests/verify.ts); Step 14 re-confirms the dataset' }] },
  15: { claims: [{ id: 'KENO-05', coverage: 'full', note: '102 epochs × exactly EPOCH_SIZE 50, reconciled to 5,100' }] },
  16: { claims: [{ id: 'KENO-18', coverage: 'full', note: 'mode half — picks=10 mode of the independent hypergeometric law in {2, 3}' }] },
  17: { claims: [
    { id: 'KENO-18', coverage: 'full', note: 'EXACT: for every picks count 1–10, Σ_k C(n,k)·C(40−n,10−k) = C(40,10) and '
      + '40·Σ k·w(k) = n·10·C(40,10) in BigInt; the double P(k) used by every step equals the correctly rounded exact law '
      + '(0 mismatches); the operator probabilities field is never read; NEGATIVE CONTROLS in the step — a weight corrupted by '
      + 'one unit and a table cell corrupted by one unit in its last place are both rejected (a control not rejected FAILs). '
      + 'FAIL probed (M17: an unreached cell changed in a re-pinned config; M17b, M17c: the two controls neutered)' },
    { id: 'KENO-19', coverage: 'partial', note: 'what IS asserted: per-config RTP in exact rational arithmetic from the table '
      + 'literals, compared with 999/1000, spread printed (data.exact.perConfigDelta); 16 of 40 configs equal 999/1000 exactly, '
      + 'all 40 within 16ε (worst |Δ| 1.125e-16, HIGH/picks=10). THE CLAIM IS SCORED HERE: RTP-CLAIM 1.2.0 is switched on '
      + '(src/rtp-claim-switch.ts, decision D3, 14 Oct 2026) and holds every row of outputs/rtp-claim-table.json (the 40 '
      + 'April configs on their served 13-dp multipliers and every stake tier of E14) to 1 minus the edge Duel\'s game '
      + 'settings state for its tier, band 0.1 pp; a house-side row beyond the band makes this step an operator-origin FLAG '
      + 'and the verdict RTP FIGURE OVERSTATED, exit 5 (tests/verify.ts; outcome in this step\'s data.rtpClaim; FAIL probed '
      + 'MC3a, MC3b). PARTIAL for one reason: the profile makes ANY config whose derived RTP differs from the claim a FLAG; the '
      + 'rule flags only a difference beyond its 0.1 pp band, so the 24 configs that differ from 999/1000 by at most '
      + '1.125e-16 are disclosed with their magnitude as register item DL-7 (and the served 13-dp multipliers, worst |Δ| '
      + '7.2e-15, DL-8), not flagged' },
  ] },
  18: { claims: [{ id: 'KENO-06', coverage: 'partial', note: 'Phase D ≥ 2 distinct client seeds (2, one per Phase D epoch). ' + K06_PARTIAL }] },
  19: { claims: [{ id: 'KENO-20', coverage: 'full', note: '40 × 1,000,000 rounds on the 40 pinned seed pairs (src/sim-seeds.ts); '
    + 'every statistic re-derived in verify from the artifact\'s rows: hit-histogram chi²/p and simulated RTP (0/40 at '
    + 'Bonferroni); GRID UNIFORMITY with the without-replacement correction (X²·39/30 ~ χ²₃₉) from each row\'s shipped 40 '
    + 'per-number counts — 0/40 at Bonferroni, min p 0.0744; SERIAL: r1 re-derived EXACTLY (BigInt) from the histogram and '
    + 'shipped Σx_t·x_{t+1}, first, last (worst gap to the stored float 2.98e-14, bound 1e-9) and runs z / p recomputed from '
    + 'shipped runs / median / n1 — 0/40 at Bonferroni; REPLAY: the first 1,000 rounds of every config are replayed in verify '
    + 'and the 1K convergence point equals the artifact bit for bit, and a full test:full regeneration (2026-09-25) reproduced '
    + 'all 57,126 leaves (22,706 pre-existing leaves identical to the previous pin, 34,420 added). Disclosed (DL-11): on 8 '
    + 'configs (picks 1 and 2, every risk) the runs test is degenerate — every round is at or above the median — so its z is 0 '
    + 'and serial independence there rests on the lag-1 statistic. FAIL probed (M19, M19b, M19c, M19d)' }] },
  20: { claims: [{ id: 'KENO-21', coverage: 'full', note: 'all 102 revealed seeds × 10,000 nonces on the configs each epoch '
    + 'served (1,666 combos); every row\'s full / early / late chi² / p re-derived in verify from its shipped histograms '
    + '(full = early + late) and every early window (nonces 0–49) REPLAYED from the revealed seed; THE RETURN STATISTIC: the '
    + 'return of the 5,100 served bets in the captured window (hits on the recomputed draw) against its exact null mean and '
    + 'variance from the hypergeometric law and the table — z +1.49, parametric-bootstrap lower-tail p 0.919 (B = 10,000, '
    + 'fixed seed), pre-registered rule FAIL if p < 0.01; DETECTION POWER printed: a per-bet return deficit of 0.234× is '
    + 'detectable at 80% power (one-sided α 0.01). Disclosed: the simulated early window is 0–49, while two capture-retry '
    + 'epochs also hold a captured bet at nonce 50 — those two bets are in the return statistic but not in the 0–49 '
    + 'histograms. FAIL probed (M20, M20b, M20c, M20d)' }] },
  21: { claims: [{ id: 'KENO-27', coverage: 'full', note: '5 artifacts pinned in src/artifact-pins.ts and matched, all '
    + 'un-ignored by name; verify writes only to outputs/run/; no artifact carries run metadata (the simulation\'s '
    + 'generatedAt / executionTimeMs removed 2026-09-25 by a regeneration whose every other leaf equals the old pin, not by '
    + 'editing); every numeric leaf of the four JSON artifacts has a value domain derived from src/ (src/domains.ts) and '
    + 'Step 21 checks both directions — every leaf inside its domain, every numeric path covered. Derived statistics are '
    + 'compared at the reproduction tolerance by the gate, never by bytes. FAIL probed (M21 byte-only change, M21b '
    + 'impossible value in a re-pinned artifact)' }] },
  22: { claims: [{ id: 'KENO-08', coverage: 'full', note: 'all 39 ranges the backward shuffle uses (40 … 2) ENUMERATED over all '
    + '2^32 chunk values with the draw\'s own maxFairFor: maxFair per range printed (range 40: 0xFFFFFFF0, 16 rejected), the '
    + 'accepted count a whole multiple of every range → bias exactly 0 (profile floor 2^-32; exactness is the declared '
    + 'property, so a naive modulo — 1.397e-10, under the floor — still FAILs); rejection census over the 5,100 recomputed '
    + 'draws bound to 39 × 5,100 accepted chunks. FAIL probed (M22, M22b)' }] },
  23: { claims: [{ id: 'KENO-24', coverage: 'full', note: 'asserts: "The site verifier\'s derive.js for this casino is '
    + 'generated from (or hash-matched to) the adapter\'s computeDraw; the package records that hash." The docs-site verifier '
    + '(derive.js + paytables.js + lib/hmac-sha256.js, mikepforg/pf-audit-duel origin/main @ bd4d59c, read with git cat-file) and '
    + 'the live www.provablyfair.org/verify-bets bundle (3 chunks + runner) are vendored with their SHA-256 recorded in '
    + 'src/site-verifier.ts / src/live-site-verifier.ts and EXECUTED on all 5,100 bets: each prints the drawn set src/rng.ts '
    + 'computeDraw recomputes on every bet, and the docs-site paytables.js equals kenoConfig.json on 260/260 cells with its printed '
    + 'multiplier equal to the served one on 5,100/5,100 — all scored. FAIL probed (M23, M23b, M23c derive.js changed and '
    + 're-pinned, M23d paytable cell changed and re-pinned). PV-1 (a stale repotree-sync build with a wrong table) is resolved '
    + 'on main' }] },
};

export const NOT_APPLICABLE: Array<{ id: string; reason: string }> = [
  { id: 'KENO-16', reason: 'money.balanceField = null: the bet record carries no running balance or wallet field (src/types.ts '
    + 'BetResponse: id, status, amount_currency, amount_won, multiplier, difficulty, selected_positions, drawn_numbers, '
    + 'transaction_id, effective_edge)' },
  { id: 'KENO-31', reason: 'gameModel.scalingEdge.presentAtCapture = false, and the declarationTruth is checked by Step 11: the '
    + 'pinned kenoConfig.json carries scaling_edge = [] and every one of the 5,100 bets was served effective_edge 0.1. That '
    + 'covers the captured stakes only ($0.01 and $10, both below the lowest threshold, $90.20, of the 5 October 2026 '
    + 'configuration); whether a ladder applied above them in April is not captured. Duel\'s keno config as fetched on '
    + '2026-10-05 (E14, informational) carries a populated scaling_edge ladder whose start date is unknown — a '
    + 're-certification item, MANIFEST DL-9' },
];

export const PACKAGE_CHECKS: Array<{ id: string; artifact: string; coverage: 'full' | 'partial' | 'none'; note: string }> = [
  { id: 'KENO-09', artifact: 'docs/ALGORITHM.md + tests/keno/RngSpecTests.ts + tests/keno/KenoTests.ts (Second check block) + src/operator-verifier.ts + Step 23', coverage: 'full',
    note: 'REWRITTEN 2026-10-20 (v1.2.0). src/rng.ts is rebuilt from a written specification, docs/ALGORITHM.md '
      + '(framework games/keno/ALGORITHM.md), by an implementer who never opened Duel\'s code; Duel\'s published Verify-tab '
      + 'code is run as a second check, not used as the source. Through v1.1.0 src/rng.ts was a port of that code and cited '
      + '18 of its lines (OPERATOR_SOURCE_CITES); the port and the citation table are gone. Duel publishes the draw code as '
      + 'the code panel of its Verify tab (E03 shows it collapsed); Paulo copied it verbatim on 2026-09-25 (duel.com → '
      + 'Provably Fair → Verify → Expand → Copy) to evidence/verify-tab/duel-verify-tab-keno-2026-09-25.js (E13, SHA-256 '
      + 'b75c1ca2…), pinned with its runner in src/operator-verifier.ts. The asserts: (1) "unit tests reproduce '
      + 'captured bets from their revealed seeds … against the operator\'s published source" — the Second check block in '
      + 'tests/keno/KenoTests.ts EXECUTES that file unmodified on all 5,100 captured bets: its generateKenoDrawnNumbers returns '
      + 'src/rng.ts computeDraw\'s draw in the same shuffled order on 5,100/5,100 and the served drawn_numbers as a set on '
      + '5,100/5,100 (the served order is not the shuffle order: it equals it on 0 of 5,100, spec §2.3 / O1); (2) "fixed '
      + 'vectors" — the same block requires it to return the 7 known-answer drawn sets, and tests/keno/RngSpecTests.ts runs '
      + 'the spec\'s own vectors, Verify-page grids and properties against src/rng.ts (79/79); (3) "the adapter cites the '
      + 'operator source line it ports" — superseded for this package by the 20 Oct 2026 rule that RNG code is rebuilt from a '
      + 'written spec: nothing is ported, so no operator line is cited; docs/ALGORITHM.md §4 names the source of every step '
      + 'instead (Duel\'s public pages and Verify-page result grids, the standard construction, or the 5,100 live bets). Off the '
      + 'captured data the two differ in two places, both disclosed in MANIFEST.md: on the power-of-two ranges 2, 4, 8, 16, 32 '
      + 'Duel\'s ceiling is 2^32 − r and the spec\'s 2^32, and when all eight chunks of a step are rejected Duel hashes the next '
      + 'cursor while src/rng.ts throws (spec O2); neither occurred in the 198,900 captured shuffle steps. Step 23 runs the same '
      + 'execution in the verifier. FAIL probed: M23e (a logic line of the operator file changed AND re-pinned → disagreement), '
      + 'M23f (a byte changed without re-pin → hash mismatch), M23g (src/rng.ts returns its draw out of shuffle order → the '
      + 'in-order comparison with Duel\'s code fails; until v1.1.0 M23g broke a citation). Not established: that the Verify '
      + 'button, or Duel\'s server, runs exactly this code' },
  { id: 'KENO-22', artifact: 'tests/steps/statistical.ts (informational context, never verdict-bearing)', coverage: 'full',
    note: 'drawn-number uniformity over all 51,000 captured numbers with the without-replacement correction (X²·39/30 ~ χ²₃₉), '
      + 'hit counts per picks count (10) and per (risk, picks) config (40) against the hypergeometric law; informational only' },
  { id: 'KENO-23', artifact: 'MANIFEST.md#verification-results', coverage: 'full',
    note: 'the standardized matrix S5-1 … S5-8 between the S5-MATRIX:START/END markers, each row Pass / Not tested — disclosed, '
      + 'tied to a scored step or the capture' },
  { id: 'KENO-25', artifact: 'MANIFEST.md#verify-a-bet', coverage: 'full',
    note: 'MANIFEST "Verify a bet" gives, in order and in the declaration\'s field names, where the seed is '
      + 'revealed, which fields to paste, the commitment encoding, the draw algorithm, the 1-based number base, how hits are '
      + 'counted and which paytable cell pays (and at what display rounding)' },
  { id: 'KENO-28', artifact: 'package.json + tests/verify.ts + src/simulate.ts', coverage: 'full',
    note: 'FRESH-FILE-SET EMULATION, last run 2026-10-19 on the working tree of the 19 October 2026 QA fixes, before this '
      + 'note and the results file were rewritten to record it: the file set git would commit — `git ls-files` + '
      + 'untracked-not-ignored, 89 files, no node_modules, no outputs/run — copied to an empty directory, `npm ci --offline` '
      + '(115 packages) then `npm test` on Node 22.23.1: 29 mocha passing, 22 PASS + 1 capture-origin FLAG, PROVABLY FAIR — '
      + 'Full Pass, REPRODUCED, exit 0, about 23 s, and the SHA-256 of the five pinned artifacts and the RTP claim table '
      + 'unchanged afterwards. (First run 2026-09-25: 92 files, 113 packages, 24 mocha passing.) test:full: `npm run simulate` writes to outputs/run/ and verify field-diffs it against the '
      + 'pin (ATOL 1e-14 + RTOL 1e-12, runtime recorded in outputs/run/diff.json) — the 2026-09-25 regeneration reproduced all '
      + '57,126 leaves. README/MANIFEST step counts = 23 = the suite; audit ID PF-2026-DL03; engines node 22.x + .nvmrc. '
      + 'NOT run: a real `git clone` of the released commit, and `npm ci` against the registry (offline cache only)' },
  { id: 'KENO-29', artifact: 'tests/mutations.json + scripts/mutate.mjs', coverage: 'full',
    note: 'step-named mutation registry (53 entries; last full run 2026-10-20 on the clean-room src/rng.ts, the whole '
      + 'registry in one run: 53/53 killed, 23/23 scored steps covered; M06, M22 and M22b retargeted to the same edits in the '
      + 'rebuilt module, M23g retargeted from the removed citation table to a draw returned out of shuffle order) run in '
      + 'a disposable copy by `npm run mutate`; every scored step has at least one killing '
      + 'mutation (the runner\'s coverage gate reads the scored steps from the baseline run); each entry carries an `expect` '
      + 'marker so the intended step fires; forged-evidence entries included (a re-pinned doctored dataset with the pre-flight '
      + 'abort disabled, a forged simulation scalar, a byte-only change to a pinned artifact). No declared survivors' },
  { id: 'KENO-30', artifact: 'MANIFEST.md#limitations-and-trust + MANIFEST.md#evidence', coverage: 'full',
    note: 'MANIFEST carries the declared-limitations register (DL-1 … DL-11, with the resolved item PV-1 in the release history) '
      + 'with measured magnitudes and closure evidence, and the load-bearing premises K1–K6 with what each assumes; MANIFEST '
      + 'Evidence numbers every exhibit E01–E15 with its role and names E12\'s real file; no internal QA folder ships' },
  { id: 'KENO-32', artifact: 'MANIFEST.md (DL-2)', coverage: 'partial',
    note: 'Duel offers Autopick (E01) and the capture never used it: every pick set was generated by the capture rig '
      + '(randomPositions, Math.random) and no field records Autopick use. Disclosed as DL-2, not passed. Classified CAPTURED '
      + 'BEFORE THE STANDARD — closing it needs a capture that records Autopick use, which decision-12 rules out' },
];

export function profileCoverageBlock(): Record<string, unknown> {
  return { game: PROFILE_GAME, profileVersion: PROFILE_VERSION, notApplicable: NOT_APPLICABLE, packageChecks: PACKAGE_CHECKS };
}

export function labelFor(step: number): Record<string, unknown> {
  const entry = STEP_CLAIMS[step];
  if (!entry) return { profileIds: [], profileChecks: [], profileNote: 'no mapping declared for this step' };
  return entry.claims.length
    ? { profileIds: entry.claims.map(c => c.id), profileChecks: entry.claims }
    : { profileIds: [], profileChecks: [], profileNote: entry.reason ?? 'no reason given' };
}

# Manifest — Duel Keno Audit

- **Audit ID:** PF-2026-DL03
- **Publication date:** 4 June 2026
- **Audit report:** https://audit.provablyfair.org/casino/duel/games/keno/overview
- **Auditor:** ProvablyFair.org
- **Audit dates:** original March 2026 · recaptured April 2026

## Algorithm

HMAC-SHA256 driving a full backward Fisher-Yates shuffle of the 40-ball pool. After 39 swap steps (cursor 0..38, with rejection-sampling retry on biased chunks), the first 10 shuffled positions (1-indexed) are the draw.

```
key     = hexDecode(serverSeed)
positions = [0, 1, ..., 39]
for i from 39 downto 1:
  cursor  = 39 - i                                        // 0..38 across the shuffle
  range   = i + 1
  maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range)             // bias-free ceiling
  loop:
    message = clientSeed + ":" + nonce + ":" + cursor
    hmac    = HMAC-SHA256(key, message)
    scan 4-byte chunks of hmac:
      if chunk < maxFair → j = chunk % range; swap positions[i] ↔ positions[j]; break
    else cursor++ and retry
drawn = positions[0..9] + 1                                // 1-indexed
```

The draw is an **unordered set** of 10 numbers from {1..40}. The API's `drawn_numbers` field is a presentation-ordered view of this set; any clean-room implementation should compare against the set, not the order.

The multiplier table for each spot-count configuration (1–10 selections) is loaded from `kenoConfig.json` (operator-provided). Payout = `bet × multiplier_table[spots][hits]`. The shipped `kenoConfig.json` is the base-tier (0.1%) configuration as audited; Duel has since deployed bet-size scaling separately.

## Dataset

- **File:** `data/keno-master-5100bets.json`
- **SHA-256:** `841755fdfb268d7796017212f08a18bfea7615c30a4590dd29793b34c5e6bcf9`
- **Total bets:** 5,100
- **Configurations:** 40 (spot counts 1–10)

## Configuration

- **File:** `kenoConfig.json`
- **SHA-256:** `efd3c645c4b3956199fde62dd65446c08e4605763d2d0f34c97a226bdbae4f91`
- **Note:** base-tier (0.1%) configuration as audited; Duel has since deployed bet-size scaling separately. The shipped config is the artifact the 5,100 bets were captured under and is the artifact the RTP proof is conditioned on.

## Verification

- **Verification steps:** 20 scored steps in `tests/verify.ts`
- **Unit tests:** Mocha (`tests/**/*Tests.ts`)
- **Simulation:** 40,000,000 rounds across 40 configurations (two-pass: fresh seeds + casino seeds)
- **Anti-circularity:** given Duel's committed multiplier table (`kenoConfig.json`), independently-derived hypergeometric probabilities confirm a flat 0.1% house edge across all 40 configurations (analytic identity over the full table). Live play exercised 190/260 table rows and matched every captured payout (Step 8); unobserved rare-hit rows are evaluated against the committed table via the analytic identity.
- **Expected `npm test` result:** 20/20 PASS · PROVABLY FAIR — Full Pass

## Reproducibility

Cloning this repo at the publication commit and running `npm install && npm test` reproduces the entire audit pipeline. The dataset and config hashes are verified at startup; the verifier recomputes every Keno draw from `(serverSeed, clientSeed, nonce)`; Step 17 confirms that independently-derived hypergeometric probabilities × the committed `kenoConfig.json` multiplier table = 99.9% RTP for all 40 configurations.

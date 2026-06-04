# Duel Keno — Verifier

Independent verifier for the ProvablyFair.org audit of **Duel.com Keno**.

- **Audit report:** https://audit.provablyfair.org/casino/duel/games/keno/overview
- **Audit ID:** PF-2026-DL03
- **Audited:** March 2026 (recaptured April 2026)
- **Algorithm:** HMAC-SHA256 driving a full backward Fisher-Yates shuffle of 40 positions (39 swap steps, cursor 0..38, with rejection sampling); the first 10 shuffled positions are the draw. The draw is an **unordered set** of 10 numbers from {1..40}; the API's `drawn_numbers` field is a presentation-ordered view of this set, so any clean-room implementation should compare against the set, not the order.

## What's in this repo

This is the verification codebase. It re-derives every audited Keno draw from the captured dataset and the published algorithm. The full audit report — methodology, evidence, findings, recommendations — lives on the docusaurus page linked above.

## Reproduce

```sh
git clone git@github.com:ProvablyFair-org/duel-keno.git
cd duel-keno
npm install
npm test
```

`npm test` runs the full pipeline: unit tests + 40M-round simulation + 5,100-bet dataset verification. Expected: 20/20 PASS, **PROVABLY FAIR — Full Pass**.

Individual scripts:

```sh
npm run simulate   # 40M-round simulation across all 40 spot-count configurations
npm run verify     # 20-step verification of the captured dataset
```

## Dataset

- **File:** `data/keno-master-5100bets.json`
- **SHA-256:** `841755fdfb268d7796017212f08a18bfea7615c30a4590dd29793b34c5e6bcf9`
- **Bets:** 5,100 across capture phases
- **Configurations:** 40 (player selects 1–10 spots out of 40)

## Configuration

- **File:** `kenoConfig.json`
- **SHA-256:** `efd3c645c4b3956199fde62dd65446c08e4605763d2d0f34c97a226bdbae4f91`

The shipped `kenoConfig.json` is the base-tier (0.1%) configuration as audited; Duel has since deployed bet-size scaling separately.

The verifier confirms both the dataset hash and the config hash before running any checks. Tampering with either file causes `npm test` to fail at startup.

## License

MIT

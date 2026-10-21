# Duel.com Keno: clean-room algorithm specification

> Package copy of the ProvablyFair.org audit framework's `games/keno/ALGORITHM.md`.
> It differs from that file only where the file named locations or tracking items
> in the spec author's workspace: those now read as paths inside this package or as
> neutral wording. No rule, number, vector or source note was changed.

Written 20 Oct 2026 for the ProvablyFair.org audit of Duel.com Keno.

This document is the only input an implementer needs to rebuild Duel Keno's
draw and settlement. It was written without opening any Duel source code, any
port of it, or any copy of Duel's in-site verifier code (see §8 for every file
read). Every step names where it came from:

- **PAGE**: Duel's public pages, quoted from the captured screenshots in
  `evidence/` (E01–E11, captured 23 Mar – 2 Apr 2026).
- **VERIFY-PAGE**: the *result* (the highlighted grid) that Duel's public
  Provably Fair > Verify page shows for a given server seed, client seed and
  nonce (E03, E05–E08). Only the result grid and the input boxes were read.
- **STANDARD**: the standard provably-fair construction (SHA-256 commitment to
  the server seed; HMAC-SHA256 keyed by the server seed over
  `clientSeed:nonce:cursor`; bytes to an unsigned integer; Fisher-Yates shuffle;
  rejection sampling against modulo bias).
- **DATA**: fixed by testing standard candidates against the 5,100 live bets in
  `data/keno-master-5100bets.json` (captured
  11 Apr 2026, schema `duel-keno-capture-v3`). The data chose; Duel's code did not.
- **CONFIG**: Duel's public keno config, `GET /api/v2/keno/config`, captured
  5 Oct 2026 as `evidence/keno-config-live-2026-10-05.json`.

The pages name the inputs, not how they are combined. The combination in §2
was found by sweeping standard candidates against the Verify-page results, and
then confirmed on every captured bet.

---

## 1. Inputs and commitment

### 1.1 Inputs

| Input | Form | Source |
|---|---|---|
| `serverSeed` | 64 lowercase hex characters (32 bytes); secret until the seed pair is rotated | PAGE: "Server seed - a random string provided by us" (E02). Form: DATA (all 106 revealed seeds are 64 hex) |
| `clientSeed` | text chosen or accepted by the player | PAGE: "Client seed - a random string provided by you" (E02). Default: 16 characters from `A–Z a–z 0–9 _`, generated in the browser (client-seed-origin.png; E04/E09 show 16-character defaults). DATA: 5,000 bets with 16-char seeds, 100 Phase D bets with player-set 15-char seeds (`pfauditmntnvgkk`, `pfauditmntnwjdi`) |
| `nonce` | non-negative integer; 0 on the first bet after a rotation, +1 per bet | PAGE: "Nonce - a number that increases with each bet" (E02); "Nonce 0" on a fresh pair (E09); `"nonce": 0` in the rotation response (E11). DATA: nonces 0–50 |
| `risk` | one of `classic`, `low`, `medium`, `high` (request also carries `difficulty` 1/2/3/4) | PAGE: Risk buttons "Classic / Low / Medium / High" (E01); "Risk Level High" (E10). CONFIG `difficulty_levels` {CLASSIC 1, LOW 2, MEDIUM 3, HIGH 4}; DATA 5,100/5,100 consistent |
| `picks` | the player's numbers: 1 to 10 distinct integers in 1…40 | PAGE: grid 1–40 (E01); CONFIG `min_picks` 1, `max_picks` 10, `grid_size` 40. Field `selected_positions` in the bet record |
| `amount` | stake, decimal | DATA (`request.amount`; `response.amount_currency` equals it on 5,100/5,100) |

The derivation of the drawn numbers reads **only** `serverSeed`, `clientSeed`
and `nonce`. Picks, risk and amount do not enter it (§2; profile check KENO-17).

### 1.2 Commitment

PAGE (Provably Fair > Overview, E02):

> "We then send you the hex-encoded SHA-256 hash of our server seed before you
> place your bets, to prove we won't change our minds."

The page does not say which bytes are hashed. Spec:

```
commitment = lowercase_hex( SHA-256( hex_decode(serverSeed) ) )
```

i.e. hash the **32 raw bytes** that the 64 hex characters encode, not the ASCII text.

- SOURCE: PAGE + STANDARD (SHA-256 commitment) + DATA (encoding).
- Candidates tried: SHA-256 over the hex-decoded 32 bytes → **102 / 102**
  distinct bet commitments resolve (5,100 / 5,100 bets); SHA-256 over the
  64-character ASCII string → **0 / 102**.
- Verification: each bet's `serverSeedHashed` must equal `commitment` of one
  revealed seed. **Pair seeds to bets by hashing, not by record position**: in
  this capture a rotation record carries the *revealed old* seed next to the
  *new* active hash (only 1 of 106 records has `SHA-256(serverSeed) ==
  serverSeedHashed` within the same record; in 102 of 105 consecutive pairs the
  seed in record *i* hashes to the active hash of record *i−1*).
- Forward commitment: the next-seed hash shown before a rotation
  (`nextServerSeedHash`, E04/E09 "Next server seed (Hashed)", E11
  `next_server_seed_hash`) equals the active hash after it on **105 / 105**
  consecutive rotation records.

---

## 2. Draw derivation

PAGE gives only the inputs:

> "Then we combine all of these values to generate a random result for each
> round: Fair result = Server seed + Client seed + Nonce" (E02)

The procedure is a **backward Fisher-Yates shuffle of the numbers 1…40**, with
one HMAC per shuffle step; the drawn numbers are the first 10 entries of the
shuffled array.

### Step 1: one HMAC per shuffle step

```
key = hex_decode(serverSeed)                                 # 32 bytes
for step s = 0, 1, …, 38:
    message_s = UTF-8( clientSeed + ":" + decimal(nonce) + ":" + decimal(s) )
    digest_s  = HMAC-SHA256(key, message_s)                  # 32 bytes
```

- `decimal(x)`: plain base 10, no padding, no sign (`0`, `8`, `17`, `38`).
  Example message: `dAn1wtkuDAXxQOKP:0:0`.
- The step counter `s` starts at **0** and is the step number, **not** the
  array index being filled (§2 Step 2 pairs step `s` with index `i = 39 − s`).
- SOURCE: STANDARD (HMAC-SHA256, server seed as key, `clientSeed:nonce:cursor`
  as message) + VERIFY-PAGE + DATA for key form, message format and counter.

### Step 2: backward Fisher-Yates shuffle with integer draws

```
a = [1, 2, 3, …, 40]                       # 0-indexed array of 40 numbers
for s = 0 … 38:
    i     = 39 − s                         # array index being fixed: 39, 38, …, 1
    r     = i + 1                          # range size: 40, 39, …, 2
    LIMIT = floor(2^32 / r) · r
    for offset in 0, 4, 8, …, 28:          # 4-byte chunks of digest_s
        v = digest_s[offset .. offset+3] as an unsigned 32-bit BIG-ENDIAN integer
        if v < LIMIT: break                # accept
    # (all 8 chunks rejected: see Open point O2)
    j = v mod r                            # 0 ≤ j ≤ i
    swap a[i], a[j]
drawn = a[0 .. 9]                          # the first 10 entries
```

`drawn` is 10 distinct integers in 1…40 (1-based numbers, as on the grid).

- SOURCE: STANDARD (Fisher-Yates; u32 big-endian; rejection sampling) +
  VERIFY-PAGE + DATA.
- Range enumeration for the draw-bias check (profile KENO-08): the shuffle uses
  every range r = 40, 39, …, 2 once per bet. `2^32 mod r ≠ 0` for 34 of these
  39 ranges (all except 2, 4, 8, 16, 32).
- Rejection versus plain `v mod r`: the data cannot tell them apart. The
  probability that any step of one bet sees a chunk ≥ LIMIT is
  Σ_{r=2..40}(2^32 mod r)/2^32 = 298/2^32 ≈ 6.9 × 10⁻⁸; expected over 5,100 bets
  ≈ 0.00035, observed **0** rejected chunks in 198,900 shuffle steps. Both forms
  give 5,100 / 5,100. The rejection form is specified because it is the
  standard unbiased construction (O2).

### How the candidates were settled

1. **Continuous byte stream** (Stake-style: consecutive 4-byte chunks of
   `HMAC(key, c:n:0)`, `HMAC(key, c:n:1)`, … shared across all draws), with key
   hex-decoded or ASCII, message schemes `c:n:k` (k from 0), `c:n` then `c:n:k`
   (k from 1), `n:c:k`, endianness big or little, and 10 selection methods
   (float or integer index-into-remaining with/without rejection, forward and
   backward Fisher-Yates with integer or float draws, duplicate-skipping draws):
   **120 combinations, 0 / 200** bets matched as sets on the first 200 bets.
   A first-number probe (byte, hex-window, whole-digest, 1–8-byte, float and
   modulo mappings over 5 message formats, 2 key forms, HMAC-SHA256, HMAC with
   key and message swapped, plain SHA-256, HMAC-SHA512)
   found nothing above chance on 400 bets.
2. **Per-step digests** (one HMAC per draw step), swept against the two
   Verify-page vectors whose inputs are fully legible (E05, E08): 2 key forms ×
   2 hash functions × 6 message formats × 4 units (u32 BE, u32 LE, 13-hex 52-bit,
   single byte) × 2 stream policies × 5 selection methods × 3 range mappings
   (rejection, plain mod, float scaling) = **2,880 combinations**. Exactly two
   matched both vectors: the spec above, with rejection or with plain mod.
3. **Full dataset**, the spec and its nearest neighbours (`fullcheck.py`):

   | Variant | As a set | In served order |
   |---|---|---|
   | **spec** (hex key, `c:n:s`, s = step, u32 BE, rejection, first 10) | **5,100 / 5,100** | 0 / 5,100 (see 2.3) |
   | same, plain `v mod r` (no rejection) | 5,100 / 5,100 | 0 / 5,100 |
   | float draw `floor(v·r / 2^32)` | 0 / 5,100 | 0 |
   | u32 little-endian | 0 / 5,100 | 0 |
   | ASCII key (64-char string) | 0 / 5,100 | 0 |
   | counter = array index i (39…1) instead of step s | 0 / 5,100 | 0 |
   | drawn = last 10 entries `a[30..39]` | 0 / 5,100 | 0 |
   | message `c:n-s` | 0 / 5,100 | 0 |

### 2.1 Independent check against Duel's public Verify page

Four screenshots of Duel's Provably Fair > Verify page, Game = Keno, nonce 0,
show the highlighted result grid. Each server seed is cut off in the input box,
but the code panel's first input line shows the tail; the two overlap, which
gives the full 64 hex characters without guessing. (Only the input-value lines
of the code panel are visible; no code was read.)

| Exhibit | Client seed | Server seed (reassembled) | Duel's grid | This spec |
|---|---|---|---|---|
| E05 (= E03) | `WEDPt3bHwL` | `6a20372a41fc09c8586db11f000a86cc9be2571c94ff967293d9deadb5d8d8c9` | 6 8 9 12 17 19 24 28 30 36 | **match** |
| E06 | `eLrBcz85Ij` | `412c28eeab8fcdd2ca764c8a9f4cb6ffadefedd2f6466e8f835409791fee0c6d` | 3 6 12 13 18 25 29 37 38 40 | **match** |
| E07 | `zNIRkEg0tQ` | `57fa7368fa3ef962fbe1b17ffcddb020d2708a305be31165411d12a40840a68e` | 4 7 17 21 24 25 30 34 35 38 | **match** |
| E08 | `enjQ9TTeg2` | `f54ab4cffcd36a462fc5727264c2060dceecb76fd66d9a3e1208a21283bd0741` | 3 5 7 12 26 27 29 31 35 39 | **match** |

The E06 and E07 client seeds contain a glyph that renders as either capital I
or lower-case l. Every I/l (and 0/O) reading was tried; only the readings in the
table reproduce Duel's grid (the others give unrelated sets), so the table
records them.

### 2.2 Hits

```
hits = | set(picks) ∩ set(drawn) |          # 0 … len(picks)
```

SOURCE: PAGE (E10: picks 17 25 33 37 38, drawn 7 9 14 15 18 24 27 29 31 39,
"Multi 0.00x" = the High/5-pick 0-hit cell) + DATA (the served multiplier equals
the paytable cell at this hit count on 5,100 / 5,100, §3).

### 2.3 Order of `drawn_numbers` in the bet record

The bet record lists the 10 drawn numbers in an order that is **not** `a[0..9]`
and that this spec does **not** reproduce: 0 / 5,100 in served order. The
position of the first served number within `a[0..9]` is flat (counts per index
0…9: 513, 497, 479, 504, 540, 507, 550, 478, 520, 512), and the share of hits by
served position is flat (688–733 per position). Order hypotheses tried on 400
bets, all **0 / 400**: reverse of `a[0..9]`; a second Fisher-Yates (backward or
forward) or index-into-remaining over the 10, with step counters continuing at
0, 1, 39, 40 or 100; ordering by `HMAC(key, c:n:number)`; ordering by the step at
which each number last moved or first entered positions 0–9. **Compare drawn
numbers as a set.** Hits and payout depend only on the set. See O1.

---

## 3. Win condition and payout

### 3.1 Paytable

CONFIG `multipliers[RISK][picks][hits]`, where `RISK` ∈ {CLASSIC, LOW, MEDIUM,
HIGH}, `picks` = number of picks as a string key `"1"`…`"10"`, and the row for
`p` picks has `p + 1` entries indexed by hits 0…p. Examples (CONFIG):

```
CLASSIC  1: [0, 3.996]
LOW      1: [0.71, 1.866]
MEDIUM  10: [0, 0, 0, 1.6070403763139798, 2.01, 4.1, 7.1, 27, 110, 600, 1200]
HIGH     5: [0, 0, 0, 4.518773793103448, 48.5, 460]
```

- Use the **top-level** `multipliers` object, at full precision. The config also
  carries per-tier tables in `scaling_edge[picks][RISK][k].multipliers`, rounded
  to 8 decimals (e.g. `2.26587093` for `2.2658709289192838`); the served
  multiplier matches the top-level cell rounded to 13 decimals on
  **5,100 / 5,100**, and the 8-decimal tier cell on only **4,662 / 5,100**.
- Two cells pay on 0 hits: LOW 1-pick (0.71) and MEDIUM 1-pick (0.41). No row
  has a paying cell followed by a smaller one. Largest cell: 1200.
- Each (risk, picks) row has one cell with a long fraction (25 such cells),
  apparently tuned to the edge; all other cells are short decimals.
- The config's `probabilities` field is the operator's claim and is not read.
- SOURCE: CONFIG + DATA.

### 3.2 Multiplier

```
multiplier = round_half_up( multipliers[RISK][picks][hits], 13 decimal places )
```

Take the config number in its shortest round-trip decimal form (e.g. Python
`repr`, JavaScript `String`) and round it as a decimal.

- DATA (5,100 bets): round to 13 dp, half-up or half-even → **5,100**; truncate
  to 13 dp → 4,834; 12 dp → ≤ 4,774; 14–15 dp → 4,662. Rounding to 14
  significant digits also gives 5,100: on this config the two rules agree on
  every cell (every long-fraction cell is below 10), so they cannot be told apart.
- `multiplier` is served with trailing zeros removed (`"1.607040376314"`,
  `"0.71"`, `"0"`). Compare numerically.
- Display: "0.00x" (E10), "4.00x" (E01 shows the 1-pick cells 0x / 4.00x for
  CLASSIC; the cell is 3.996).

### 3.3 Edge and stake tier

```
tier = the entry t in scaling_edge[picks][RISK] with  t.min_bet ≤ amount < t.max_bet
effective_edge (served, a percentage) = 100 × Decimal(t.house_edge)
```

- DATA: **5,100 / 5,100** bets fall in the first tier (house_edge `0.001`), and
  the served `effective_edge` is 0.1 on every bet. The 100 Phase D bets at
  10 USDT are all MEDIUM 10-pick, whose first tier runs to `max_bet`
  2502.085…; the lowest first-tier `max_bet` anywhere in the config is 90.20.
- The UI labels the game "Zero Edge" (E01). The served edge is 0.1 % on every
  captured bet.
- Above the first tier the config gives per-tier multipliers (e.g. CLASSIC 1-pick
  tier 2: `[0, 3.9956]`, edge 0.0011). Whether a higher-tier bet is paid from the
  tier table, at what precision, is unwitnessed (O4).

### 3.4 Payout

```
amount_won = amount × multiplier            # exact decimal product, no further rounding
```

- DATA: **5,100 / 5,100** (2,891 zero-multiplier bets pay `"0"`; the rest pay the
  exact product). Multiplying by the unrounded config cell instead matches only
  4,662 / 5,100: the **13-dp rounded multiplier** is what is paid.
- A "win" in the sense of net profit is `multiplier > 1`; a 0.71 / 0.41
  consolation cell returns part of the stake.
- `amount_won` is served with trailing zeros removed (`"0.0071"`, `"5.1"`).
- SOURCE: STANDARD (stake × multiplier) + DATA (which multiplier, precision).

### 3.5 Fields an implementation must not read

`drawn_numbers`, `multiplier`, `amount_won`, `effective_edge` and the config's
`probabilities` are the operator's claims, to be checked. The derivation reads
`serverSeed`, `clientSeed`, `nonce`, `selected_positions`, `risk`, `amount` and
the CONFIG `multipliers` / `scaling_edge` tables.

---

## 4. Source per step (summary)

| Step | Source | Evidence |
|---|---|---|
| Inputs: server seed, client seed, nonce | PAGE | E02 |
| Commitment = SHA-256, hex | PAGE + STANDARD | E02 "hex-encoded SHA-256 hash of our server seed" |
| Hash input = hex-decoded 32 bytes | DATA | 102/102 commitments (ASCII form 0/102) |
| Forward commitment (next hash → next active) | PAGE + DATA | E04/E09/E11; 105/105 rotations |
| HMAC-SHA256, key = hex-decoded server seed | STANDARD + VERIFY-PAGE + DATA | 4/4 Verify vectors; 5,100/5,100 sets (ASCII key 0) |
| Message `clientSeed:nonce:s`, one HMAC per step, s = 0…38 | STANDARD + VERIFY-PAGE + DATA | 2 of 2,880 combinations fit E05+E08 (the two are rejection vs plain mod); 5,100/5,100 |
| u32 big-endian from the first 4 bytes, `v mod r` | STANDARD + DATA | 5,100/5,100 (LE 0, float 0) |
| Rejection ≥ LIMIT, next chunk of the same digest | STANDARD | not exercised (0 of 198,900 steps); O2 |
| Backward Fisher-Yates of 1…40, drawn = a[0..9] | STANDARD + VERIFY-PAGE + DATA | 4/4 Verify vectors; 5,100/5,100 as sets (last 10: 0) |
| Served order of `drawn_numbers` | not reproduced | 0/5,100; O1 |
| hits = |picks ∩ drawn| | PAGE + DATA | E10; 5,100/5,100 via §3 |
| Paytable = CONFIG top-level `multipliers[RISK][picks][hits]` | CONFIG + DATA | 5,100/5,100 after rounding (8-dp tier table 4,662) |
| Multiplier rounded to 13 dp | DATA | 5,100/5,100 (truncation 4,834) |
| Edge = first scaling_edge tier, 0.1 % | CONFIG + DATA | 5,100/5,100 |
| Payout = amount × 13-dp multiplier, exact | STANDARD + DATA | 5,100/5,100 |

---

## 5. Test vectors (from the dataset)

Each vector is copied from `keno-master-5100bets.json` (bet id =
`response.id`), with the server seed taken from the revealed seed whose
commitment equals the bet's `serverSeedHashed`. "step-0 HMAC" is
`HMAC-SHA256(key, "clientSeed:nonce:0")`; its first four bytes read big-endian
give `u32`, and `j₀ = u32 mod 40` is the first swap (index 39 ↔ j₀). "Served
order" is the bet record's list, shown for reference only (§2.3).

**V1: bet 34309684** (Phase A, HIGH, 8 picks, loss)
```
serverSeed  94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9
commitment  111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a
clientSeed  dAn1wtkuDAXxQOKP     nonce 0     amount 0.01
picks       6 7 20 22 30 32 35 37
step-0 HMAC 8bacca95a903ec0e165a0224848f287c9986dcf65eb2e86469633a38c698e2c9
u32 2343357077 → j₀ 37
j for s = 0…38: 37 19 18 11 13 2 2 13 13 30 3 12 2 15 5 1 19 4 17 9 2 18 16 3 4 14 2 9 5 5 2 5 6 5 3 2 2 0 1
final array 8 25 1 27 29 22 9 7 11 32 | 37 26 21 24 15 23 30 17 40 28 10 18 5 39 2 6 16 34 13 4 31 33 36 35 3 14 12 19 20 38
drawn a[0..9] 8 25 1 27 29 22 9 7 11 32      (sorted 1 7 8 9 11 22 25 27 29 32)
served order  25 8 7 27 32 29 11 9 22 1
hits 3 (7 22 32) → cell HIGH 8 [3] = 0 → multiplier 0 → amount_won 0
```

**V2: bet 34309718** (Phase A, MEDIUM, 8 picks, long-fraction cell)
```
serverSeed  94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9
commitment  111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a
clientSeed  dAn1wtkuDAXxQOKP     nonce 8     amount 0.01
picks       4 6 18 22 23 32 34 37
step-0 HMAC 03056fa879c965a8504a83c90eab01529ce85dca7e3a3556a4fff8279fe0b7ee
u32 50687912 → j₀ 32
drawn a[0..9] 34 31 39 21 7 25 5 23 37 32    (sorted 5 7 21 23 25 31 32 34 37 39)
served order  34 31 23 5 32 7 39 37 21 25
hits 4 (23 32 34 37) → cell MEDIUM 8 [4] = 4.035047673782158
multiplier 4.0350476737822 (13 dp; served "4.0350476737822")
amount_won 0.040350476737822 (served "0.040350476737822")
```

**V3: bet 34327943** (Phase B, LOW, 1 pick, 0-hit consolation)
```
serverSeed  e6fbd51f92e28b89c76c25a365b26b2af6de396a0adca8a4b23101032d80e40e
commitment  199037ce1274218473a778adab9746641bfaea6d7d0df94fc7fec643f80531a1
clientSeed  7CdQzE4Rs3ts2VUT     nonce 2     amount 0.01
picks       6
step-0 HMAC 9ca962cecfbd3ad2efc8ef559dff1b978e8bc0112beef15b86e07335e494ddc8
u32 2628346574 → j₀ 14
drawn a[0..9] 3 38 25 31 20 37 2 4 33 35     (sorted 2 3 4 20 25 31 33 35 37 38)
served order  20 25 37 31 4 3 35 38 33 2
hits 0 → cell LOW 1 [0] = 0.71 → multiplier 0.71 → amount_won 0.0071 (served "0.0071")
```

**V4: bet 34318695** (Phase A, HIGH, 9 picks, the largest multiplier captured)
```
serverSeed  20c16a221f101357845d7a2bb82303bd5593b8632b6b16861befd2ee4ab14f4c
commitment  11d2025b915d490aaaef3a89fb607211c80ad29254dea21aa0d9654d7cba8e94
clientSeed  SX5FbhWjDwdOFXOu     nonce 17    amount 0.01
picks       5 12 14 16 18 22 25 29 30
step-0 HMAC ff5e4495d5d36b94506d83c090b22bbbe37a72419af0af97b59b9338e88cdcd5
u32 4284368021 → j₀ 21          (4284368021 < LIMIT 4294967280 for r = 40)
drawn a[0..9] 18 12 14 25 30 5 20 16 15 19   (sorted 5 12 14 15 16 18 19 20 25 30)
served order  12 19 15 30 20 5 18 16 25 14
hits 7 (5 12 14 16 18 25 30) → cell HIGH 9 [7] = 510 → multiplier 510 → amount_won 5.1
```

**V5: bet 34337631** (Phase D, 10 USDT stake, player-set client seed)
```
serverSeed  7d917ae0036a971be093d302cbdc37f3a13c35817b1483e7f0179b2e50e24f1d
commitment  db9860719120f62a32dcda8c0be8899962fd26c746d65e71156e962476e8800a
clientSeed  pfauditmntnvgkk      nonce 0     amount 10
picks       5 16 18 19 23 27 30 34 35 39
step-0 HMAC 27aa1133d810570f9f98f8fe65e0ed48147c7615eff974ec896f0438849dfb01
u32 665456947 → j₀ 27
drawn a[0..9] 22 36 27 35 10 34 40 11 14 13  (sorted 10 11 13 14 22 27 34 35 36 40)
served order  34 11 10 36 27 13 35 22 40 14
hits 3 (27 34 35) → cell MEDIUM 10 [3] = 1.6070403763139798
multiplier 1.6070403763140 (served "1.607040376314")
amount_won 16.07040376314 (served "16.07040376314")
```

**V6: Duel's public Verify page** (E05; no bet id, draw only)
```
serverSeed  6a20372a41fc09c8586db11f000a86cc9be2571c94ff967293d9deadb5d8d8c9
clientSeed  WEDPt3bHwL   nonce 0
j for s = 0…38: 38 25 37 21 21 26 4 0 3 2 6 9 22 19 12 15 17 0 4 1 15 9 14 12 13 1 2 10 2 3 3 4 6 5 2 0 1 1 0
drawn a[0..9] 8 9 19 24 28 12 6 30 36 17  → grid 6 8 9 12 17 19 24 28 30 36 (as shown by Duel)
```

---

## 6. Open points the public sources do not settle

- **O1: served order of `drawn_numbers`.** The set is reproduced on every bet;
  the order in the bet record is not (0 / 5,100; §2.3 lists the hypotheses
  tried). It looks independent of the shuffle order. No public page shows a draw
  order (the Verify page and bet history show only a grid). It does not affect
  hits or payout. To settle it: Duel's written rules, or the in-game reveal
  animation compared with the record.
- **O2: rejection continuation.** When a chunk is ≥ LIMIT this spec moves to the
  next 4-byte chunk of the same step digest; what happens if all 8 are rejected
  (probability < 10⁻⁶⁰ per step) is unspecified. None of the 198,900 captured
  steps exercised rejection, so "rejection" and "plain `v mod r`" are
  indistinguishable on this data (expected rejection events ≈ 0.00035). Without
  rejection the per-value bias is at most 1/2^32 absolute for each of the 34
  non-power-of-two ranges. To settle it: a revealed seed and nonce whose step
  digest has a first chunk ≥ LIMIT, found by search and checked on Duel's
  Verify page.
- **O3: the public page names no algorithm.** "Fair result = Server seed + Client
  seed + Nonce" does not say HMAC, the key form, the separator, the step counter,
  the shuffle direction or which end of the array is drawn. §2 rests on STANDARD
  + DATA and on four Verify-page results, not on a written Duel rule.
- **O4: stake tiers above the first.** Every captured bet is in the first
  scaling_edge tier. For a higher tier the config gives a tier-specific table at
  8 decimals and a higher edge; whether the payout uses that table, and how it is
  rounded, is unwitnessed. The tier boundary (`min_bet ≤ amount < max_bet`) and
  the currency basis of `amount` for tier selection are assumed. The config was
  captured 5 Oct 2026, the bets on 11 Apr 2026; the config that was live on
  11 Apr was not captured (the framework profile's KENO-31 reference records
  `scaling_edge = []` at capture), yet the 5 Oct `multipliers` reproduce all
  5,100 served multipliers.
- **O5: multiplier rounding rule.** 13 decimal places and 14 significant digits
  agree on every cell of this config; a future cell ≥ 10 with a long fraction
  would separate them. Half-up versus half-even is also unsettled (no captured
  value falls on a tie).
- **O6: client-seed encoding beyond ASCII.** UTF-8 is assumed; all captured and
  Verify-page client seeds are ASCII `[A-Za-z0-9_]`.
- **O7: Autopick.** E01 shows an "Autopick" control. Where it generates picks is
  not covered here; the capture does not record which bets used it. The draw does
  not read the picks, so it cannot change the drawn set.
- **O8: nonce gaps in the capture.** 100 of 102 epochs carry nonces exactly
  0…49; two (`505951bc…`, `5169f71b…`) carry 50 nonces within 0…50 with one
  missing. The spec uses each bet's recorded nonce; the gap is a capture-integrity
  question (profile KENO-04), not an algorithm one.

---

## 7. Reproduction of this spec

Implemented, independently of any audit package, in a throwaway script
(`spec_check.py`, outside the repo) and run on every bet:

```
commitment SHA256(hexdecode(serverSeed)) resolves bet hashes: 102/102 hashes, 5100/5100 bets
  (ASCII-hex candidate resolves 0/102)
drawn set == served drawn_numbers (as a set): 5100/5100
drawn list == served drawn_numbers (in served order): 0/5100
chunks rejected (value >= LIMIT) over 198900 shuffle steps: 0
served draw legal (10 distinct in 1..40): 5100/5100; picks legal: 5100/5100; difficulty code: 5100/5100
multiplier == round13(config.multipliers[risk][picks][hits]): 5100/5100
effective_edge == 100 x scaling_edge tier house_edge: 5100/5100
amount_won == amount x multiplier (exact): 5100/5100
```

Verify-page check (`spec_check_verifypage.py`): E05, E06, E07, E08 → MATCH on
all four.

---

## 8. Files read while writing this spec

Read: `evidence/` E01–E11 (PNG; E03 and E05 are
the same Verify screen) and `client-seed-origin.png` (shows Duel's client-seed
*generator* code, not the keno draw); `keno-config-live-2026-10-05.json` and its
`.meta.json`; `data/keno-master-5100bets.json`;
the audit framework's `games/keno/profile.json` (its KENO-08 text names
"a backward shuffle" and "integer draw" for Duel as range-enumeration
examples; the shuffle was chosen by the 2,880-combination sweep against the
Verify-page results, not by that text); the audit framework's `games/dice/ALGORITHM.md`
(as a model of shape). No live page was fetched.

Not opened: anything under `verify-tab` or `verifier-parity`, any `src/`,
`tests/`, `scripts/`, `capture/`, `verify.js`, `test.js`, `MANIFEST.md`,
`README.md` or docs of any keno or Duel package, any saved Duel JS bundle,
`evidence/keno-edge-claim-read-2026-10-05.md`, and the keno folder's
`CHANGES.md` / `status.json`.

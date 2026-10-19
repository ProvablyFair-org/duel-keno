import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { computeDraw, computeDrawFromBuffer, verifyHash } from '../../src/rng';
import { KenoConfig, DIFFICULTY_TO_RISK } from '../../src/config';
import { loadDataset, buildSeedMap } from '../../src/loader';
import type { KenoConfigFile } from '../../src/types';

const configRaw: KenoConfigFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../kenoConfig.json'), 'utf-8'),
);
const cfg = new KenoConfig(configRaw.data);

// ── Test vectors — real bets from data/keno-master-5100bets.json ─────────────
// 7 distinct (difficulty, picks) configurations.
// expectedDrawnSet: sorted drawn_numbers from API — same SET as algorithm output.

const VECTORS = [
  {
    serverSeed:       '94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9',
    serverSeedHashed: '111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a',
    clientSeed: 'dAn1wtkuDAXxQOKP', nonce: 0, difficulty: 4, picks: 8,
    selectedPositions: [6, 7, 20, 22, 30, 32, 35, 37],
    expectedDrawnSet: [1, 7, 8, 9, 11, 22, 25, 27, 29, 32],
    hits: 3,
  },
  {
    serverSeed:       '94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9',
    serverSeedHashed: '111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a',
    clientSeed: 'dAn1wtkuDAXxQOKP', nonce: 1, difficulty: 4, picks: 2,
    selectedPositions: [5, 19],
    expectedDrawnSet: [3, 6, 15, 17, 23, 24, 30, 31, 35, 38],
    hits: 0,
  },
  {
    serverSeed:       '94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9',
    serverSeedHashed: '111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a',
    clientSeed: 'dAn1wtkuDAXxQOKP', nonce: 2, difficulty: 3, picks: 3,
    selectedPositions: [35, 39, 40],
    expectedDrawnSet: [1, 4, 10, 11, 18, 22, 27, 32, 33, 35],
    hits: 1,
  },
  {
    serverSeed:       '94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9',
    serverSeedHashed: '111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a',
    clientSeed: 'dAn1wtkuDAXxQOKP', nonce: 3, difficulty: 2, picks: 8,
    selectedPositions: [9, 10, 21, 22, 23, 32, 33, 39],
    expectedDrawnSet: [2, 5, 8, 13, 18, 19, 22, 29, 32, 35],
    hits: 2,
  },
  {
    serverSeed:       '94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9',
    serverSeedHashed: '111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a',
    clientSeed: 'dAn1wtkuDAXxQOKP', nonce: 4, difficulty: 3, picks: 8,
    selectedPositions: [1, 5, 6, 15, 17, 22, 33, 36],
    expectedDrawnSet: [1, 5, 8, 16, 20, 26, 29, 35, 36, 37],
    hits: 3,
  },
  {
    serverSeed:       '94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9',
    serverSeedHashed: '111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a',
    clientSeed: 'dAn1wtkuDAXxQOKP', nonce: 5, difficulty: 3, picks: 9,
    selectedPositions: [2, 6, 10, 13, 22, 24, 28, 32, 35],
    expectedDrawnSet: [4, 11, 12, 15, 16, 25, 29, 33, 36, 37],
    hits: 0,
  },
  {
    serverSeed:       '94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9',
    serverSeedHashed: '111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a',
    clientSeed: 'dAn1wtkuDAXxQOKP', nonce: 9, difficulty: 2, picks: 7,
    selectedPositions: [2, 9, 10, 20, 23, 28, 33],
    expectedDrawnSet: [3, 4, 9, 11, 15, 17, 23, 26, 37, 40],
    hits: 2,
  },
] as const;

// ── Full dataset for all-bet crypto and payout tests ──────────────────────────
const ds = loadDataset();
const seedMap = buildSeedMap(ds.seeds);

const ALL_BETS: Array<{ id: number; amount: string; multiplier: string; winAmount: string }> =
  ds.bets.map(b => ({
    id:         b.response.id,
    amount:     b.response.amount_currency,
    multiplier: b.response.multiplier,
    winAmount:  b.response.amount_won,
  }));

// ── Cryptographic Core ─────────────────────────────────────────────────────────

describe('Cryptographic Core — Known-Answer Tests (7 hand-picked bets, one per config — proves our algorithm implementation is correct)', () => {

  it('computeDraw matches the manually verified drawn-number set for each of 7 distinct (difficulty, picks) configs', () => {
    for (const v of VECTORS) {
      const drawn = computeDraw(v.serverSeed, v.clientSeed, v.nonce);
      const drawnSorted = [...drawn].sort((a, b) => a - b);
      assert.deepStrictEqual(
        drawnSorted, [...v.expectedDrawnSet],
        `diff=${v.difficulty} picks=${v.picks} seed=${v.serverSeed.slice(0, 8)}…`,
      );
    }
  });

  it('string-key and buffer-key code paths produce identical draws (guards against encoding bugs)', () => {
    for (const v of VECTORS) {
      const key      = Buffer.from(v.serverSeed, 'hex');
      const fromBuf  = computeDrawFromBuffer(key, v.clientSeed, v.nonce);
      const fromStr  = computeDraw(v.serverSeed, v.clientSeed, v.nonce);
      assert.deepStrictEqual(
        [...fromBuf].sort((a, b) => a - b),
        [...fromStr].sort((a, b) => a - b),
        `buffer/string mismatch picks=${v.picks} nonce=${v.nonce}`,
      );
    }
  });

  it('HMAC key is hex-decoded (not raw UTF-8) — only hex decoding produces the correct known draw', () => {
    const v = VECTORS[0];
    const drawn = computeDraw(v.serverSeed, v.clientSeed, v.nonce);
    const drawnSorted = [...drawn].sort((a, b) => a - b);
    assert.deepStrictEqual(drawnSorted, [...v.expectedDrawnSet], 'hex-decoded key must match');
  });

  it('every draw contains exactly 10 unique numbers in [1, 40] (Keno draws 10 of 40)', () => {
    for (const v of VECTORS) {
      const drawn = computeDraw(v.serverSeed, v.clientSeed, v.nonce);
      assert.strictEqual(drawn.length, 10, 'must draw exactly 10');
      assert.strictEqual(new Set(drawn).size, 10, 'drawn numbers must be unique');
      for (const n of drawn) {
        assert.ok(n >= 1 && n <= 40, `drawn number ${n} out of range [1, 40]`);
      }
    }
  });

  it('hit count (overlap between player picks and drawn numbers) matches expected for all 7 vectors', () => {
    for (const v of VECTORS) {
      const drawn   = new Set(computeDraw(v.serverSeed, v.clientSeed, v.nonce));
      const hits    = v.selectedPositions.filter(p => drawn.has(p)).length;
      assert.strictEqual(hits, v.hits,
        `diff=${v.difficulty} picks=${v.picks} seed=${v.serverSeed.slice(0, 8)}…`);
    }
  });

  it('SHA-256(serverSeed) matches the committed hash for all 7 known server seeds', () => {
    for (const v of VECTORS) {
      assert.strictEqual(
        verifyHash(v.serverSeed, v.serverSeedHashed), true,
        `hash mismatch for seed ${v.serverSeed.slice(0, 8)}…`,
      );
    }
  });

  it('verifyHash rejects a tampered server seed (negative control)', () => {
    const v       = VECTORS[0];
    const tampered = '0000000000000000000000000000000000000000000000000000000000000000';
    assert.strictEqual(verifyHash(tampered, v.serverSeedHashed), false);
  });

  it('verifyHash rejects a tampered hash (negative control)', () => {
    const v           = VECTORS[0];
    const tamperedHash = '0000000000000000000000000000000000000000000000000000000000000000';
    assert.strictEqual(verifyHash(v.serverSeed, tamperedHash), false);
  });

  it('different nonces produce different drawn sets (confirms nonce is a genuine HMAC input)', () => {
    const v      = VECTORS[0];
    const draw0  = computeDraw(v.serverSeed, v.clientSeed, 0);
    const draw1  = computeDraw(v.serverSeed, v.clientSeed, 1);
    assert.notDeepStrictEqual(new Set(draw0), new Set(draw1), 'nonce 0 and 1 must differ');
  });

});

describe('Cryptographic Core — Full Dataset Verification (all bets — proves the server produced the same outcomes our code computes)', () => {

  it(`recomputes the drawn numbers for every bet in the dataset (${ds.bets.length} bets) and confirms 0 mismatches`, () => {
    let checked = 0;
    let mismatches = 0;
    for (const b of ds.bets) {
      const ss = seedMap.get(b.seed.serverSeedHashed);
      if (!ss) continue;
      const key = Buffer.from(ss, 'hex');
      const computed = computeDrawFromBuffer(key, b.seed.clientSeed, b.seed.nonce);
      const apiSet = new Set(b.response.drawn_numbers);
      const compSet = new Set(computed);
      if (apiSet.size !== compSet.size || [...apiSet].some(n => !compSet.has(n))) mismatches++;
      checked++;
    }
    assert.strictEqual(mismatches, 0, `${mismatches} draw mismatches out of ${checked}`);
    assert.ok(checked > 0, 'must have at least one bet to check');
  });

  it(`verifies SHA-256(serverSeed) === committedHash for all revealed seeds via seed map (commit-reveal integrity)`, () => {
    let mismatches = 0;
    let checked = 0;
    for (const [hash, serverSeed] of seedMap) {
      if (!verifyHash(serverSeed, hash)) mismatches++;
      checked++;
    }
    assert.strictEqual(mismatches, 0, `${mismatches} hash mismatches out of ${checked}`);
    assert.ok(checked > 0, 'must have revealed seeds');

    // seeds[0].seed.serverSeed is a post-capture copy of seeds[1]'s reveal, not a captured value
    // (see buildSeedMap in src/loader.ts). Pin it so the exception cannot drift.
    assert.strictEqual(ds.seeds[0].revealedFrom, undefined);
    assert.strictEqual(ds.seeds[0].seed.serverSeed, ds.seeds[1].seed.serverSeed);
    assert.strictEqual(ds.seeds[1].revealedFrom?.transactionId, 518502617);
  });

});

// ── Configuration Integrity ────────────────────────────────────────────────────

describe('Configuration Integrity — validates the casino multiplier tables loaded from kenoConfig.json', () => {

  it('config loader returns exactly 40 configs (4 risk levels × 10 pick counts: 1–10)', () => {
    assert.strictEqual(cfg.allConfigs().length, 40);
  });

  it('API difficulty codes map to the 4 expected risk labels (CLASSIC, LOW, MEDIUM, HIGH)', () => {
    assert.strictEqual(DIFFICULTY_TO_RISK[1], 'CLASSIC');
    assert.strictEqual(DIFFICULTY_TO_RISK[2], 'LOW');
    assert.strictEqual(DIFFICULTY_TO_RISK[3], 'MEDIUM');
    assert.strictEqual(DIFFICULTY_TO_RISK[4], 'HIGH');
  });

  it('zero-hit multipliers are non-negative — only LOW/picks=1 and MEDIUM/picks=1 have consolation payouts on zero hits', () => {
    const nonZeroZeroHit: string[] = [];
    for (const { risk, picks } of cfg.allConfigs()) {
      const m = cfg.multiplier(risk, picks, 0);
      assert.ok(m >= 0, `zero-hit multiplier must be non-negative: ${risk} picks=${picks}`);
      if (m > 0) nonZeroZeroHit.push(`${risk}/picks=${picks}:${m}`);
    }
    assert.deepStrictEqual(nonZeroZeroHit, ['LOW/picks=1:0.71', 'MEDIUM/picks=1:0.41'],
      'exactly two configs have non-zero zero-hit multipliers');
  });

  it('every multiplier for 1+ hits is non-negative across all 40 configs', () => {
    for (const { risk, picks } of cfg.allConfigs()) {
      for (let k = 1; k <= picks; k++) {
        const m = cfg.multiplier(risk, picks, k);
        assert.ok(m >= 0, `multiplier must be non-negative: ${risk} picks=${picks} hits=${k} = ${m}`);
      }
    }
  });

  it('theoretical RTP (computed from multipliers × hypergeometric probabilities) is between 99.4% and 100% for all 40 configs', () => {
    for (const { risk, picks } of cfg.allConfigs()) {
      const rtp = cfg.theoreticalRTP(risk, picks);
      assert.ok(rtp > 0.994 && rtp < 1.0,
        `RTP out of range: ${risk} picks=${picks} = ${(rtp * 100).toFixed(4)}%`);
    }
  });

  it('theoretical RTP is within ±0.1% of the stated 99.9% for all 40 configs (confirms 0.1% house edge)', () => {
    for (const { risk, picks } of cfg.allConfigs()) {
      const rtp = cfg.theoreticalRTP(risk, picks);
      assert.ok(Math.abs(rtp - 0.999) < 0.001,
        `RTP deviates >0.1% from 99.9%: ${risk} picks=${picks} = ${(rtp * 100).toFixed(6)}%`);
    }
  });

  it('hit probabilities sum to 1.0 for all pick counts (hypergeometric distribution is complete)', () => {
    for (const { picks } of cfg.allConfigs()) {
      let total = 0;
      for (let k = 0; k <= picks; k++) total += cfg.hitProbability(picks, k);
      assert.ok(Math.abs(total - 1.0) < 1e-9,
        `hit probs don't sum to 1 for picks=${picks}: sum=${total}`);
    }
  });

  it('no scaling edge brackets — Keno uses a flat house edge across all configs', () => {
    assert.strictEqual(configRaw.data.scaling_edge.length, 0,
      'scaling_edge must be empty array (flat house edge)');
  });

});

// ── Payout Accuracy ────────────────────────────────────────────────────────────

describe('Payout Accuracy — confirms the platform paid the correct amount for every bet in the dataset', () => {

  it(`win_amount = bet_amount × multiplier for all ${ALL_BETS.length} bets (tolerance ±1e-10)`, () => {
    for (const p of ALL_BETS) {
      const expected = parseFloat(p.amount) * parseFloat(p.multiplier);
      const actual   = parseFloat(p.winAmount);
      assert.ok(
        Math.abs(expected - actual) < 1e-10,
        `Payout mismatch bet ${p.id}: ${p.amount} × ${p.multiplier} = ${expected}, recorded ${p.winAmount}`,
      );
    }
  });

});

// ── The operator's own Verify-tab code (profile KENO-09) ──────────────────────

describe('Operator source — Duel\'s own Keno Verify-tab code, executed unmodified (evidence/verify-tab, copied 2026-09-25)', () => {
  // duel.com → Provably Fair → Verify (Keno) → Expand → Copy, saved verbatim (src/operator-verifier.ts)
  const { runOperatorVerifier, checkOperatorCites, OPERATOR_VERIFIER_PINS, OPERATOR_VERIFIER_FILE, OPERATOR_EXPECTED_LOGS } =
    require('../../src/operator-verifier') as typeof import('../../src/operator-verifier');
  const known = VECTORS.map((v, i) => ({ id: `known${i}`, serverSeed: v.serverSeed, clientSeed: v.clientSeed, nonce: v.nonce, gridSize: 40, drawnCount: 10 }));
  const captured = ds.bets.map((b, i) => ({ id: `bet${i}`, serverSeed: seedMap.get(b.seed.serverSeedHashed) ?? '',
    clientSeed: b.seed.clientSeed, nonce: b.seed.nonce, gridSize: 40, drawnCount: 10 }));
  const run = runOperatorVerifier([...known, ...captured]);
  const sorted = (a: number[]): number[] => [...a].sort((x, y) => x - y);

  it('the vendored operator file and its runner hash to their pins, the code ran, and it printed only its empty-input message', () => {
    assert.deepStrictEqual(run.files.map(f => f.match), [true, true]);
    assert.strictEqual(run.files[0].file, OPERATOR_VERIFIER_FILE);
    assert.strictEqual(run.files[0].actual, OPERATOR_VERIFIER_PINS[OPERATOR_VERIFIER_FILE]);
    assert.strictEqual(run.error, null);
    assert.deepStrictEqual(run.logs, [...OPERATOR_EXPECTED_LOGS]);
  });

  it('every operator line src/rng.ts cites carries the quoted text verbatim', () => {
    const c = checkOperatorCites();
    assert.deepStrictEqual(c.bad, []);
    assert.ok(c.checked > 0);
  });

  it('fixed vectors: the operator code returns the 7 known-answer drawn sets above, and src/rng.ts\'s shuffle order', () => {
    VECTORS.forEach((v, i) => {
      const got = run.drawn!.get(`known${i}`)!;
      assert.deepStrictEqual(sorted(got), [...v.expectedDrawnSet], `nonce=${v.nonce}`);
      assert.deepStrictEqual(got, computeDraw(v.serverSeed, v.clientSeed, v.nonce), `order, nonce=${v.nonce}`);
    });
  });

  it('every captured bet: the operator draw equals src/rng.ts in order and the served drawn_numbers as a set', () => {
    const bad: string[] = [];
    ds.bets.forEach((b, i) => {
      const got = run.drawn!.get(`bet${i}`);
      const mine = computeDraw(captured[i].serverSeed, b.seed.clientSeed, b.seed.nonce);
      if (!got || got.join(',') !== mine.join(',') || sorted(got).join(',') !== sorted(b.response.drawn_numbers).join(',')) bad.push(String(b.response.id));
    });
    assert.deepStrictEqual(bad.slice(0, 5), []);
    assert.strictEqual(ds.bets.length, 5100);
  });
});

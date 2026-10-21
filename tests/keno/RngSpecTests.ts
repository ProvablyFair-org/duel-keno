/**
 * Spec self-test — docs/ALGORITHM.md §5 vectors, §2.1 Verify-page grids and properties, run against src/rng.ts.
 *
 * Written by the clean-room implementer together with src/rng.ts, from docs/ALGORITHM.md and the module
 * interface alone (never from Duel's code). Integrated 20 Oct 2026: the checks are unchanged; only the
 * import path, the mocha wrapper and the reporting (failures collected instead of printed) were adapted.
 * The property block draws 2,000 rounds from fresh random seeds (crypto.randomBytes), as the self-test did.
 */
import * as assert from 'assert';
// Self-test for rng.ts: every worked vector in ALGORITHM.md §5 (plus the §2.1
// Verify-page grids and the §2 Step 2 range facts), then properties.
// Paytable/multiplier/payout are out of this module's scope (INTERFACE.md), so the
// vectors are checked through hits, which is the last output the draw determines.

import { createHash, createHmac, randomBytes } from "crypto";
import {
  GRID_SIZE,
  DRAWN_COUNT,
  maxFairFor,
  computeDraw,
  computeDrawFromBuffer,
  verifyHash,
  DrawCensus,
} from '../../src/rng';

let passed = 0;
let total = 0;
const failed: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  total++;
  if (ok) passed++;
  else failed.push(`${name}${detail ? "  " + detail : ""}`);
}
const nums = (s: string): number[] => s.trim().split(/\s+/).map(Number);
const eq = (x: number[], y: number[]): boolean => x.length === y.length && x.every((v, k) => v === y[k]);
const sorted = (x: number[]): number[] => [...x].sort((p, q) => p - q);

// Replay a list of j values (s = 0..38) on [1..40] per §2 Step 2.
function replay(js: number[]): number[] {
  const a = Array.from({ length: GRID_SIZE }, (_, k) => k + 1);
  js.forEach((j, s) => {
    const i = GRID_SIZE - 1 - s;
    const t = a[i] as number;
    a[i] = a[j] as number;
    a[j] = t;
  });
  return a;
}

const EXPECTED_CHECKS = 79;

function runSelftest(): { pass: number; total: number; failed: string[] } {
    interface Vec {
      id: string;
      serverSeed: string;
      commitment?: string;
      clientSeed: string;
      nonce: number;
      picks?: number[];
      step0Hmac?: string;
      u32?: number;
      j0?: number;
      js?: number[];
      finalArray?: number[];
      drawn: number[];
      drawnSorted: number[];
      served?: number[];
      hits?: number;
    }

    const V: Vec[] = [
      {
        id: "V1 bet 34309684",
        serverSeed: "94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9",
        commitment: "111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a",
        clientSeed: "dAn1wtkuDAXxQOKP", nonce: 0,
        picks: nums("6 7 20 22 30 32 35 37"),
        step0Hmac: "8bacca95a903ec0e165a0224848f287c9986dcf65eb2e86469633a38c698e2c9",
        u32: 2343357077, j0: 37,
        js: nums("37 19 18 11 13 2 2 13 13 30 3 12 2 15 5 1 19 4 17 9 2 18 16 3 4 14 2 9 5 5 2 5 6 5 3 2 2 0 1"),
        finalArray: nums("8 25 1 27 29 22 9 7 11 32 37 26 21 24 15 23 30 17 40 28 10 18 5 39 2 6 16 34 13 4 31 33 36 35 3 14 12 19 20 38"),
        drawn: nums("8 25 1 27 29 22 9 7 11 32"),
        drawnSorted: nums("1 7 8 9 11 22 25 27 29 32"),
        served: nums("25 8 7 27 32 29 11 9 22 1"),
        hits: 3,
      },
      {
        id: "V2 bet 34309718",
        serverSeed: "94eee14e882d43325f7948ef9569552f4506feeeb70a2ca35023916b4f9f0fe9",
        commitment: "111880213ddf0a3a7b93cf725aeec359113c3986a902fffa0e5a33987600b77a",
        clientSeed: "dAn1wtkuDAXxQOKP", nonce: 8,
        picks: nums("4 6 18 22 23 32 34 37"),
        step0Hmac: "03056fa879c965a8504a83c90eab01529ce85dca7e3a3556a4fff8279fe0b7ee",
        u32: 50687912, j0: 32,
        drawn: nums("34 31 39 21 7 25 5 23 37 32"),
        drawnSorted: nums("5 7 21 23 25 31 32 34 37 39"),
        served: nums("34 31 23 5 32 7 39 37 21 25"),
        hits: 4,
      },
      {
        id: "V3 bet 34327943",
        serverSeed: "e6fbd51f92e28b89c76c25a365b26b2af6de396a0adca8a4b23101032d80e40e",
        commitment: "199037ce1274218473a778adab9746641bfaea6d7d0df94fc7fec643f80531a1",
        clientSeed: "7CdQzE4Rs3ts2VUT", nonce: 2,
        picks: nums("6"),
        step0Hmac: "9ca962cecfbd3ad2efc8ef559dff1b978e8bc0112beef15b86e07335e494ddc8",
        u32: 2628346574, j0: 14,
        drawn: nums("3 38 25 31 20 37 2 4 33 35"),
        drawnSorted: nums("2 3 4 20 25 31 33 35 37 38"),
        served: nums("20 25 37 31 4 3 35 38 33 2"),
        hits: 0,
      },
      {
        id: "V4 bet 34318695",
        serverSeed: "20c16a221f101357845d7a2bb82303bd5593b8632b6b16861befd2ee4ab14f4c",
        commitment: "11d2025b915d490aaaef3a89fb607211c80ad29254dea21aa0d9654d7cba8e94",
        clientSeed: "SX5FbhWjDwdOFXOu", nonce: 17,
        picks: nums("5 12 14 16 18 22 25 29 30"),
        step0Hmac: "ff5e4495d5d36b94506d83c090b22bbbe37a72419af0af97b59b9338e88cdcd5",
        u32: 4284368021, j0: 21,
        drawn: nums("18 12 14 25 30 5 20 16 15 19"),
        drawnSorted: nums("5 12 14 15 16 18 19 20 25 30"),
        served: nums("12 19 15 30 20 5 18 16 25 14"),
        hits: 7,
      },
      {
        id: "V5 bet 34337631",
        serverSeed: "7d917ae0036a971be093d302cbdc37f3a13c35817b1483e7f0179b2e50e24f1d",
        commitment: "db9860719120f62a32dcda8c0be8899962fd26c746d65e71156e962476e8800a",
        clientSeed: "pfauditmntnvgkk", nonce: 0,
        picks: nums("5 16 18 19 23 27 30 34 35 39"),
        step0Hmac: "27aa1133d810570f9f98f8fe65e0ed48147c7615eff974ec896f0438849dfb01",
        u32: 665456947, j0: 27,
        drawn: nums("22 36 27 35 10 34 40 11 14 13"),
        drawnSorted: nums("10 11 13 14 22 27 34 35 36 40"),
        served: nums("34 11 10 36 27 13 35 22 40 14"),
        hits: 3,
      },
      {
        id: "V6 Verify page E05",
        serverSeed: "6a20372a41fc09c8586db11f000a86cc9be2571c94ff967293d9deadb5d8d8c9",
        clientSeed: "WEDPt3bHwL", nonce: 0,
        js: nums("38 25 37 21 21 26 4 0 3 2 6 9 22 19 12 15 17 0 4 1 15 9 14 12 13 1 2 10 2 3 3 4 6 5 2 0 1 1 0"),
        drawn: nums("8 9 19 24 28 12 6 30 36 17"),
        drawnSorted: nums("6 8 9 12 17 19 24 28 30 36"),
      },
    ];

    // §2.1 Verify-page grids (E06-E08; E05 is V6 above).
    const VERIFY: { id: string; serverSeed: string; clientSeed: string; grid: number[] }[] = [
      { id: "E06", serverSeed: "412c28eeab8fcdd2ca764c8a9f4cb6ffadefedd2f6466e8f835409791fee0c6d", clientSeed: "eLrBcz85Ij", grid: nums("3 6 12 13 18 25 29 37 38 40") },
      { id: "E07", serverSeed: "57fa7368fa3ef962fbe1b17ffcddb020d2708a305be31165411d12a40840a68e", clientSeed: "zNIRkEg0tQ", grid: nums("4 7 17 21 24 25 30 34 35 38") },
      { id: "E08", serverSeed: "f54ab4cffcd36a462fc5727264c2060dceecb76fd66d9a3e1208a21283bd0741", clientSeed: "enjQ9TTeg2", grid: nums("3 5 7 12 26 27 29 31 35 39") },
    ];

    check("GRID_SIZE == 40", GRID_SIZE === 40);
    check("DRAWN_COUNT == 10", DRAWN_COUNT === 10);
    check("maxFairFor(40) == 4294967280 (V4 LIMIT)", maxFairFor(40) === 4294967280, `got ${maxFairFor(40)}`);
    {
      let nonPow = 0;
      let residueSum = 0;
      let allOk = true;
      for (let r = 2; r <= 40; r++) {
        const m = maxFairFor(r);
        const resid = 2 ** 32 - m;
        if (m % r !== 0 || resid < 0 || resid >= r || resid !== 2 ** 32 % r) allOk = false;
        if (resid !== 0) nonPow++;
        residueSum += resid;
      }
      check("maxFairFor(r), r=2..40: multiple of r and 2^32 - LIMIT == 2^32 mod r", allOk);
      check("2^32 mod r != 0 for 34 of 39 ranges", nonPow === 34, `got ${nonPow}`);
      check("sum (2^32 mod r), r=2..40 == 298", residueSum === 298, `got ${residueSum}`);
    }

    for (const v of V) {
      const key = Buffer.from(v.serverSeed, "hex");
      if (v.commitment) check(`${v.id} verifyHash(seed, commitment) true`, verifyHash(v.serverSeed, v.commitment));
      if (v.step0Hmac) {
        // Independent one-liner of §2 Step 1 for step 0, to pin the message format.
        const d = createHmac("sha256", key).update(`${v.clientSeed}:${v.nonce}:0`, "utf8").digest();
        check(`${v.id} step-0 HMAC`, d.toString("hex") === v.step0Hmac);
        check(`${v.id} u32 BE`, d.readUInt32BE(0) === v.u32, `got ${d.readUInt32BE(0)}`);
        check(`${v.id} j0 = u32 mod 40`, d.readUInt32BE(0) % 40 === v.j0);
      }
      const full = computeDrawFromBuffer(key, v.clientSeed, v.nonce, GRID_SIZE, GRID_SIZE);
      if (v.js) check(`${v.id} j sequence replayed == module's full shuffled array`, eq(replay(v.js), full));
      if (v.finalArray) check(`${v.id} final array (all 40)`, eq(full, v.finalArray));
      const drawn = computeDraw(v.serverSeed, v.clientSeed, v.nonce);
      check(`${v.id} drawn a[0..9]`, eq(drawn, v.drawn), `got ${drawn.join(" ")}`);
      check(`${v.id} drawn sorted`, eq(sorted(drawn), v.drawnSorted));
      check(`${v.id} computeDrawFromBuffer == computeDraw`, eq(computeDrawFromBuffer(key, v.clientSeed, v.nonce), drawn));
      if (v.served) {
        check(`${v.id} same set as served order`, eq(sorted(drawn), sorted(v.served)));
        check(`${v.id} served order differs from a[0..9] (spec §2.3)`, !eq(drawn, v.served));
      }
      if (v.picks && v.hits !== undefined) {
        const h = v.picks.filter((p) => drawn.includes(p)).length;
        check(`${v.id} hits == ${v.hits}`, h === v.hits, `got ${h}`);
      }
    }

    for (const e of VERIFY) {
      const d = computeDraw(e.serverSeed, e.clientSeed, 0);
      check(`${e.id} grid`, eq(sorted(d), e.grid), `got ${sorted(d).join(" ")}`);
    }

    {
      const N = 2000;
      let legal = true;
      const census: DrawCensus = { hmacCalls: 0, chunksScanned: 0, chunksRejected: 0, cursorAdvances: 0 };
      let censusNeutral = true;
      const counts = new Array<number>(GRID_SIZE + 1).fill(0);
      for (let k = 0; k < N; k++) {
        const key = randomBytes(32);
        const cs = randomBytes(8).toString("base64url");
        const n = k % 60;
        const d = computeDrawFromBuffer(key, cs, n, GRID_SIZE, DRAWN_COUNT, census);
        const d2 = computeDrawFromBuffer(key, cs, n);
        if (!eq(d, d2)) censusNeutral = false;
        if (d.length !== 10 || new Set(d).size !== 10 || d.some((x) => !Number.isInteger(x) || x < 1 || x > 40)) legal = false;
        d.forEach((x) => counts[x]!++);
      }
      check(`range: ${N} random draws are 10 distinct integers in 1..40`, legal);
      check("census does not change the result", censusNeutral);
      check(`census hmacCalls == 39 x ${N}`, census.hmacCalls === 39 * N, `got ${census.hmacCalls}`);
      check("census chunksScanned == hmacCalls + chunksRejected", census.chunksScanned === census.hmacCalls + census.chunksRejected,
        `scanned ${census.chunksScanned} rejected ${census.chunksRejected}`);
      check("census cursorAdvances == 0 (spec never takes a second digest per step)", census.cursorAdvances === 0);
      // Each number expected N*10/40 = 500 times; 6 sigma band (sigma ~ sqrt(500*0.75) ~ 19.4).
      const lo = Math.min(...counts.slice(1));
      const hi = Math.max(...counts.slice(1));
      check("every number drawn within 500 +/- 117 times over 2000 draws", lo >= 383 && hi <= 617, `min ${lo} max ${hi}`);
    }
    {
      const s = V[0]!;
      check("verifyHash true with upper-case hash", verifyHash(s.serverSeed, s.commitment!.toUpperCase()));
      const flipped = s.commitment!.slice(0, -1) + (s.commitment!.endsWith("a") ? "b" : "a");
      check("verifyHash false on a changed hash", !verifyHash(s.serverSeed, flipped));
      check("verifyHash false on another seed's hash", !verifyHash(s.serverSeed, V[2]!.commitment!));
      const asciiHash = createHash("sha256").update(s.serverSeed, "utf8").digest("hex");
      check("verifyHash false on SHA-256 of the ASCII seed (§1.2 rejected form)", !verifyHash(s.serverSeed, asciiHash));
      check("verifyHash false on malformed seed", !verifyHash("zz" + s.serverSeed.slice(2), s.commitment!));
      let threw = false;
      try { computeDraw("abc", "x", 0); } catch { threw = true; }
      check("computeDraw rejects a malformed seed", threw);
      threw = false;
      try { computeDraw(s.serverSeed, "x", -1); } catch { threw = true; }
      check("computeDraw rejects a negative nonce", threw);
      check("nonce enters the draw: nonce 1 differs from nonce 0", !eq(computeDraw(s.serverSeed, s.clientSeed, 1), computeDraw(s.serverSeed, s.clientSeed, 0)));
    }


    return { pass: passed, total, failed };
}

describe('Spec self-test — src/rng.ts against docs/ALGORITHM.md (clean-room rebuild)', function () {
  this.timeout(300_000);
  it(`all ${EXPECTED_CHECKS} spec vector and property checks pass`, () => {
    const r = runSelftest();
    assert.deepStrictEqual(r.failed, []);
    assert.strictEqual(r.total, EXPECTED_CHECKS);
    assert.strictEqual(r.pass, EXPECTED_CHECKS);
  });
});

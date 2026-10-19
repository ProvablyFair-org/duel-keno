/**
 * LIVE CONFIGURATION SCALING (MANIFEST.md E14, "Current live configuration as of 5 October 2026").
 * INFORMATIONAL, NOT SCORED.
 *
 * Input of record: evidence/keno-config-live-2026-10-05.json, the response body of
 * duel.com/api/v2/keno/config as fetched 2026-10-05 in a logged-in session (read-only GET), saved byte for
 * byte. Its sidecar evidence/keno-config-live-2026-10-05.meta.json is the fetch tool's own record of
 * the path, HTTP status, response headers and fetch time, also unmodified. The audited April table is
 * kenoConfig.json. Both are SHA-256-checked before anything is computed.
 *
 * No scored step reads this module or its output: tests/verify.ts does not import it, and
 * outputs/verification-results.json does not depend on it.
 *
 * The live scaling_edge is keyed picks ("1".."10") → risk (CLASSIC/LOW/MEDIUM/HIGH) → tier list; each
 * tier is {id, config_id, min_bet, max_bet, house_edge, multipliers, probabilities}, bets and edges as
 * decimal strings. For each of the 40 risk × picks configurations this writes:
 *
 *   baseTierEqualsAudited  the 0.1% tier's multipliers equal the kenoConfig.json row, cell for cell
 *                          (differing cells listed)
 *   tierCount, contiguous  first min_bet is 0; every later min_bet equals the previous max_bet as a
 *                          string; every max_bet exceeds its min_bet (gaps and overlaps listed)
 *   edgeLadder             house_edge is 0.001 on the first tier and rises by exactly 0.0001 per tier
 *   threshold01            max_bet of the 0.1% tier
 *   maxBet, highestEdge    the last tier's max_bet and house_edge
 *   maxProfitAtMaxBet      maxBet × (largest multiplier of the last tier − 1)
 *   tiers[]                every tier: bet range, house_edge, exact RTP, RTP − (1 − house_edge)
 *   rtpMismatches          tiers whose |RTP − (1 − house_edge)| exceeds half a unit in the last
 *                          decimal place of that tier's longest multiplier literal: the most a row
 *                          computed exactly and then rounded to that many places can be off by
 *   lowestRtp              the lowest-RTP tier
 *
 * EXACT RTP: Σ_k C(n,k)·C(40−n,10−k)/C(40,10) × the tier's multiplier literal, in BigInt rationals
 * (src/exact.ts). The operator's probabilities field is not used. The literal of every tier
 * multiplier is checked to be the shortest round-trip rendering of its parsed value, so String(cell)
 * is the decimal the file carries.
 *
 *   npm run live-config            write outputs/run/live-config-scaling.json and compare it, byte for
 *                                  byte, with the committed outputs/live-config-scaling.json
 *   PF_EMIT=1 npm run live-config  rewrite the committed outputs/live-config-scaling.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { binom, hypergeometricWeights, exactRtp, decimal, sub, Rational } from './exact';
import { RtpClaim, RtpClaimAccumulator, toFixed } from './rtp-claim';

const ROOT = path.join(__dirname, '..');

export const LIVE_CONFIG_FILE = 'evidence/keno-config-live-2026-10-05.json';
export const LIVE_CONFIG_META = 'evidence/keno-config-live-2026-10-05.meta.json';
export const AUDITED_CONFIG_FILE = 'kenoConfig.json';
export const LIVE_CONFIG_OUTPUT = 'outputs/live-config-scaling.json';

/** SHA-256 of the input bytes. Not re-pinned to make a run pass: a changed input is a different input. */
export const INPUT_PINS: Record<string, string> = {
  [LIVE_CONFIG_FILE]: '787f9bad764a1cf5a8db9b7d166582b072c197a7ffd8eda6019d6c3817478d84',
  [LIVE_CONFIG_META]: '71a685bb12afab19a2acfb2177b4012be37840174a5e03c6ff2fcca4dbbf64da',
  [AUDITED_CONFIG_FILE]: 'efd3c645c4b3956199fde62dd65446c08e4605763d2d0f34c97a226bdbae4f91',
};

const RISKS = ['CLASSIC', 'LOW', 'MEDIUM', 'HIGH'] as const;
const BASE_EDGE = '0.001';
const ONE: Rational = { num: 1n, den: 1n };

/** A single 99.9% claim, evaluated over every tier for information only. */
const SINGLE_999_CLAIM: RtpClaim = {
  kind: 'flat',
  rtp: '0.999',
  source: 'informational test of a single 99.9% figure against every tier of the duel.com Keno configuration as fetched 2026-10-05 (E14); not the package claim, which is src/rtp-settings.ts',
};

interface Tier { id: number; config_id: number; min_bet: string; max_bet: string; house_edge: string; multipliers: number[]; probabilities: number[] }

const sha256 = (rel: string): string => createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');

/** Exact value printed in scientific notation with 3 significant digits, for reading only. */
function sci(r: Rational): string {
  if (r.num === 0n) return '0';
  const neg = r.num < 0n;
  let n = neg ? -r.num : r.num;
  const d = r.den;
  // find e with 10^e <= n/d < 10^(e+1)
  let e = n.toString().length - d.toString().length;
  const ge = (a: bigint, b: bigint, k: number): boolean => (k >= 0 ? a >= b * 10n ** BigInt(k) : a * 10n ** BigInt(-k) >= b);
  if (!ge(n, d, e)) e -= 1;
  // mantissa digits: round(n/d / 10^(e-2))
  const k = e - 2;
  const num = k >= 0 ? n : n * 10n ** BigInt(-k);
  const den = k >= 0 ? d * 10n ** BigInt(k) : d;
  let m = (num * 2n + den) / (den * 2n);
  if (m >= 1000n) { m = (m + 5n) / 10n; e += 1; }
  const s = m.toString();
  return `${neg ? '-' : ''}${s[0]}.${s.slice(1)}e${e}`;
}

const lt = (a: Rational, b: Rational): boolean => a.num * b.den < b.num * a.den;
const absR = (a: Rational): Rational => ({ num: a.num < 0n ? -a.num : a.num, den: a.den });
const pct = (r: Rational, places: number): string => toFixed({ n: r.num * 100n, d: r.den }, places);
const decimalsOf = (s: string): number => (s.split('.')[1] ?? '').length;

/** A non-negative rational rounded half-up to `places` decimals, printed as String(Number()) would print it. */
function roundHalfUp(r: Rational, places: number): string {
  const scale = 10n ** BigInt(places);
  const q = (r.num * scale * 2n + r.den) / (r.den * 2n);
  const s = q.toString().padStart(places + 1, '0');
  const body = places > 0 ? `${s.slice(0, s.length - places)}.${s.slice(s.length - places)}` : s;
  return places > 0 ? body.replace(/0+$/, '').replace(/\.$/, '') : body;
}

/** Every tier multiplier literal in the raw bytes, in file order, checked against String(parsed). */
function multiplierLiteralCheck(rawText: string): { arrays: number; cells: number; notRoundTrip: string[] } {
  const re = /"multipliers":\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  let arrays = 0, cells = 0;
  const notRoundTrip: string[] = [];
  while ((m = re.exec(rawText))) {
    arrays++;
    for (const lit of (m[1] as string).split(',')) { cells++; if (String(Number(lit)) !== lit) notRoundTrip.push(lit); }
  }
  return { arrays, cells, notRoundTrip };
}

export function computeLiveConfig(): Record<string, unknown> {
  for (const [rel, pin] of Object.entries(INPUT_PINS)) {
    const got = sha256(rel);
    if (got !== pin) throw new Error(`${rel}: SHA-256 ${got} does not match its pin ${pin}`);
  }
  const rawText = fs.readFileSync(path.join(ROOT, LIVE_CONFIG_FILE), 'utf8');
  const live = JSON.parse(rawText);
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, LIVE_CONFIG_META), 'utf8'));
  const audited = JSON.parse(fs.readFileSync(path.join(ROOT, AUDITED_CONFIG_FILE), 'utf8'));
  if (live.success !== true || typeof live.data !== 'object') throw new Error('live config is not a {success: true, data} response');
  const L = live.data, A = audited.data;

  const literals = multiplierLiteralCheck(rawText);
  if (literals.notRoundTrip.length) throw new Error(`tier multiplier literals that are not String(parsed): ${literals.notRoundTrip.slice(0, 5).join(', ')}`);

  const sameFields: Record<string, boolean> = {};
  for (const f of ['min_picks', 'max_picks', 'numbers_drawn', 'grid_size', 'difficulty_levels', 'multipliers', 'probabilities']) {
    sameFields[f] = JSON.stringify(L[f]) === JSON.stringify(A[f]);
  }
  const N: number = L.grid_size, D: number = L.numbers_drawn;
  const total = binom(N, D);
  const claim = new RtpClaimAccumulator(SINGLE_999_CLAIM, { retainRows: 0 });

  const configs: Array<Record<string, unknown>> = [];
  let tierTotal = 0;
  let worst: { config: string; houseEdge: string; rtp: Rational } | null = null;
  let maxAbsDev: { config: string; houseEdge: string; dev: Rational } | null = null;
  const allMismatches: string[] = [];
  let cellsCompared = 0;
  let largestCellDiff: { config: string; hits: number; diff: Rational } | null = null;
  const allDiffering: Array<{ audited: number; live: number }> = [];

  for (const risk of RISKS) {
    for (let picks = L.min_picks as number; picks <= (L.max_picks as number); picks++) {
      const name = `${risk}/${picks}`;
      const tiers: Tier[] = L.scaling_edge?.[String(picks)]?.[risk];
      if (!Array.isArray(tiers) || tiers.length === 0) throw new Error(`${name}: no scaling_edge tier list`);
      tierTotal += tiers.length;
      const w = hypergeometricWeights(N, D, picks);
      const auditedRow: number[] = A.multipliers[risk][String(picks)];

      // contiguity
      const gaps: string[] = [];
      if (decimal(tiers[0]!.min_bet).num !== 0n) gaps.push(`first min_bet ${tiers[0]!.min_bet}, not 0`);
      tiers.forEach((t, i) => {
        if (!lt(decimal(t.min_bet), decimal(t.max_bet))) gaps.push(`tier ${i}: max_bet ${t.max_bet} not above min_bet ${t.min_bet}`);
        if (i > 0 && t.min_bet !== tiers[i - 1]!.max_bet) gaps.push(`tier ${i}: min_bet ${t.min_bet} != previous max_bet ${tiers[i - 1]!.max_bet}`);
      });

      // edge ladder
      const ladder: string[] = [];
      tiers.forEach((t, i) => {
        // tier i must carry 0.001 + i × 0.0001 = (10 + i) / 10000
        const want: Rational = { num: BigInt(10 + i), den: 10000n };
        if (sub(decimal(t.house_edge), want).num !== 0n) ladder.push(`tier ${i}: house_edge ${t.house_edge}`);
      });

      // base tier vs audited table
      const base = tiers.filter(t => sub(decimal(t.house_edge), decimal(BASE_EDGE)).num === 0n);
      if (base.length !== 1) throw new Error(`${name}: ${base.length} tiers at house_edge ${BASE_EDGE}`);
      const b = base[0]!;
      const differingCells: Array<{ hits: number; audited: number; live: number; liveMinusAudited: string }> = [];
      const len = Math.max(b.multipliers.length, auditedRow.length);
      if (b.multipliers.length !== auditedRow.length) throw new Error(`${name}: 0.1% tier has ${b.multipliers.length} cells, audited row ${auditedRow.length}`);
      for (let k = 0; k < len; k++) {
        const a = auditedRow[k] as number, l = b.multipliers[k] as number;
        cellsCompared++;
        if (a === l) continue;
        const dr = sub(decimal(String(l)), decimal(String(a)));
        if (largestCellDiff === null || lt(largestCellDiff.diff, absR(dr))) largestCellDiff = { config: name, hits: k, diff: absR(dr) };
        allDiffering.push({ audited: a, live: l });
        differingCells.push({ hits: k, audited: a, live: l, liveMinusAudited: sci(dr) });
      }
      const oneTier = tiers.find(t => sub(decimal(t.house_edge), decimal('0.01')).num === 0n);

      // per-tier exact RTP
      const tierRows: Array<Record<string, unknown>> = [];
      const mism: string[] = [];
      let lowest: { houseEdge: string; rtp: Rational } | null = null;
      for (const t of tiers) {
        const lits = t.multipliers.map(c => String(c));
        if (lits.length !== picks + 1) throw new Error(`${name} tier ${t.id}: ${lits.length} multipliers for ${picks} picks`);
        const rtp = exactRtp(w, total, lits);
        const r: Rational = { num: rtp.num, den: rtp.den };
        const dev = sub(r, sub(ONE, decimal(t.house_edge)));
        const places = Math.max(...lits.map(decimalsOf));
        const bound: Rational = { num: 5n, den: 10n ** BigInt(places + 1) };
        const ok = !lt(bound, absR(dev));
        if (!ok) { mism.push(`house_edge ${t.house_edge}: RTP − (1 − edge) = ${sci(dev)}, bound ${sci(bound)}`); allMismatches.push(`${name} house_edge ${t.house_edge}`); }
        if (!lowest || lt(r, lowest.rtp)) lowest = { houseEdge: t.house_edge, rtp: r };
        if (!worst || lt(r, worst.rtp)) worst = { config: name, houseEdge: t.house_edge, rtp: r };
        if (!maxAbsDev || lt(absR(maxAbsDev.dev), absR(dev))) maxAbsDev = { config: name, houseEdge: t.house_edge, dev };
        claim.add(`risk=${risk} picks=${picks} house_edge=${t.house_edge}`, r.num, r.den);
        tierRows.push({
          minBet: t.min_bet, maxBet: t.max_bet, houseEdge: t.house_edge,
          rtpPct: pct(r, 10), rtpMinusOneMinusEdge: sci(dev), withinBound: ok,
        });
      }

      const last = tiers[tiers.length - 1]!;
      const topMult = Math.max(...last.multipliers.map(c => c));
      const maxProfit = sub({ num: decimal(last.max_bet).num * decimal(String(topMult)).num, den: decimal(last.max_bet).den * decimal(String(topMult)).den }, decimal(last.max_bet));

      configs.push({
        config: name, risk, picks,
        baseTierEqualsAudited: differingCells.length === 0, differingCells,
        tierCount: tiers.length, contiguous: gaps.length === 0, gaps,
        edgeLadderExact: ladder.length === 0, edgeLadderIssues: ladder,
        threshold01: b.max_bet,
        onePercentFromBet: oneTier ? oneTier.min_bet : null,
        maxBet: last.max_bet, highestEdge: last.house_edge,
        maxProfitAtMaxBet: toFixed({ n: maxProfit.num, d: maxProfit.den }, 6),
        scales: tiers.length > 1, reachesOnePercent: sub(decimal(last.house_edge), decimal('0.01')).num === 0n,
        rtpMismatches: mism,
        lowestRtp: { houseEdge: lowest!.houseEdge, rtpPct: pct(lowest!.rtp, 10) },
        tiers: tierRows,
      });
    }
  }

  const num = (s: unknown): Rational => decimal(String(s));
  const byThreshold = (list: Array<Record<string, unknown>>) => {
    const sorted = [...list].sort((x, y) => (lt(num(x.threshold01), num(y.threshold01)) ? -1 : lt(num(y.threshold01), num(x.threshold01)) ? 1 : 0));
    const f = sorted[0]!, l = sorted[sorted.length - 1]!;
    return { lowest: { config: f.config, threshold01: f.threshold01 }, highest: { config: l.config, threshold01: l.threshold01 } };
  };
  const scaling = configs.filter(c => c.scales);
  const never = configs.filter(c => !c.scales);
  const capped = configs.filter(c => !c.reachesOnePercent);
  const profits = [...new Set(capped.map(c => c.maxProfitAtMaxBet as string))];
  const cr = claim.result();

  return {
    about: 'Informational, not scored. duel.com Keno configuration as fetched 2026-10-05 in a logged-in session (read-only GET), evidence E14, compared with the audited April table kenoConfig.json. Generated by `npm run live-config` (src/live-config.ts).',
    inputs: {
      liveConfig: { file: LIVE_CONFIG_FILE, sha256: INPUT_PINS[LIVE_CONFIG_FILE], path: meta.path, status: meta.status, fetchedUtc: meta.fetched_utc, sidecar: LIVE_CONFIG_META, sidecarSha256: INPUT_PINS[LIVE_CONFIG_META] },
      auditedConfig: { file: AUDITED_CONFIG_FILE, sha256: INPUT_PINS[AUDITED_CONFIG_FILE] },
    },
    method: {
      rtp: 'exact rational: Σ_k C(n,k)·C(40−n,10−k)/C(40,10) × the tier multiplier literal (src/exact.ts); the operator probabilities field is not used',
      rtpBound: 'a tier mismatches when |RTP − (1 − house_edge)| exceeds 5×10^-(p+1), p = decimal places of the longest multiplier literal in that tier',
      maxProfitAtMaxBet: 'last tier max_bet × (largest multiplier of the last tier − 1), printed to 6 decimals; the response carries no max-profit field',
      baseTier: 'the house_edge 0.001 tier compared cell by cell (parsed values) with kenoConfig.json data.multipliers[risk][picks]',
      multiplierLiterals: `${literals.cells} multiplier literals in ${literals.arrays} tier arrays, all equal to String(parsed value)`,
    },
    topLevelFieldsEqualAudited: sameFields,
    summary: {
      configurations: configs.length,
      tiers: tierTotal,
      baseTierEqualsAuditedAll: configs.every(c => c.baseTierEqualsAudited),
      baseTierCells: (() => {
        // P = the most decimal places any differing live cell carries; is every differing live cell the
        // audited value rounded half-up to P places?
        const P = Math.max(0, ...allDiffering.map(d => decimalsOf(String(d.live))));
        const rounded = allDiffering.every(d => roundHalfUp(decimal(String(d.audited)), P) === String(d.live));
        return {
          compared: cellsCompared,
          equal: cellsCompared - allDiffering.length,
          differing: allDiffering.length,
          configsWithADifferingCell: configs.filter(c => !c.baseTierEqualsAudited).length,
          everyDifferingCellIsTheAuditedValueRoundedHalfUpToPlaces: allDiffering.length && rounded ? P : null,
          largestAbsoluteDifference: largestCellDiff ? { config: largestCellDiff.config, hits: largestCellDiff.hits, value: sci(largestCellDiff.diff) } : null,
        };
      })(),
      contiguousAll: configs.every(c => c.contiguous),
      edgeLadderExactAll: configs.every(c => c.edgeLadderExact),
      highestEdge: configs.reduce((m, c) => (lt(num(m), num(c.highestEdge)) ? (c.highestEdge as string) : m), BASE_EDGE),
      thresholdsOfScalingConfigs: byThreshold(scaling),
      thresholdsOfAllConfigs: byThreshold(configs),
      neverScale: never.map(c => c.config),
      neverScaleMaxProfitAtMaxBet: Object.fromEntries(never.map(c => [c.config as string, c.maxProfitAtMaxBet])),
      stopBelowOnePercent: capped.map(c => ({ config: c.config, tiers: c.tierCount, highestEdge: c.highestEdge, maxBet: c.maxBet, maxProfitAtMaxBet: c.maxProfitAtMaxBet })),
      maxProfitAtMaxBetOfConfigsStoppingBelowOnePercent: profits,
      worstRtp: { config: worst!.config, houseEdge: worst!.houseEdge, rtpPct: pct(worst!.rtp, 10) },
      largestRtpDeviation: { config: maxAbsDev!.config, houseEdge: maxAbsDev!.houseEdge, rtpMinusOneMinusEdge: sci(maxAbsDev!.dev) },
      rtpMismatches: allMismatches,
      rtpClaimInformational: {
        claim: 'single 99.9% (flat 0.999), band 0.1 pp, rule src/rtp-claim.ts',
        outcome: cr.outcome,
        tiersEvaluated: cr.settings,
        houseSideFailures: cr.houseSideFailures,
        trueMin: { setting: cr.trueMin.setting, rtpPct: cr.trueMin.rtpPct },
        trueMax: { setting: cr.trueMax.setting, rtpPct: cr.trueMax.rtpPct },
      },
    },
    configs,
  };
}

if (require.main === module) {
  const text = `${JSON.stringify(computeLiveConfig(), null, 2)}\n`;
  const emit = process.env.PF_EMIT === '1';
  const out = emit ? LIVE_CONFIG_OUTPUT : 'outputs/run/live-config-scaling.json';
  fs.mkdirSync(path.dirname(path.join(ROOT, out)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, out), text);
  const digest = createHash('sha256').update(text).digest('hex');
  console.log(`  [live-config] wrote ${out} sha256 ${digest}`);
  if (!emit) {
    const committed = path.join(ROOT, LIVE_CONFIG_OUTPUT);
    if (!fs.existsSync(committed)) { console.error(`  [live-config] ${LIVE_CONFIG_OUTPUT} is missing; PF_EMIT=1 npm run live-config writes it`); process.exit(1); }
    if (fs.readFileSync(committed, 'utf8') !== text) { console.error(`  [live-config] DIFFERS from the committed ${LIVE_CONFIG_OUTPUT}`); process.exit(1); }
    console.log(`  [live-config] REPRODUCED: identical to the committed ${LIVE_CONFIG_OUTPUT}`);
  }
}

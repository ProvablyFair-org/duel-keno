/**
 * RTP-CLAIM wiring — Duel Keno: the per-setting exact RTP table and the claim it is held to.
 *
 * The rule is src/rtp-claim.ts, a byte-identical copy of the framework's core/rtp-claim.ts (its
 * SHA-256 is compared by conformance C-13), version 1.2.0 (Methodology v1.1, agreed 2026-10-14;
 * 1.1.0 2026-10-01, 1.0.0 2026-09-29). The enforcement switch RTP_CLAIM_RULE_ENFORCED is read from
 * src/rtp-claim-switch.ts, true in this package (decision D3): the outcome is scored on the step
 * carrying KENO-19, and a house-side miss makes the verdict RTP FIGURE OVERSTATED (exit 5), never
 * NOT PROVABLY FAIR.
 *
 * CLAIM. Kind 'tiered' (rule 1.2.0, decision D2; Mike, 14 October 2026: "D2: as written. The edge in
 * Duel's game settings counts, no screenshot needed."). The game settings — the duel.com Keno
 * configuration E14 — state a house_edge for every stake tier of every (risk, picks) configuration
 * (scaling_edge, 91 distinct edges from 0.1% to 1.0%). Each row carries the tier it is priced at,
 * keyed by that stated edge ("house_edge=0.0021"), and is held to 1 − that edge within the band:
 *   live-2026-10-05 rows   the tier's own house_edge, from the same E14 entry the row is computed from;
 *   april-2026 rows        the 0.1% tier (house_edge=0.001): the audited April table, on which every
 *                          captured bet was priced (effective_edge 0.1 on all 5,100; every captured
 *                          stake below the lowest scaled threshold, $90.20; DL-9).
 * Until 14 October 2026 the claim was flat 99.9%, the help page's site-wide line ("At the moment we
 * stand at 99.9%", duel.com/wtf-duel, E15). Under D3 a site-wide line is noted, not tested; it is
 * recorded in MANIFEST.md, no longer the claim.
 *
 * SETTINGS, one bucket each:
 *   april-2026       the 40 (risk, picks) configurations of the audited table, kenoConfig.json
 *                    (pinned in src/loader.ts), at the 13-dp served multiplier (src/money.ts
 *                    displayMultiplier; the settlement rule Step 7 scores). The table literal differs
 *                    from the served figure by at most 7.2e-15 in RTP (DL-8).
 *   live-2026-10-05  every bet-size tier of the same 40 configurations in the duel.com Keno
 *                    configuration as fetched 2026-10-05 (E14, SHA-256 checked below), split into the
 *                    0.1 % tier and the scaled tiers, at the tier multiplier literal as served in that
 *                    response. Settlement on scaled tiers was not captured. The Zero Edge daily
 *                    allowance shown on the game page is not part of the configuration and is not
 *                    modelled.
 * EXACT RTP. Σ_k C(n,k)·C(40−n,10−k)/C(40,10) × the multiplier, BigInt rationals (src/exact.ts).
 *
 *   npm run rtp-claim:write    rewrite outputs/rtp-claim-table.json and print its SHA-256 to pin
 */
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { RtpClaim, RtpClaimAccumulator, RtpClaimResult, rtpClaimTable, rtpClaimGate, RtpClaimGate } from './rtp-claim';
import { KenoConfig } from './config';
import { binom, hypergeometricWeights, exactRtp } from './exact';
import { displayMultiplier } from './money';

/** E14, the duel.com Keno configuration as fetched 2026-10-05; the same pin src/live-config.ts holds. */
const LIVE_CONFIG_FILE = path.join(__dirname, '..', 'evidence', 'keno-config-live-2026-10-05.json');
const LIVE_CONFIG_SHA256 = '787f9bad764a1cf5a8db9b7d166582b072c197a7ffd8eda6019d6c3817478d84';

interface LiveTier { min_bet: string; max_bet: string; house_edge: string; multipliers: number[] }

/** The pinned E14 bytes; throws on a changed file (a changed input is a different input, not re-pinned). */
function liveConfigText(): string {
  const bytes = fs.readFileSync(LIVE_CONFIG_FILE);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== LIVE_CONFIG_SHA256) throw new Error(`rtp-settings: ${path.basename(LIVE_CONFIG_FILE)} SHA-256 ${sha} does not match its pin ${LIVE_CONFIG_SHA256}`);
  return bytes.toString('utf8');
}

/** The stake tier a row is priced at, keyed by the house_edge the game settings state for it. */
const tierOf = (houseEdge: string): string => `house_edge=${houseEdge}`;
/** The base tier: the audited April table and every captured bet (effective_edge 0.1). */
const BASE_EDGE = '0.001';

/** "0.0021" → "0.9979": 1 − a decimal edge, exact, as a decimal string. */
function oneMinus(edge: string): string {
  const m = /^0\.(\d+)$/.exec(edge);
  if (!m) throw new Error(`rtp-settings: house_edge ${edge} is not a decimal below 1`);
  const places = (m[1] as string).length;
  const scale = 10n ** BigInt(places);
  const rest = (scale - BigInt(m[1] as string)).toString().padStart(places, '0');
  return `0.${rest}`;
}

/** Every house_edge E14 states, ascending, each as a tier held to 1 − that edge. */
function statedTiers(): { tier: string; rtp: string; source: string }[] {
  const live = JSON.parse(liveConfigText()).data;
  const edges = new Set<string>();
  for (const byRisk of Object.values(live.scaling_edge ?? {}) as Record<string, LiveTier[]>[]) {
    for (const tiers of Object.values(byRisk)) for (const t of tiers) edges.add(t.house_edge);
  }
  if (!edges.has(BASE_EDGE)) throw new Error('rtp-settings: E14 states no 0.1% tier');
  return [...edges].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map(e => ({ tier: tierOf(e), rtp: oneMinus(e), source: `game settings: house_edge ${e} in scaling_edge (E14)` }));
}

export const RTP_CLAIM: RtpClaim = {
  kind: 'tiered',
  tiers: statedTiers(),
  source: 'game settings: the house_edge Duel\'s Keno configuration states for each stake tier of each (risk, picks) configuration (scaling_edge in GET https://duel.com/api/v2/keno/config as fetched 2026-10-05 in a logged-in session, read-only; E14, evidence/keno-config-live-2026-10-05.json); each row is held to 1 − the edge of the tier it is priced at. april-2026 rows: the audited April table, on which every captured bet was priced (effective_edge 0.1), held to the 0.1% tier. The help page\'s site-wide "At the moment we stand at 99.9%" (duel.com/wtf-duel, E15) is noted, not tested (MANIFEST.md#rtp-claim-as-shown-to-players)',
};

/** The scored step that carries KENO-19 (src/profile-map.ts). */
export const RTP_CLAIM_STEP = 17;

export const RTP_CLAIM_TABLE = path.join(__dirname, '..', 'outputs', 'rtp-claim-table.json');
/** SHA-256 of the committed table — re-pin with the run that rewrote it (npm run rtp-claim:write). */
export const RTP_CLAIM_TABLE_SHA256 = '01af5577a3032d467cd262fe4897705a6aa849f025b44f08283d35a1decceddb';

/** "90.202756812957645000" → "90.202756812957645"; "0.000000000000000000" → "0". Label text only. */
const trimDec = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

export function computeRtpClaim(): RtpClaimResult {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kenoConfig.json'), 'utf-8'));
  const cfg = new KenoConfig(raw.data);
  const total = binom(cfg.gridSize, cfg.drawnCount);
  const acc = new RtpClaimAccumulator(RTP_CLAIM);

  for (const { risk, picks } of cfg.allConfigs()) {
    const w = hypergeometricWeights(cfg.gridSize, cfg.drawnCount, picks);
    const paid = (raw.data.multipliers[risk][String(picks)] as number[]).map(c => displayMultiplier(c));
    const r = exactRtp(w, total, paid);
    acc.add(`april-2026 risk=${risk} picks=${picks}`, r.num, r.den, 'april-2026 audited table (kenoConfig.json)', tierOf(BASE_EDGE));
  }

  const liveText = liveConfigText();
  // Every tier multiplier literal must be String(parsed), so String(cell) is the decimal the file carries.
  for (const m of liveText.matchAll(/"multipliers":\[([^\]]*)\]/g)) {
    for (const lit of (m[1] as string).split(',')) {
      if (String(Number(lit)) !== lit) throw new Error(`rtp-settings: live multiplier literal ${lit} is not String(parsed)`);
    }
  }
  const live = JSON.parse(liveText).data;
  for (const { risk, picks } of cfg.allConfigs()) {
    const tiers: LiveTier[] = live.scaling_edge?.[String(picks)]?.[risk];
    if (!Array.isArray(tiers) || tiers.length === 0) throw new Error(`rtp-settings: live ${risk}/${picks} has no scaling_edge tiers`);
    const w = hypergeometricWeights(cfg.gridSize, cfg.drawnCount, picks);
    for (const t of tiers) {
      const lits = t.multipliers.map(c => String(c));
      if (lits.length !== picks + 1) throw new Error(`rtp-settings: live ${risk}/${picks} tier has ${lits.length} multipliers`);
      const r = exactRtp(w, total, lits);
      const base = t.house_edge === BASE_EDGE;
      acc.add(`live-2026-10-05 risk=${risk} picks=${picks} house_edge=${t.house_edge} bet ${trimDec(t.min_bet)}–${trimDec(t.max_bet)}`,
        r.num, r.den, base ? 'live-2026-10-05 0.1% tier (E14)' : 'live-2026-10-05 scaled tiers (E14)', tierOf(t.house_edge));
    }
  }
  return acc.result();
}

export function rtpClaimTableText(r: RtpClaimResult): string {
  return rtpClaimTable(r, {
    package: 'duel/keno', game: 'keno',
    settingSpace: 'april-2026: risk CLASSIC / LOW / MEDIUM / HIGH × picks 1–10, the 40 configurations of the audited table kenoConfig.json; live-2026-10-05: every bet-size tier of the same 40 configurations in the duel.com Keno configuration as fetched 2026-10-05 in a logged-in session (read-only GET; E14), 0.1% tier and scaled tiers bucketed apart. Each row carries the stake tier it is priced at, keyed by the house_edge E14 states for it (april-2026 rows: the 0.1% tier). The Zero Edge daily allowance shown on the game page is not part of the configuration and is not modelled',
    rtpMethod: 'exact rational: Σ_k C(n,k)·C(40−n,10−k)/C(40,10) × the multiplier; april-2026 rows on the 13-dp served multiplier (the settlement multiplier), live-2026-10-05 rows on the tier multiplier literal as served in E14 (settlement on scaled tiers was not captured)',
  });
}

export function runRtpClaimGate(): RtpClaimGate {
  const r = computeRtpClaim();
  return rtpClaimGate(r, rtpClaimTableText(r), RTP_CLAIM_TABLE, RTP_CLAIM_TABLE_SHA256);
}

if (require.main === module) {
  const text = rtpClaimTableText(computeRtpClaim());
  fs.writeFileSync(RTP_CLAIM_TABLE, text);
  console.log(`wrote outputs/rtp-claim-table.json sha256 ${createHash('sha256').update(text).digest('hex')}`);
}

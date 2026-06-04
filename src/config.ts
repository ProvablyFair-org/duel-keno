import type { KenoConfigData, RiskLevel } from './types';

const RISK_NAMES: RiskLevel[] = ['CLASSIC', 'LOW', 'MEDIUM', 'HIGH'];

/** Maps API difficulty integer (1–4) to RiskLevel string. */
export const DIFFICULTY_TO_RISK: Record<number, RiskLevel> = {
  1: 'CLASSIC',
  2: 'LOW',
  3: 'MEDIUM',
  4: 'HIGH',
};

export class KenoConfig {
  private readonly data: KenoConfigData;

  constructor(data: KenoConfigData) {
    this.data = data;
  }

  get gridSize(): number  { return this.data.grid_size; }
  get drawnCount(): number { return this.data.numbers_drawn; }
  get minPicks(): number  { return this.data.min_picks; }
  get maxPicks(): number  { return this.data.max_picks; }

  /** All 40 (risk, picks) configurations. */
  allConfigs(): Array<{ risk: RiskLevel; picks: number }> {
    const out: Array<{ risk: RiskLevel; picks: number }> = [];
    for (const risk of RISK_NAMES) {
      for (let picks = this.minPicks; picks <= this.maxPicks; picks++) {
        out.push({ risk, picks });
      }
    }
    return out;
  }

  /** Payout multiplier for (risk, picks, hits). */
  multiplier(risk: RiskLevel, picks: number, hits: number): number {
    const table = this.data.multipliers[risk]?.[String(picks)];
    if (!table) throw new Error(`No multiplier table for ${risk} picks=${picks}`);
    if (hits < 0 || hits > picks) throw new Error(`Invalid hits=${hits} for picks=${picks}`);
    return Number(table[hits] ?? 0);
  }

  /**
   * Hypergeometric probability: P(hits=k | picks, drawn=10, grid=40).
   * Uses independent combinatorics — NOT the casino-supplied probabilities field.
   * C(picks, k) × C(grid - picks, drawn - k) / C(grid, drawn)
   */
  hitProbability(picks: number, hits: number): number {
    const grid  = this.gridSize;
    const drawn = this.drawnCount;
    if (hits < 0 || hits > Math.min(picks, drawn)) return 0;
    if (drawn - hits > grid - picks) return 0;
    return (comb(picks, hits) * comb(grid - picks, drawn - hits)) / comb(grid, drawn);
  }

  /**
   * Theoretical RTP for (risk, picks):
   * Σ_k P(hits=k) × multiplier(risk, picks, k)
   * Computed from independent hypergeometric distribution.
   */
  theoreticalRTP(risk: RiskLevel, picks: number): number {
    let rtp = 0;
    for (let k = 0; k <= picks; k++) {
      rtp += this.hitProbability(picks, k) * this.multiplier(risk, picks, k);
    }
    return rtp;
  }
}

// ── Combinatorics ──────────────────────────────────────────────────────────────

const combCache = new Map<string, number>();

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const key = `${n},${k}`;
  if (combCache.has(key)) return combCache.get(key)!;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  const rounded = Math.round(result);
  combCache.set(key, rounded);
  return rounded;
}

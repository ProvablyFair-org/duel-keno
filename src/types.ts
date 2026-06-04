export type RiskLevel = 'CLASSIC' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface KenoConfigData {
  min_picks: number;
  max_picks: number;
  numbers_drawn: number;
  grid_size: number;
  difficulty_levels: number;
  multipliers: Record<string, Record<string, number[]>>;
  probabilities: Record<string, Record<string, number[]>>;
  scaling_edge: unknown[];
}

export interface KenoConfigFile {
  success: boolean;
  data: KenoConfigData;
}

export interface NextSeedPromotion {
  previousNextHash: string;
  newActiveHash: string;
  newNextHash: string;
  match: boolean;
}

export interface SeedEntry {
  at: string;
  context: string;
  phase: string;
  seed: {
    clientSeed: string;
    serverSeedHashed: string;
    nextServerSeedHash: string;
    serverSeed: string | null;
  };
  nonce: number;
  nextSeedPromotion?: NextSeedPromotion;
  revealedFrom?: { transactionId: number };
}

export interface BetRequest {
  amount: string;
  picks: number;
  risk: string;
  difficulty: number;
  selected_positions: number[];
}

export interface BetResponse {
  id: number;
  status: number;
  amount_currency: string;
  amount_won: string;
  multiplier: string;
  difficulty: number;
  selected_positions: number[];
  drawn_numbers: number[];
  transaction_id: number;
  effective_edge: number;
}

export interface BetSeed {
  serverSeedHashed: string;
  clientSeed: string;
  nonce: number;
}

export interface KenoBet {
  at: string;
  phase: string;
  request: BetRequest;
  response: BetResponse;
  seed: BetSeed;
}

export interface KenoDataset {
  meta: Record<string, unknown>;
  seeds: SeedEntry[];
  bets: KenoBet[];
}

export type Severity = 'HARD_FAIL' | 'FLAG' | 'INFO' | 'PASS';

export interface StepResult {
  step: number;
  name: string;
  ecRefs: string[];
  severity: Severity;
  pass: boolean;
  summary: string;
  failures: string[];
  details?: Record<string, unknown>;
}

export interface InfoItem {
  label: string;
  detail: string;
}

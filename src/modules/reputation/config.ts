import { ScoringConfig } from "./types";

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  initialScore: 50,
  maxScore: 100,
  minScore: 0,
  disputePenalty: 15,
  streakThreshold: 10,
  streakBonus: 5,
  minTransactionAmount: 20,
  maxPairwiseTransactions: 3,
  halfLifeMonths: 12,
};

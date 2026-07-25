import { Transaction, ScoringConfig, TrustScoreBreakdown } from "./types";
import { DEFAULT_SCORING_CONFIG } from "./config";

export function calculateTimeDecay(
  completedAt: Date,
  now: Date,
  halfLifeMonths: number
): number {
  const monthsElapsed =
    (now.getTime() - completedAt.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  return Math.pow(0.5, monthsElapsed / halfLifeMonths);
}

export function detectLongestStreak(
  transactions: Transaction[],
  userId: string
): number {
  const sorted = [...transactions].sort(
    (a, b) => a.completedAt.getTime() - b.completedAt.getTime()
  );
  let longestStreak = 0;
  let currentStreak = 0;

  for (const tx of sorted) {
    const isParticipant =
      tx.buyerId === userId || tx.sellerId === userId;
    if (isParticipant) {
      currentStreak++;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return longestStreak;
}

export function calculateTrustScore(
  userId: string,
  transactions: Transaction[],
  disputesLost: number,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): TrustScoreBreakdown {
  const now = new Date();
  const nowMs = now.getTime();
  let transactionBonus = 0;
  let timeDecayAdjustment = 0;

  const userTransactions = transactions.filter(
    (tx) => tx.buyerId === userId || tx.sellerId === userId
  );

  for (const tx of userTransactions) {
    if (tx.amount < config.minTransactionAmount) continue;
    const decay = calculateTimeDecay(tx.completedAt, now, config.halfLifeMonths);
    transactionBonus += 1.0 * decay;
    timeDecayAdjustment += decay;
  }

  const longestStreak = detectLongestStreak(transactions, userId);
  const streakBonus =
    longestStreak >= config.streakThreshold ? config.streakBonus : 0;

  const disputePenalty = disputesLost * config.disputePenalty;

  const baseScore = config.initialScore;
  const rawScore =
    baseScore + transactionBonus + streakBonus - disputePenalty;
  const finalScore = Math.max(
    config.minScore,
    Math.min(config.maxScore, Math.round(rawScore * 100) / 100)
  );

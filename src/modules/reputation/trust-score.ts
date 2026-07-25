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

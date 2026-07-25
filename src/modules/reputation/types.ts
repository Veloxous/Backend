export interface Transaction {
  id: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  currency: string;
  completedAt: Date;
  category: "buy" | "sell" | "swap" | "repair";
}

export interface Dispute {
  id: string;
  reporterId: string;
  respondentId: string;
  resolvedAt: Date;
  winnerId: string | null;
  loserId: string | null;
}

export interface ReputationProfile {
  userId: string;
  trustScore: number;
  totalTransactions: number;
  successfulTransactions: number;
  disputesWon: number;
  disputesLost: number;
  createdAt: Date;
  updatedAt: Date;
  isElite: boolean;
  isSuspended: boolean;
}

export interface TrustScoreBreakdown {
  baseScore: number;
  transactionBonus: number;
  timeDecayAdjustment: number;
  disputePenalty: number;
  streakBonus: number;
  sybilPenalty: number;
  finalScore: number;
}

export interface ReputationApiResponse {
  userId: string;
  trustScore: number;
  totalTransactions: number;
  successRate: number;
  lastDisputeDaysAgo: number | null;
  isElite: boolean;
  isSuspended: boolean;
}

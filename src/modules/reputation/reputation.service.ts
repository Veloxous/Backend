import { v4 as uuidv4 } from "uuid";
import {
  Transaction, Dispute, ReputationProfile,
  ReputationApiResponse, DeviceFingerprint,
} from "./types";
import { calculateTrustScore } from "./trust-score";
import { calculateSybilPenalty } from "./sybil-resistance";
import { DEFAULT_SCORING_CONFIG } from "./config";

const profiles = new Map<string, ReputationProfile>();
const transactions = new Map<string, Transaction[]>();
const disputes = new Map<string, Dispute[]>();
const fingerprints = new Map<string, DeviceFingerprint[]>();

export function resetStore(): void {
  profiles.clear();
  transactions.clear();
  disputes.clear();
  fingerprints.clear();
}

export function addTransaction(tx: Transaction): void {
  const existing = transactions.get(tx.buyerId) || [];
  existing.push(tx);
  transactions.set(tx.buyerId, existing);

  const sellerTx = transactions.get(tx.sellerId) || [];
  sellerTx.push(tx);
  transactions.set(tx.sellerId, sellerTx);
}

export function addDispute(dispute: Dispute): void {
  const existing = disputes.get(dispute.respondentId) || [];
  existing.push(dispute);
  disputes.set(dispute.respondentId, existing);
}

export function addFingerprint(fp: DeviceFingerprint): void {
  const existing = fingerprints.get(fp.userId) || [];
  existing.push(fp);
  fingerprints.set(fp.userId, existing);
}

export function calculateReputation(userId: string): ReputationProfile {
  const userTxs = transactions.get(userId) || [];
  const userDisputes = disputes.get(userId) || [];
  const disputesLost = userDisputes.filter((d) => d.loserId === userId).length;

  const scoreBreakdown = calculateTrustScore(userId, userTxs, disputesLost);

  const fpList = Array.from(fingerprints.values()).flat();
  const sybilResult = calculateSybilPenalty(userId, userTxs, fpList);

  const finalScore = Math.max(
    0,
    Math.min(100, scoreBreakdown.finalScore - sybilResult.penalty)
  );

  const existingProfile = profiles.get(userId);
  const profile: ReputationProfile = {
    userId,
    trustScore: finalScore,
    totalTransactions: userTxs.length,
    successfulTransactions: userTxs.length,
    disputesWon: userDisputes.filter((d) => d.winnerId === userId).length,
    disputesLost,
    createdAt: existingProfile?.createdAt || new Date(),
    updatedAt: new Date(),
    isElite: finalScore >= 90,
    isSuspended: finalScore < 20,
  };

  profiles.set(userId, profile);
  return profile;
}

export function getProfile(userId: string): ReputationProfile | undefined {
  return profiles.get(userId);
}

export function getReputationApiResponse(userId: string): ReputationApiResponse | null {
  const profile = profiles.get(userId);
  if (!profile) return null;

  const userDisputes = disputes.get(userId) || [];
  const lastDispute = userDisputes
    .sort((a, b) => b.resolvedAt.getTime() - a.resolvedAt.getTime())[0];

  const lastDisputeDaysAgo = lastDispute
    ? Math.floor(
        (Date.now() - lastDispute.resolvedAt.getTime()) / (1000 * 60 * 60 * 24)
      )
    : null;

  return {
    userId: profile.userId,
    trustScore: profile.trustScore,
    totalTransactions: profile.totalTransactions,
    successRate:
      profile.totalTransactions > 0
        ? Math.round((profile.successfulTransactions / profile.totalTransactions) * 10000) / 100
        : 0,
    lastDisputeDaysAgo,
    isElite: profile.isElite,
    isSuspended: profile.isSuspended,
  };
}

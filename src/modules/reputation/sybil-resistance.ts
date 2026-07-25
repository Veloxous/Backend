import { Transaction, PairwiseTransactionCount, DeviceFingerprint } from "./types";
import { DEFAULT_SCORING_CONFIG } from "./config";

export function detectSharedFingerprints(
  userId: string,
  fingerprints: DeviceFingerprint[],
  partnerIds: string[]
): boolean {
  const userFps = fingerprints
    .filter((fp) => fp.userId === userId)
    .map((fp) => fp.fingerprint);

  for (const partnerId of partnerIds) {
    const partnerFps = fingerprints
      .filter((fp) => fp.userId === partnerId)
      .map((fp) => fp.fingerprint);
    const shared = userFps.filter((fp) => partnerFps.includes(fp));
    if (shared.length > 0) return true;
  }

  return false;
}

export function buildPairwiseCounts(
  transactions: Transaction[]
): Map<string, PairwiseTransactionCount> {
  const counts = new Map<string, PairwiseTransactionCount>();

  for (const tx of transactions) {
    const pairKey = [tx.buyerId, tx.sellerId].sort().join(":");
    const existing = counts.get(pairKey);
    if (existing) {
      existing.count++;
    } else {
      counts.set(pairKey, {
        userA: [tx.buyerId, tx.sellerId].sort()[0],
        userB: [tx.buyerId, tx.sellerId].sort()[1],
        count: 1,
      });
    }
  }

  return counts;
}

export function getExcessPairwiseTransactions(
  userId: string,
  pairwiseCounts: Map<string, PairwiseTransactionCount>
): number {
  let excess = 0;
  const maxTx = DEFAULT_SCORING_CONFIG.maxPairwiseTransactions;

  for (const [key, pair] of pairwiseCounts) {
    if (key.includes(userId) && pair.count > maxTx) {
      excess += pair.count - maxTx;
    }
  }

  return excess;
}
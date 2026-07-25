import { resetStore, addTransaction, calculateReputation } from "../../modules/reputation/reputation.service";
import { Transaction } from "../../modules/reputation/types";
import { calculateSybilPenalty, buildPairwiseCounts } from "../../modules/reputation/sybil-resistance";

beforeEach(() => {
  resetStore();
});

describe("Sybil resistance - 50 same-pair transactions", () => {
  it("should barely move the trust score", () => {
    const txs: Transaction[] = Array.from({ length: 50 }, (_, i) => ({
      id: `tx-${i}`, buyerId: "sybil-A", sellerId: "sybil-B",
      amount: 50, currency: "USDC", completedAt: new Date(), category: "swap",
    }));
    txs.forEach(addTransaction);

    const profile = calculateReputation("sybil-A");
    expect(profile.trustScore).toBeLessThanOrEqual(60);
    expect(profile.totalTransactions).toBe(50);

    const penalty = calculateSybilPenalty("sybil-A", txs, []);
    expect(penalty.isSybil).toBe(true);
    expect(penalty.penalty).toBeGreaterThan(20);
  });

  it("pairwise count should be 50 for single pair", () => {
    const txs: Transaction[] = Array.from({ length: 50 }, (_, i) => ({
      id: `tx-${i}`, buyerId: "A", sellerId: "B",
      amount: 50, currency: "USDC", completedAt: new Date(), category: "sell",
    }));
    const counts = buildPairwiseCounts(txs);
    expect(counts.size).toBe(1);
    expect(counts.get("A:B")?.count).toBe(50);
  });
});

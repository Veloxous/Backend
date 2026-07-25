import { buildPairwiseCounts, getExcessPairwiseTransactions, calculateSybilPenalty } from "../../modules/reputation/sybil-resistance";
import { Transaction, DeviceFingerprint } from "../../modules/reputation/types";

describe("buildPairwiseCounts", () => {
  it("counts transactions between user pairs", () => {
    const txs: Transaction[] = [
      { id: "tx-1", buyerId: "A", sellerId: "B", amount: 50, currency: "USDC", completedAt: new Date(), category: "buy" },
      { id: "tx-2", buyerId: "B", sellerId: "A", amount: 50, currency: "USDC", completedAt: new Date(), category: "buy" },
    ];
    const counts = buildPairwiseCounts(txs);
    expect(counts.size).toBe(1);
    expect(counts.get("A:B")?.count).toBe(2);
  });
});

describe("getExcessPairwiseTransactions", () => {
  it("returns 0 when within pairwise limit", () => {
    const txs: Transaction[] = Array.from({ length: 3 }, (_, i) => ({
      id: `tx-${i}`, buyerId: "A", sellerId: "B",
      amount: 50, currency: "USDC", completedAt: new Date(), category: "buy",
    }));
    const counts = buildPairwiseCounts(txs);
    expect(getExcessPairwiseTransactions("A", counts)).toBe(0);
  });

  it("returns excess beyond limit", () => {
    const txs: Transaction[] = Array.from({ length: 6 }, (_, i) => ({
      id: `tx-${i}`, buyerId: "A", sellerId: "B",
      amount: 50, currency: "USDC", completedAt: new Date(), category: "buy",
    }));
    const counts = buildPairwiseCounts(txs);
    expect(getExcessPairwiseTransactions("A", counts)).toBe(3);
  });
});

describe("calculateSybilPenalty", () => {
  it("returns no penalty for normal transactions", () => {
    const txs: Transaction[] = Array.from({ length: 5 }, (_, i) => ({
      id: `tx-${i}`, buyerId: "A", sellerId: `user-${i}`,
      amount: 50, currency: "USDC", completedAt: new Date(), category: "buy",
    }));
    const result = calculateSybilPenalty("A", txs, []);
    expect(result.penalty).toBe(0);
    expect(result.isSybil).toBe(false);
  });

  it("penalizes excessive pairwise transactions", () => {
    const txs: Transaction[] = Array.from({ length: 15 }, (_, i) => ({
      id: `tx-${i}`, buyerId: "A", sellerId: "B",
      amount: 50, currency: "USDC", completedAt: new Date(), category: "buy",
    }));
    const result = calculateSybilPenalty("A", txs, []);
    expect(result.penalty).toBeGreaterThan(0);
    expect(result.isSybil).toBe(true);
  });

  it("flags shared device fingerprint as sybil", () => {
    const txs: Transaction[] = [
      { id: "tx-1", buyerId: "A", sellerId: "B", amount: 50, currency: "USDC", completedAt: new Date(), category: "buy" },
    ];
    const fps: DeviceFingerprint[] = [
      { userId: "A", ipAddress: "1.2.3.4", fingerprint: "fp-1", createdAt: new Date() },
      { userId: "B", ipAddress: "1.2.3.4", fingerprint: "fp-1", createdAt: new Date() },
    ];
    const result = calculateSybilPenalty("A", txs, fps);
    expect(result.isSybil).toBe(true);
    expect(result.penalty).toBeGreaterThanOrEqual(10);
  });
});

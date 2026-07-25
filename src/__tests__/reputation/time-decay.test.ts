import { calculateTrustScore } from "../../modules/reputation/trust-score";
import { Transaction } from "../../modules/reputation/types";

describe("Time decay behavior", () => {
  const userId = "user-1";

  it("recent transactions weigh more than old ones", () => {
    const recentTxs: Transaction[] = Array.from({ length: 5 }, (_, i) => ({
      id: `recent-${i}`, buyerId: userId, sellerId: `s-${i}`,
      amount: 50, currency: "USDC", completedAt: new Date(), category: "buy",
    }));

    const oldTxs: Transaction[] = Array.from({ length: 5 }, (_, i) => ({
      id: `old-${i}`, buyerId: userId, sellerId: `s-${i}`,
      amount: 50, currency: "USDC",
      completedAt: new Date(Date.now() - 24 * 30.44 * 24 * 60 * 60 * 1000),
      category: "buy",
    }));

    const recentResult = calculateTrustScore(userId, recentTxs, 0);
    const oldResult = calculateTrustScore(userId, oldTxs, 0);

    expect(recentResult.finalScore).toBeGreaterThan(oldResult.finalScore);
  });

  it("mixed age transactions produce moderate score", () => {
    const txs: Transaction[] = Array.from({ length: 10 }, (_, i) => ({
      id: `tx-${i}`, buyerId: userId, sellerId: `s-${i}`,
      amount: 50, currency: "USDC",
      completedAt: new Date(Date.now() - i * 6 * 30.44 * 24 * 60 * 60 * 1000),
      category: "buy",
    }));

    const result = calculateTrustScore(userId, txs, 0);
    expect(result.finalScore).toBeGreaterThan(50);
    expect(result.finalScore).toBeLessThan(100);
  });
});

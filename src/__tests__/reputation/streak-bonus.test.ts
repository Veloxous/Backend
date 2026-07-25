import { calculateTrustScore } from "../../modules/reputation/trust-score";
import { Transaction } from "../../modules/reputation/types";

describe("Streak bonus", () => {
  const userId = "user-1";

  it("applies streak bonus when >= 10 consecutive transactions", () => {
    const txs: Transaction[] = Array.from({ length: 12 }, (_, i) => ({
      id: `tx-${i}`, buyerId: userId, sellerId: `seller-${i}`,
      amount: 50, currency: "USDC", completedAt: new Date(), category: "buy",
    }));

    const result = calculateTrustScore(userId, txs, 0);
    expect(result.streakBonus).toBe(5);
  });

  it("does not apply streak bonus with < 10 consecutive", () => {
    const txs: Transaction[] = Array.from({ length: 8 }, (_, i) => ({
      id: `tx-${i}`, buyerId: userId, sellerId: `seller-${i}`,
      amount: 50, currency: "USDC", completedAt: new Date(), category: "buy",
    }));

    const result = calculateTrustScore(userId, txs, 0);
    expect(result.streakBonus).toBe(0);
  });
});

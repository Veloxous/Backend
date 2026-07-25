import { calculateTimeDecay, detectLongestStreak, calculateTrustScore } from "../../modules/reputation/trust-score";
import { Transaction } from "../../modules/reputation/types";

describe("calculateTimeDecay", () => {
  it("returns 1.0 for a transaction completed just now", () => {
    const now = new Date();
    const decay = calculateTimeDecay(now, now, 12);
    expect(decay).toBeCloseTo(1.0, 5);
  });

  it("returns ~0.5 after one half-life period", () => {
    const now = new Date();
    const oneHalfLifeAgo = new Date(now.getTime() - 12 * 30.44 * 24 * 60 * 60 * 1000);
    const decay = calculateTimeDecay(oneHalfLifeAgo, now, 12);
    expect(decay).toBeCloseTo(0.5, 2);
  });
});

describe("detectLongestStreak", () => {
  const userId = "user-1";

  it("returns 0 for no transactions", () => {
    expect(detectLongestStreak([], userId)).toBe(0);
  });

  it("counts consecutive transactions for user", () => {
    const txs: Transaction[] = Array.from({ length: 5 }, (_, i) => ({
      id: `tx-${i}`,
      buyerId: i % 2 === 0 ? userId : "other",
      sellerId: i % 2 === 0 ? "other" : userId,
      amount: 50,
      currency: "USDC",
      completedAt: new Date(Date.now() + i * 86400000),
      category: "buy",
    }));

    expect(detectLongestStreak(txs, userId)).toBe(5);
  });
});

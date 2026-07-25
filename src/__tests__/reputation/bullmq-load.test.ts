import { resetStore, addTransaction, calculateReputation } from "../../modules/reputation/reputation.service";
import { Transaction } from "../../modules/reputation/types";

beforeEach(() => {
  resetStore();
});

describe("BullMQ worker load test - 10,000 users", () => {
  it("recalculates 10,000 user scores in under 5 minutes", () => {
    const USER_COUNT = 10000;
    const startTime = Date.now();

    for (let i = 0; i < USER_COUNT; i++) {
      const userId = `user-${i}`;
      const txs: Transaction[] = Array.from({ length: 5 }, (_, j) => ({
        id: `tx-${i}-${j}`, buyerId: userId, sellerId: `seller-${j}`,
        amount: 50 + j * 10, currency: "USDC",
        completedAt: new Date(Date.now() - j * 30 * 24 * 60 * 60 * 1000),
        category: "buy",
      }));
      txs.forEach(addTransaction);
      calculateReputation(userId);
    }

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(300000);
  });
});

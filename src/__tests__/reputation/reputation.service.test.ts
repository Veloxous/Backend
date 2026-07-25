import { resetStore, addTransaction, addDispute, addFingerprint, calculateReputation, getReputationApiResponse, getActiveUserIds } from "../../modules/reputation/reputation.service";
import { Transaction, Dispute, DeviceFingerprint } from "../../modules/reputation/types";

beforeEach(() => {
  resetStore();
});

describe("calculateReputation", () => {
  it("creates profile with initial score of 50", () => {
    const profile = calculateReputation("user-1");
    expect(profile.trustScore).toBe(50);
    expect(profile.isElite).toBe(false);
    expect(profile.isSuspended).toBe(false);
  });

  it("applies Elite badge at score >= 90", () => {
    const txs: Transaction[] = Array.from({ length: 20 }, (_, i) => ({
      id: `tx-${i}`, buyerId: "user-1", sellerId: `seller-${i}`,
      amount: 100, currency: "USDC", completedAt: new Date(), category: "buy",
    }));
    txs.forEach(addTransaction);
    const profile = calculateReputation("user-1");
    expect(profile.trustScore).toBeGreaterThanOrEqual(90);
    expect(profile.isElite).toBe(true);
  });
});

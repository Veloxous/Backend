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

  it("suspends user when score drops below 20", () => {
    const disputes: Dispute[] = Array.from({ length: 3 }, (_, i) => ({
      id: `disp-${i}`, reporterId: "other", respondentId: "user-1",
      resolvedAt: new Date(), winnerId: "other", loserId: "user-1",
    }));
    disputes.forEach(addDispute);
    const profile = calculateReputation("user-1");
    expect(profile.trustScore).toBeLessThan(20);
    expect(profile.isSuspended).toBe(true);
  });
});

describe("getReputationApiResponse", () => {
  it("returns null for unknown user", () => {
    expect(getReputationApiResponse("unknown")).toBeNull();
  });

  it("returns sanitized response with success rate", () => {
    const txs: Transaction[] = Array.from({ length: 10 }, (_, i) => ({
      id: `tx-${i}`, buyerId: "user-1", sellerId: `seller-${i}`,
      amount: 50, currency: "USDC", completedAt: new Date(), category: "buy",
    }));
    txs.forEach(addTransaction);
    calculateReputation("user-1");
    const response = getReputationApiResponse("user-1");
    expect(response).not.toBeNull();
    expect(response!.successRate).toBe(100);
    expect(response!.totalTransactions).toBe(10);
  });
});

describe("getActiveUserIds", () => {
  it("returns users with recent transactions", () => {
    const txs: Transaction[] = [
      { id: "tx-1", buyerId: "user-1", sellerId: "user-2", amount: 50, currency: "USDC", completedAt: new Date(), category: "buy" },
    ];
    txs.forEach(addTransaction);
    const active = getActiveUserIds();
    expect(active).toContain("user-1");
    expect(active).toContain("user-2");
  });

  it("excludes users with only old transactions", () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const txs: Transaction[] = [
      { id: "tx-1", buyerId: "user-1", sellerId: "user-2", amount: 50, currency: "USDC", completedAt: oldDate, category: "buy" },
    ];
    txs.forEach(addTransaction);
    const active = getActiveUserIds();
    expect(active).toHaveLength(0);
  });
});

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

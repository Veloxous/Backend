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

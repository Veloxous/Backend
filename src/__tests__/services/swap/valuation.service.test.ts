import { ValuationService, CollateralCalculation } from "../../../services/swap/valuation.service";
import { PoolClient } from "pg";

describe("ValuationService", () => {
  let valuationService: ValuationService;
  let mockClient: any;

  beforeEach(() => {
    valuationService = new ValuationService();
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
  });

  describe("calculateCollateral", () => {
    it("should calculate collateral correctly when both listings have estimated values", async () => {
      // Mock listings with estimated values
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: "listing-a", owner_id: "user-a", device_type: "iphone-13", estimated_value: 800 },
          { id: "listing-b", owner_id: "user-b", device_type: "macbook-pro-14", estimated_value: 1500 },
        ],
      });

      const result = await valuationService.calculateCollateral(
        mockClient,
        "listing-a",
        "listing-b"
      );

      expect(result.partyACollateral).toBe(1500); // A deposits B's value
      expect(result.partyBCollateral).toBe(800); // B deposits A's value
      expect(result.valueMismatch).toBe(true); // 800/1500 = 0.53 < 0.5 threshold
      expect(result.topUpAmount).toBe(700); // 1500 - 800
      expect(result.topUpRecipient).toBe("user-b"); // Owner of more expensive device
    });

    it("should not require top-up when values are within threshold", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: "listing-a", owner_id: "user-a", device_type: "iphone-13", estimated_value: 800 },
          { id: "listing-b", owner_id: "user-b", device_type: "iphone-14", estimated_value: 900 },
        ],
      });

      const result = await valuationService.calculateCollateral(
        mockClient,
        "listing-a",
        "listing-b"
      );

      expect(result.partyACollateral).toBe(900);
      expect(result.partyBCollateral).toBe(800);
      expect(result.valueMismatch).toBe(false); // 800/900 = 0.89 > 0.5 threshold
      expect(result.topUpAmount).toBeNull();
      expect(result.topUpRecipient).toBeNull();
    });

    it("should fetch historical average when listing lacks estimated value", async () => {
      // First query returns listings (one without estimated value)
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: "listing-a", owner_id: "user-a", device_type: "iphone-13", estimated_value: null },
          { id: "listing-b", owner_id: "user-b", device_type: "macbook-pro-14", estimated_value: 1500 },
        ],
      });

      // Second query fetches historical average for iphone-13
      mockClient.query.mockResolvedValueOnce({
        rows: [{ avg_value: "750" }],
      });

      const result = await valuationService.calculateCollateral(
        mockClient,
        "listing-a",
        "listing-b"
      );

      expect(result.partyACollateral).toBe(1500);
      expect(result.partyBCollateral).toBe(750); // Historical average
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it("should use fallback value when no historical data exists", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: "listing-a", owner_id: "user-a", device_type: "unknown-device", estimated_value: null },
          { id: "listing-b", owner_id: "user-b", device_type: "iphone-14", estimated_value: 900 },
        ],
      });

      // Historical query returns no data
      mockClient.query.mockResolvedValueOnce({
        rows: [{ avg_value: null }],
      });

      const result = await valuationService.calculateCollateral(
        mockClient,
        "listing-a",
        "listing-b"
      );

      expect(result.partyBCollateral).toBe(500); // Fallback default value
    });

    it("should use device-specific fallback values", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: "listing-a", owner_id: "user-a", device_type: "iphone-13", estimated_value: null },
          { id: "listing-b", owner_id: "user-b", device_type: "samsung-s23", estimated_value: null },
        ],
      });

      // Both historical queries return no data
      mockClient.query.mockResolvedValueOnce({ rows: [{ avg_value: null }] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ avg_value: null }] });

      const result = await valuationService.calculateCollateral(
        mockClient,
        "listing-a",
        "listing-b"
      );

      expect(result.partyACollateral).toBe(700); // samsung-s23 fallback
      expect(result.partyBCollateral).toBe(800); // iphone-13 fallback
    });

    it("should throw error when listings are not found", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: "listing-a", owner_id: "user-a", device_type: "iphone-13", estimated_value: 800 },
        ],
      });

      await expect(
        valuationService.calculateCollateral(mockClient, "listing-a", "listing-b")
      ).rejects.toThrow("One or both listings not found");
    });

    it("should calculate top-up for party with cheaper device", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: "listing-a", owner_id: "user-a", device_type: "old-laptop", estimated_value: 200 },
          { id: "listing-b", owner_id: "user-b", device_type: "iphone-13", estimated_value: 800 },
        ],
      });

      const result = await valuationService.calculateCollateral(
        mockClient,
        "listing-a",
        "listing-b"
      );

      expect(result.valueMismatch).toBe(true); // 200/800 = 0.25 < 0.5
      expect(result.topUpAmount).toBe(600); // 800 - 200
      expect(result.topUpRecipient).toBe("user-b"); // Owner of iPhone (more valuable)
    });

    it("should handle equal values correctly", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: "listing-a", owner_id: "user-a", device_type: "iphone-13", estimated_value: 800 },
          { id: "listing-b", owner_id: "user-b", device_type: "iphone-13", estimated_value: 800 },
        ],
      });

      const result = await valuationService.calculateCollateral(
        mockClient,
        "listing-a",
        "listing-b"
      );

      expect(result.partyACollateral).toBe(800);
      expect(result.partyBCollateral).toBe(800);
      expect(result.valueMismatch).toBe(false); // 800/800 = 1.0 > 0.5
      expect(result.topUpAmount).toBeNull();
    });

    it("should correctly identify top-up recipient when A has higher value", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: "listing-a", owner_id: "user-a", device_type: "macbook-pro-14", estimated_value: 2000 },
          { id: "listing-b", owner_id: "user-b", device_type: "iphone-13", estimated_value: 500 },
        ],
      });

      const result = await valuationService.calculateCollateral(
        mockClient,
        "listing-a",
        "listing-b"
      );

      expect(result.topUpAmount).toBe(1500); // 2000 - 500
      expect(result.topUpRecipient).toBe("user-a"); // Owner of MacBook
    });
  });

  describe("getHistoricalAverage (private method behavior)", () => {
    it("should return average from completed listings", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ avg_value: "850.50" }],
      });

      // Access private method via reflection for testing
      const historicalAverage = await (valuationService as any).getHistoricalAverage(
        mockClient,
        "iphone-13"
      );

      expect(historicalAverage).toBe(850.50);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("AVG(estimated_value)"),
        ["iphone-13"]
      );
    });

    it("should return fallback when no completed listings exist", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ avg_value: null }],
      });

      const historicalAverage = await (valuationService as any).getHistoricalAverage(
        mockClient,
        "iphone-13"
      );

      expect(historicalAverage).toBe(800); // iphone-13 fallback
    });
  });
});

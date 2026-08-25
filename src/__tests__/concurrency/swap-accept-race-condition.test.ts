import request from "supertest";
import express from "express";
import { pool, withTransaction } from "../../db/db";
import swapsRouter from "../../routes/swaps";
import { ValuationService } from "../../services/swap/valuation.service";
import { SwapTimeoutWorker } from "../../workers/swap-timeout.worker";

// Mock the services
jest.mock("../../services/swap/valuation.service");
jest.mock("../../workers/swap-timeout.worker");
jest.mock("../../db/db", () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
  withTransaction: jest.fn(),
}));

describe("Concurrency Tests: Swap Accept Race Conditions", () => {
  let app: express.Application;
  let mockValuationService: jest.Mocked<ValuationService>;
  let mockSwapTimeoutWorker: jest.Mocked<typeof SwapTimeoutWorker>;

  const mockUserA = "user-a-id";
  const mockUserB = "user-b-id";
  const mockListingA = "listing-a-id";
  const mockListingB = "listing-b-id";
  const mockSwapId = "swap-id";

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Express app
    app = express();
    app.use(express.json());
    app.use("/swaps", swapsRouter);

    // Mock services
    mockValuationService = ValuationService.prototype as jest.Mocked<ValuationService>;
    mockSwapTimeoutWorker = SwapTimeoutWorker as jest.Mocked<typeof SwapTimeoutWorker>;

    // Mock withTransaction to simulate database row locking
    (withTransaction as jest.Mock).mockImplementation(async (callback) => {
      const mockClient = {
        query: jest.fn(),
      };
      return await callback(mockClient as any);
    });
  });

  describe("Simultaneous Accept Requests for Same Listing", () => {
    it("should allow exactly 1 success and 9 failures when 10 requests accept the same swap", async () => {
      // Setup: Create a swap in proposed state
      let acceptCount = 0;
      let firstAcceptLock = false;

      // Mock withTransaction to simulate row-level locking
      (withTransaction as jest.Mock).mockImplementation(async (callback) => {
        const mockClient = {
          query: jest.fn(),
        };

        // First query: get swap with FOR UPDATE
        mockClient.query.mockImplementationOnce(async () => {
          // Simulate row lock - only first request gets through
          if (!firstAcceptLock) {
            firstAcceptLock = true;
            return {
              rows: [
                {
                  id: mockSwapId,
                  state: "proposed",
                  proposer_id: mockUserA,
                  counterparty_id: mockUserB,
                  listing_a_id: mockListingA,
                  listing_b_id: mockListingB,
                },
              ],
            };
          } else {
            // Subsequent requests see the swap as already agreed
            return {
              rows: [],
            };
          }
        });

        // Second query: get listings with FOR UPDATE
        mockClient.query.mockImplementationOnce(async () => {
          if (acceptCount === 0) {
            return {
              rows: [
                { id: mockListingA, is_locked: false, current_swap_id: mockSwapId },
                { id: mockListingB, is_locked: false, current_swap_id: mockSwapId },
              ],
            };
          }
          return { rows: [] };
        });

        // Third query: update swap to agreed
        mockClient.query.mockImplementationOnce(async () => {
          acceptCount++;
          return {
            rows: [
              {
                id: mockSwapId,
                state: "agreed",
                agreed_at: new Date().toISOString(),
                party_a_collateral_amount: 1500,
                party_b_collateral_amount: 800,
                top_up_amount: 700,
                top_up_recipient: mockUserB,
              },
            ],
          };
        });

        // Fourth query: lock listings
        mockClient.query.mockResolvedValueOnce({});

        try {
          const result = await callback(mockClient as any);
          return result;
        } catch (error: any) {
          if (error.message.includes("no longer available")) {
            throw error;
          }
          throw error;
        }
      });

      // Mock collateral calculation
      mockValuationService.calculateCollateral.mockResolvedValue({
        partyACollateral: 1500,
        partyBCollateral: 800,
        topUpAmount: 700,
        topUpRecipient: mockUserB,
        valueMismatch: true,
      });

      // Mock timeout scheduling
      mockSwapTimeoutWorker.scheduleSwapMonitoring.mockResolvedValue(undefined);

      // Fire 10 simultaneous accept requests
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .patch(`/swaps/${mockSwapId}/accept`)
          .set("x-user-id", mockUserA)
      );

      const responses = await Promise.all(requests);

      // Count successes and failures
      const successes = responses.filter((r: any) => r.status === 200);
      const conflicts = responses.filter((r: any) => r.status === 409);
      const errors = responses.filter((r: any) => r.status === 400);

      console.log(`Results: ${successes.length} success, ${conflicts.length} conflicts, ${errors.length} errors`);

      // Assertions
      console.log(responses[0].body); expect(successes.length).toBe(1);
      expect(conflicts.length + errors.length).toBe(9);

      // Verify the successful response
      expect(successes[0].body.state).toBe("agreed");
      expect(successes[0].body.party_a_collateral_amount).toBe(1500);

      // Verify collateral calculation was called exactly once
      expect(mockValuationService.calculateCollateral).toHaveBeenCalledTimes(1);

      // Verify timeout monitoring was scheduled exactly once
      expect(mockSwapTimeoutWorker.scheduleSwapMonitoring).toHaveBeenCalledTimes(1);
    });

    it("should handle race condition when listing becomes locked during accept", async () => {
      let lockCount = 0;

      (withTransaction as jest.Mock).mockImplementation(async (callback) => {
        const mockClient = {
          query: jest.fn(),
        };

        // First query: get swap
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              id: mockSwapId,
              state: "proposed",
              proposer_id: mockUserA,
              counterparty_id: mockUserB,
              listing_a_id: mockListingA,
              listing_b_id: mockListingB,
            },
          ],
        });

        // Second query: get listings - simulate one getting locked
        mockClient.query.mockImplementationOnce(async () => {
          lockCount++;
          if (lockCount === 1) {
            // First request sees both listings available
            return {
              rows: [
                { id: mockListingA, is_locked: false, current_swap_id: mockSwapId },
                { id: mockListingB, is_locked: false, current_swap_id: mockSwapId },
              ],
            };
          } else {
            // Subsequent requests see one listing locked
            return {
              rows: [
                { id: mockListingA, is_locked: true, current_swap_id: mockSwapId },
              ],
            };
          }
        });

        // Third query: update swap to agreed (only called for successful request)
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              id: mockSwapId,
              state: "agreed",
              agreed_at: new Date().toISOString(),
              party_a_collateral_amount: 1500,
              party_b_collateral_amount: 800,
              top_up_amount: null,
              top_up_recipient: null,
            },
          ],
        });

        // Fourth query: update listings
        mockClient.query.mockResolvedValueOnce({});

        try {
          const result = await callback(mockClient as any);
          return result;
        } catch (error: any) {
          throw error;
        }
      });

      mockValuationService.calculateCollateral.mockResolvedValue({
        partyACollateral: 1500,
        partyBCollateral: 800,
        topUpAmount: null,
        topUpRecipient: null,
        valueMismatch: false,
      });

      mockSwapTimeoutWorker.scheduleSwapMonitoring.mockResolvedValue(undefined);

      // Removed mock pool.query as it's now handled by mockClient

      // Fire 5 simultaneous requests
      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .patch(`/swaps/${mockSwapId}/accept`)
          .set("x-user-id", mockUserA)
      );

      const responses = await Promise.all(requests);

      const successes = responses.filter((r: any) => r.status === 200);
      const conflicts = responses.filter((r: any) => r.status === 409);

      console.log(responses[0].body); expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(4);
    });
  });

  describe("Concurrent Counter-Offers", () => {
    it("should handle concurrent counter-offers gracefully", async () => {
      let counterCount = 0;

      (withTransaction as jest.Mock).mockImplementation(async (callback) => {
        const mockClient = {
          query: jest.fn(),
        };

        mockClient.query.mockImplementationOnce(async () => {
          counterCount++;
          if (counterCount === 1) {
            return {
              rows: [
                {
                  id: mockSwapId,
                  state: "proposed",
                  counterparty_id: mockUserB,
                },
              ],
            };
          } else {
            // Subsequent counter offers see swap as already countered
            return {
              rows: [],
            };
          }
        });

        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              id: mockSwapId,
              state: "countered",
              counter_offer_details: { message: "First counter" },
            },
          ],
        });

        try {
          const result = await callback(mockClient as any);
          return result;
        } catch (error: any) {
          throw error;
        }
      });

      // Fire 3 simultaneous counter-offer requests
      const requests = Array.from({ length: 3 }, (_, i) =>
        request(app)
          .patch(`/swaps/${mockSwapId}/counter`)
          .set("x-user-id", mockUserB)
          .send({ message: `Counter offer ${i + 1}` })
      );

      const responses = await Promise.all(requests);

      const successes = responses.filter((r: any) => r.status === 200);
      const failures = responses.filter((r: any) => r.status === 400);

      console.log(responses[0].body); expect(successes.length).toBe(1);
      expect(failures.length).toBe(2);
    });
  });

  describe("Concurrent Reject Operations", () => {
    it("should handle concurrent reject operations safely", async () => {
      let rejectCount = 0;

      (withTransaction as jest.Mock).mockImplementation(async (callback) => {
        const mockClient = {
          query: jest.fn(),
        };

        mockClient.query.mockImplementationOnce(async () => {
          rejectCount++;
          if (rejectCount === 1) {
            return {
              rows: [
                {
                  id: mockSwapId,
                  state: "proposed",
                  listing_a_id: mockListingA,
                  listing_b_id: mockListingB,
                },
              ],
            };
          } else {
            // Subsequent rejects see swap as already rejected
            return {
              rows: [],
            };
          }
        });

        mockClient.query.mockResolvedValueOnce({});
        mockClient.query.mockResolvedValueOnce({});

        try {
          const result = await callback(mockClient as any);
          return result;
        } catch (error: any) {
          throw error;
        }
      });

      // Fire 3 simultaneous reject requests
      const requests = Array.from({ length: 3 }, () =>
        request(app)
          .patch(`/swaps/${mockSwapId}/reject`)
          .set("x-user-id", mockUserB)
      );

      const responses = await Promise.all(requests);

      const successes = responses.filter((r: any) => r.status === 200);
      const failures = responses.filter((r: any) => r.status === 400);

      console.log(responses[0].body); expect(successes.length).toBe(1);
      expect(failures.length).toBe(2);
    });
  });

  describe("Mixed Concurrent Operations", () => {
    it("should handle mixed concurrent operations (accept, counter, reject)", async () => {
      let operationCount = 0;

      (withTransaction as jest.Mock).mockImplementation(async (callback) => {
        const mockClient = {
          query: jest.fn(),
        };

        operationCount++;

        // First operation wins (let's say it's an accept)
        if (operationCount === 1) {
          mockClient.query.mockResolvedValueOnce({
            rows: [
              {
                id: mockSwapId,
                state: "proposed",
                proposer_id: mockUserA,
                counterparty_id: mockUserB,
                listing_a_id: mockListingA,
                listing_b_id: mockListingB,
              },
            ],
          });
          mockClient.query.mockResolvedValueOnce({
            rows: [
              { id: mockListingA, is_locked: false, current_swap_id: mockSwapId },
              { id: mockListingB, is_locked: false, current_swap_id: mockSwapId },
            ],
          });
          mockClient.query.mockResolvedValueOnce({
            rows: [{ id: mockSwapId, state: "agreed" }],
          });
          mockClient.query.mockResolvedValueOnce({});
        } else {
          // Other operations fail because state changed
          mockClient.query.mockResolvedValueOnce({ rows: [] });
        }

        try {
          const result = await callback(mockClient as any);
          return result;
        } catch (error: any) {
          throw error;
        }
      });

      mockValuationService.calculateCollateral.mockResolvedValue({
        partyACollateral: 1500,
        partyBCollateral: 800,
        topUpAmount: null,
        topUpRecipient: null,
        valueMismatch: false,
      });

      mockSwapTimeoutWorker.scheduleSwapMonitoring.mockResolvedValue(undefined);

      // Fire mixed operations
      const requests = [
        request(app)
          .patch(`/swaps/${mockSwapId}/accept`)
          .set("x-user-id", mockUserA),
        request(app)
          .patch(`/swaps/${mockSwapId}/counter`)
          .set("x-user-id", mockUserB)
          .send({ message: "Counter" }),
        request(app)
          .patch(`/swaps/${mockSwapId}/reject`)
          .set("x-user-id", mockUserB),
      ];

      const responses = await Promise.all(requests);

      const successes = responses.filter((r: any) => r.status === 200);
      const failures = responses.filter((r: any) => r.status === 400 || r.status === 409);

      console.log(responses[0].body); expect(successes.length).toBe(1);
      expect(failures.length).toBe(2);
    });
  });
});

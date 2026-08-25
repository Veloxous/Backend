import request from "supertest";
import express from "express";
import { pool, withTransaction } from "../../db/db";
import swapsRouter from "../../routes/swaps";
import { ValuationService } from "../../services/swap/valuation.service";
import { SorobanTransactionService } from "../../services/swap/soroban-transaction.service";
import { SwapTimeoutWorker } from "../../workers/swap-timeout.worker";

// Mock the services
jest.mock("../../services/swap/valuation.service");
jest.mock("../../services/swap/soroban-transaction.service");
jest.mock("../../workers/swap-timeout.worker");
jest.mock("../../db/db", () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
  withTransaction: jest.fn(),
}));

describe("Swap Negotiation Flow Integration Tests", () => {
  let app: express.Application;
  let mockValuationService: jest.Mocked<ValuationService>;
  let mockSorobanService: jest.Mocked<SorobanTransactionService>;
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
    mockSorobanService = SorobanTransactionService.prototype as jest.Mocked<SorobanTransactionService>;
    mockSwapTimeoutWorker = SwapTimeoutWorker as jest.Mocked<typeof SwapTimeoutWorker>;

    // Mock withTransaction to execute callback directly
    (withTransaction as jest.Mock).mockImplementation(async (callback) => {
      return await callback(pool as any);
    });
  });

  describe("Full Negotiation Flow: Propose -> Counter -> Accept", () => {
    it("should successfully complete the full negotiation flow", async () => {
      // Step 1: Propose a swap
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [
            {
              id: mockListingA,
              owner_id: mockUserA,
              current_swap_id: null,
              is_locked: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: mockListingB,
              owner_id: mockUserB,
              current_swap_id: null,
              is_locked: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: mockSwapId,
              listing_a_id: mockListingA,
              listing_b_id: mockListingB,
              proposer_id: mockUserA,
              counterparty_id: mockUserB,
              state: "proposed",
            },
          ],
        });

      const proposeResponse = await request(app)
        .post("/swaps")
        .set("x-user-id", mockUserA)
        .send({ listing_b_id: mockListingB });

      expect(proposeResponse.status).toBe(201);
      expect(proposeResponse.body.state).toBe("proposed");
      expect(proposeResponse.body.proposer_id).toBe(mockUserA);
      expect(proposeResponse.body.counterparty_id).toBe(mockUserB);

      // Step 2: Counter the swap
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            id: mockSwapId,
            state: "proposed",
            counterparty_id: mockUserB,
          },
        ],
      });
      // Mock the UPDATE query
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            id: mockSwapId,
            state: "countered",
            counter_offer_details: { message: "Can we adjust the terms?", new_terms: { condition: "excellent" } },
          },
        ],
      });

      const counterResponse = await request(app)
        .patch(`/swaps/${mockSwapId}/counter`)
        .set("x-user-id", mockUserB)
        .send({ message: "Can we adjust the terms?", new_terms: { condition: "excellent" } });

      expect(counterResponse.status).toBe(200);
      expect(counterResponse.body.state).toBe("countered");
      expect(counterResponse.body.counter_offer_details).toEqual({
        message: "Can we adjust the terms?",
        new_terms: { condition: "excellent" },
      });

      // Step 3: Accept the counter-offer
      // Mock swap retrieval
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            id: mockSwapId,
            state: "countered",
            proposer_id: mockUserA,
            counterparty_id: mockUserB,
            listing_a_id: mockListingA,
            listing_b_id: mockListingB,
          },
        ],
      });

      // Mock listings retrieval (both available)
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          { id: mockListingA, is_locked: false, current_swap_id: mockSwapId },
          { id: mockListingB, is_locked: false, current_swap_id: mockSwapId },
        ],
      });

      // Mock collateral calculation
      mockValuationService.calculateCollateral.mockResolvedValue({
        partyACollateral: 1500,
        partyBCollateral: 800,
        topUpAmount: 700,
        topUpRecipient: mockUserB,
        valueMismatch: true,
      });

      // Mock swap update
      (pool.query as jest.Mock).mockResolvedValueOnce({
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
      });

      // Mock timeout scheduling
      mockSwapTimeoutWorker.scheduleSwapMonitoring.mockResolvedValue(undefined);

      const acceptResponse = await request(app)
        .patch(`/swaps/${mockSwapId}/accept`)
        .set("x-user-id", mockUserA);

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body.state).toBe("agreed");
      expect(acceptResponse.body.party_a_collateral_amount).toBe(1500);
      expect(acceptResponse.body.party_b_collateral_amount).toBe(800);
      expect(acceptResponse.body.top_up_amount).toBe(700);
      expect(acceptResponse.body.value_mismatch).toBe(true);
      expect(acceptResponse.body.top_up_suggested).toBe(true);

      // Verify collateral calculation was called
      expect(mockValuationService.calculateCollateral).toHaveBeenCalledWith(
        expect.any(Object),
        mockListingA,
        mockListingB
      );

      // Verify timeout monitoring was scheduled
      expect(mockSwapTimeoutWorker.scheduleSwapMonitoring).toHaveBeenCalledWith(mockSwapId);
    });

    it("should handle direct accept without counter-offer", async () => {
      // Propose
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: mockListingA, owner_id: mockUserA, current_swap_id: null, is_locked: false }] })
        .mockResolvedValueOnce({ rows: [{ id: mockListingB, owner_id: mockUserB, current_swap_id: null, is_locked: false }] })
        .mockResolvedValueOnce({ rows: [{ id: mockSwapId, listing_a_id: mockListingA, listing_b_id: mockListingB, proposer_id: mockUserA, counterparty_id: mockUserB, state: "proposed" }] });

      await request(app)
        .post("/swaps")
        .set("x-user-id", mockUserA)
        .send({ listing_b_id: mockListingB });

      // Accept directly (from proposed state)
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: mockSwapId, state: "proposed", proposer_id: mockUserA, counterparty_id: mockUserB, listing_a_id: mockListingA, listing_b_id: mockListingB }] })
        .mockResolvedValueOnce({ rows: [{ id: mockListingA, is_locked: false, current_swap_id: mockSwapId }, { id: mockListingB, is_locked: false, current_swap_id: mockSwapId }] });

      mockValuationService.calculateCollateral.mockResolvedValue({
        partyACollateral: 900,
        partyBCollateral: 900,
        topUpAmount: null,
        topUpRecipient: null,
        valueMismatch: false,
      });

      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: mockSwapId, state: "agreed", agreed_at: new Date().toISOString(), party_a_collateral_amount: 900, party_b_collateral_amount: 900, top_up_amount: null, top_up_recipient: null }],
      });

      mockSwapTimeoutWorker.scheduleSwapMonitoring.mockResolvedValue(undefined);

      const acceptResponse = await request(app)
        .patch(`/swaps/${mockSwapId}/accept`)
        .set("x-user-id", mockUserB);

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body.state).toBe("agreed");
      expect(acceptResponse.body.value_mismatch).toBe(false);
      expect(acceptResponse.body.top_up_suggested).toBe(false);
    });
  });

  describe("State Transitions and Validation", () => {
    it("should reject counter-offer from non-counterparty", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
      });

      const response = await request(app)
        .patch(`/swaps/${mockSwapId}/counter`)
        .set("x-user-id", mockUserA) // Wrong user (proposer trying to counter)
        .send({ message: "Counter offer" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("cannot be countered");
    });

    it("should reject accept from unauthorized user", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: mockSwapId, state: "proposed", proposer_id: mockUserA, counterparty_id: mockUserB }],
      });

      const response = await request(app)
        .patch(`/swaps/${mockSwapId}/accept`)
        .set("x-user-id", "unauthorized-user");

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Not authorized");
    });

    it("should reject accept when listings are no longer available", async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: mockSwapId, state: "proposed", proposer_id: mockUserA, counterparty_id: mockUserB, listing_a_id: mockListingA, listing_b_id: mockListingB }] })
        .mockResolvedValueOnce({ rows: [{ id: mockListingA, is_locked: false, current_swap_id: mockSwapId }] }); // Only one listing available

      const response = await request(app)
        .patch(`/swaps/${mockSwapId}/accept`)
        .set("x-user-id", mockUserA);

      expect(response.status).toBe(409);
      expect(response.body.error).toContain("Conflict");
    });

    it("should successfully reject a swap proposal", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: mockSwapId, state: "proposed", listing_a_id: mockListingA, listing_b_id: mockListingB }],
      });

      const response = await request(app)
        .patch(`/swaps/${mockSwapId}/reject`)
        .set("x-user-id", mockUserB);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("rejected");
    });
  });

  describe("Transaction XDR Generation", () => {
    it("should generate XDR for proposer's collateral deposit", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            id: mockSwapId,
            state: "agreed",
            proposer_id: mockUserA,
            counterparty_id: mockUserB,
            party_a_collateral_amount: 1500,
            party_b_collateral_amount: 800,
          },
        ],
      });

      mockSorobanService.getSequenceNumber.mockResolvedValue("1234567890");
      mockSorobanService.buildDepositCollateralXDR.mockResolvedValue("mock-xdr-string");

      const response = await request(app)
        .get(`/swaps/${mockSwapId}/transaction`)
        .set("x-user-id", mockUserA)
        .set("x-stellar-public-key", "GABC...");

      expect(response.status).toBe(200);
      expect(response.body.swap_id).toBe(mockSwapId);
      expect(response.body.required_collateral).toBe(1500);
      expect(response.body.xdr).toBe("mock-xdr-string");
      expect(response.body.sequence_number).toBe("1234567890");

      expect(mockSorobanService.buildDepositCollateralXDR).toHaveBeenCalledWith(
        mockSwapId,
        1500,
        "GABC...",
        "1234567890"
      );
    });

    it("should generate XDR for counterparty's collateral deposit", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            id: mockSwapId,
            state: "agreed",
            proposer_id: mockUserA,
            counterparty_id: mockUserB,
            party_a_collateral_amount: 1500,
            party_b_collateral_amount: 800,
          },
        ],
      });

      mockSorobanService.getSequenceNumber.mockResolvedValue("1234567890");
      mockSorobanService.buildDepositCollateralXDR.mockResolvedValue("mock-xdr-string");

      const response = await request(app)
        .get(`/swaps/${mockSwapId}/transaction`)
        .set("x-user-id", mockUserB)
        .set("x-stellar-public-key", "GXYZ...");

      expect(response.status).toBe(200);
      expect(response.body.required_collateral).toBe(800); // Party B's amount
    });

    it("should reject XDR generation for non-participant", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            id: mockSwapId,
            state: "agreed",
            proposer_id: mockUserA,
            counterparty_id: mockUserB,
            party_a_collateral_amount: 1500,
            party_b_collateral_amount: 800,
          },
        ],
      });

      const response = await request(app)
        .get(`/swaps/${mockSwapId}/transaction`)
        .set("x-user-id", "unauthorized-user")
        .set("x-stellar-public-key", "GABC...");

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Not authorized");
    });
  });

  describe("State Progression: Collateralized -> Shipped -> Completed", () => {
    it("should mark swap as collateralized", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: mockSwapId, state: "agreed" }],
      });

      const response = await request(app).post(`/swaps/${mockSwapId}/collateralized`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("collateralized");
    });

    it("should mark swap as shipped", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: mockSwapId, state: "collateralized", proposer_id: mockUserA, counterparty_id: mockUserB }],
      });

      const response = await request(app)
        .post(`/swaps/${mockSwapId}/shipped`)
        .set("x-user-id", mockUserA);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("shipped");
    });

    it("should mark swap as completed and unlock listings", async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: mockSwapId, state: "shipped", proposer_id: mockUserA, counterparty_id: mockUserB, listing_a_id: mockListingA, listing_b_id: mockListingB }],
        })
        .mockResolvedValueOnce({}) // Update swap
        .mockResolvedValueOnce({}); // Update listings

      const response = await request(app)
        .post(`/swaps/${mockSwapId}/complete`)
        .set("x-user-id", mockUserA);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("completed");
    });
  });
});

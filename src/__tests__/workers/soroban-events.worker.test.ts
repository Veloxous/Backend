import { SorobanEventsWorker } from "../../workers/soroban-events.worker";
import { SorobanService } from "../../services/stellar/soroban.service";
import { pool, withTransaction } from "../../db/db";
import { xdr, StrKey } from "@stellar/stellar-sdk";

jest.mock("../../services/stellar/soroban.service");
jest.mock("../../db/db", () => ({
  pool: {
    query: jest.fn(),
  },
  withTransaction: jest.fn(),
}));

// ── XDR helpers ──────────────────────────────────────────────────────────────

function symbolTopic(name: string): string {
  return xdr.ScVal.scvSymbol(name).toXDR("base64");
}

function i128ScVal(value: bigint): string {
  const lo = value & BigInt("0xFFFFFFFFFFFFFFFF");
  const hi = value >> BigInt(64);
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({ hi: xdr.Int64.fromString(hi.toString()), lo: xdr.Uint64.fromString(lo.toString()) })
  ).toXDR("base64");
}

function contractAddressScVal(): { scVal: string; strKey: string } {
  const bytes = Buffer.alloc(32, 7);
  const strKey = StrKey.encodeContract(bytes);
  return {
    scVal: xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeContract(bytes)).toXDR("base64"),
    strKey,
  };
}

function makeEvent(overrides: Record<string, any> = {}): any {
  return {
    id: "event-1",
    txHash: "tx_hash_1",
    topic: [symbolTopic("EscrowFunded")],
    value: { xdr: undefined },
    ...overrides,
  };
}

describe("SorobanEventsWorker", () => {
  let worker: SorobanEventsWorker;
  let mockSorobanService: jest.Mocked<SorobanService>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SWAP_CONTRACT_ID = "C_SWAP_CONTRACT";
    mockSorobanService = new SorobanService() as jest.Mocked<SorobanService>;
    worker = new SorobanEventsWorker();
    (worker as any).service = mockSorobanService;
  });

  describe("parseEventPayload (Unit)", () => {
    it("parses an EscrowFunded event with amount and party from real XDR", () => {
      const addr = contractAddressScVal();
      const event = makeEvent({
        txHash: "funded_tx",
        topic: [symbolTopic("EscrowFunded"), addr.scVal],
        value: { xdr: i128ScVal(BigInt("5000000")) },
      });

      const parsed = (worker as any).parseEventPayload(event);

      expect(parsed.transaction_id).toBe("funded_tx");
      expect(parsed.event_type).toBe("EscrowFunded");
      expect(parsed.amount).toBe("5000000");
      expect(parsed.party).toBe(addr.strKey);
    });

    it("parses EscrowReleased and DisputeRaised variants", () => {
      const released = (worker as any).parseEventPayload(makeEvent({ topic: [symbolTopic("EscrowReleased")] }));
      expect(released.event_type).toBe("EscrowReleased");

      const dispute = (worker as any).parseEventPayload(makeEvent({ topic: [symbolTopic("DisputeRaised")] }));
      expect(dispute.event_type).toBe("DisputeRaised");
    });

    it("throws on undecodable event values so the caller routes it to the DLQ", () => {
      const event = makeEvent({ value: { xdr: "!!!not-base64-xdr!!!" } });

      expect(() => (worker as any).parseEventPayload(event)).toThrow();
    });

    it("falls back to Unknown fields when only the topic symbol is present", () => {
      const parsed = (worker as any).parseEventPayload(makeEvent());

      expect(parsed.event_type).toBe("EscrowFunded");
      expect(parsed.amount).toBe("0");
      expect(parsed.party).toBe("Unknown");
    });
  });

  describe("Integration Tests", () => {
    function setupHappyPathDb() {
      // getLastProcessedLedger
      (pool.query as jest.Mock).mockImplementation(async (query: string, params?: any[]) => {
        if (query.includes("SELECT last_processed_ledger")) {
          return { rows: [{ last_processed_ledger: 1000 }] };
        }
        if (query.includes("INSERT INTO failed_events")) {
          return { rowCount: 1, rows: [] };
        }
        // UPDATE indexer_state
        return { rowCount: 1, rows: [] };
      });
      (withTransaction as jest.Mock).mockImplementation(async (cb) => {
        await cb({ query: jest.fn().mockResolvedValue({}) });
      });
    }

    it("processes an event sequence into escrow_transactions and advances the cursor", async () => {
      setupHappyPathDb();
      const addr = contractAddressScVal();
      mockSorobanService.getLatestLedger.mockResolvedValue(1005);
      mockSorobanService.getEvents.mockResolvedValue([
        makeEvent({
          id: "e1",
          txHash: "tx_1",
          topic: [symbolTopic("EscrowFunded"), addr.scVal],
          value: { xdr: i128ScVal(BigInt(250)) },
        }),
        makeEvent({ id: "e2", txHash: "tx_2", topic: [symbolTopic("EscrowReleased")] }),
      ] as any);

      await (worker as any).processNextBatch();

      // Events fetched with BOTH contract IDs
      expect(mockSorobanService.getEvents).toHaveBeenCalledWith(
        1001,
        1003,
        expect.arrayContaining(["C_MOCK_CONTRACT_ID", "C_SWAP_CONTRACT"]),
        expect.any(Array)
      );

      // Both rows inserted idempotently inside transactions
      expect(withTransaction).toHaveBeenCalledTimes(2);
      const insertCalls = (withTransaction as jest.Mock).mock.calls.flatMap(([, ...rest]: any[]) => rest);
      void insertCalls;

      // Cursor advanced once to the batch end
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE indexer_state SET last_processed_ledger = $1"),
        [1003]
      );
    });

    it("does NOT advance the cursor when a DB update fails mid-batch", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ last_processed_ledger: 1000 }] });
      mockSorobanService.getLatestLedger.mockResolvedValue(1005);
      mockSorobanService.getEvents.mockResolvedValue([
        makeEvent({ id: "e1", txHash: "tx_db_fail" }),
      ] as any);
      (withTransaction as jest.Mock).mockRejectedValue(new Error("DB Connection Lost"));

      // The failure propagates out of the batch...
      await expect((worker as any).processNextBatch()).rejects.toThrow("DB Connection Lost");

      // ...and the cursor was never advanced, so this tick is retried.
      const cursorUpdates = (pool.query as jest.Mock).mock.calls.filter(([q]) =>
        String(q).includes("UPDATE indexer_state")
      );
      expect(cursorUpdates).toHaveLength(0);
    });

    it("parks malformed events in the DLQ but still processes good ones and advances the cursor", async () => {
      setupHappyPathDb();
      mockSorobanService.getLatestLedger.mockResolvedValue(1005);
      mockSorobanService.getEvents.mockResolvedValue([
        makeEvent({ id: "bad", txHash: "bad_tx", value: { xdr: "!!!not-xdr!!!" } }),
        makeEvent({ id: "good", txHash: "good_tx" }),
      ] as any);

      await (worker as any).processNextBatch();

      // Bad event went to failed_events...
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO failed_events"),
        ["bad_tx", expect.any(String), expect.any(String)]
      );
      // ...good event still committed via its transaction...
      expect(withTransaction).toHaveBeenCalledTimes(1);
      // ...and the cursor advanced past both.
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE indexer_state SET last_processed_ledger = $1"),
        [1003]
      );
    });
  });

  describe("Idempotency", () => {
    it("inserts with ON CONFLICT DO NOTHING so replayed events are skipped", async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
      const clientQuery = jest.fn().mockResolvedValue({});
      (withTransaction as jest.Mock).mockImplementation(async (cb) => {
        await cb({ query: clientQuery });
      });

      await (worker as any).processEventWithDLQ(makeEvent() as any);

      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining("ON CONFLICT (transaction_id) DO NOTHING"),
        expect.any(Array)
      );
    });
  });
});

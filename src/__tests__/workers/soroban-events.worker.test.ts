import { SorobanEventsWorker } from "../../workers/soroban-events.worker";
import { SorobanService } from "../../services/stellar/soroban.service";
import { pool, withTransaction } from "../../db/db";
import { xdr, StrKey, Address } from "@stellar/stellar-sdk";
import { NotificationService, NotificationType } from "../../services/notification.service";

jest.mock("../../services/stellar/soroban.service");
jest.mock("../../db/db", () => ({
  pool: {
    query: jest.fn(),
  },
  withTransaction: jest.fn(),
}));
jest.mock("../../services/notification.service", () => ({
  NotificationService: { send: jest.fn() },
  NotificationType: {
    ESCROW_FUNDED: "ESCROW_FUNDED",
    ITEM_SHIPPED: "ITEM_SHIPPED",
    DISPUTE_RAISED: "DISPUTE_RAISED",
    REPUTATION_TIER_CHANGED: "REPUTATION_TIER_CHANGED",
  },
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

function u64ScVal(value: bigint): string {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(value.toString())).toXDR("base64");
}

function i64ScVal(value: bigint): string {
  return xdr.ScVal.scvI64(xdr.Int64.fromString(value.toString())).toXDR("base64");
}

function contractAddressScVal(): { scVal: string; strKey: string } {
  const bytes = Buffer.alloc(32, 7);
  const strKey = StrKey.encodeContract(bytes);
  return {
    scVal: xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeContract(bytes)).toXDR("base64"),
    strKey,
  };
}

function accountAddressScVal(): { scVal: string; publicKey: string } {
  const kp = (globalThis as any).__testKeypair ?? ((globalThis as any).__testKeypair = require("@stellar/stellar-sdk").Keypair.random());
  // These union constructors exist at runtime but aren't in the SDK's type defs.
  const xdrAny = xdr as any;
  const switchOn = xdrAny.PublicKeyType.publicKeyTypeEd25519();
  const acc = new xdrAny.AccountId(switchOn, kp.rawPublicKey());
  return {
    scVal: xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(acc)).toXDR("base64"),
    publicKey: kp.publicKey(),
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
    process.env.ESCROW_CONTRACT_ID = "C_MOCK_CONTRACT_ID";
    process.env.SWAP_CONTRACT_ID = "C_SWAP_CONTRACT";
    mockSorobanService = new SorobanService() as jest.Mocked<SorobanService>;
    worker = new SorobanEventsWorker();
    (worker as any).service = mockSorobanService;
  });

  describe("constructor", () => {
    it("throws a clear configuration error when ESCROW_CONTRACT_ID is missing", () => {
      delete process.env.ESCROW_CONTRACT_ID;

      expect(() => new SorobanEventsWorker()).toThrow("ESCROW_CONTRACT_ID must be configured");
    });
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

    it("extracts account addresses via the SDK Address abstraction", () => {
      const acct = accountAddressScVal();
      const event = makeEvent({
        txHash: "acct_tx",
        topic: [symbolTopic("EscrowReleased"), acct.scVal],
      });

      const parsed = (worker as any).parseEventPayload(event);

      expect(parsed.party).toBe(acct.publicKey);
      // A valid Stellar StrKey address
      expect(StrKey.isValidEd25519PublicKey(parsed.party)).toBe(true);
    });

    it.each([
      ["u64", u64ScVal(BigInt(250)), "250"],
      ["i64", i64ScVal(BigInt(-75)), "-75"],
    ])("parses %s amounts as signed/unsigned respectively", (_kind, scVal, expected) => {
      const parsed = (worker as any).parseEventPayload(
        makeEvent({ txHash: "amt_tx", value: { xdr: scVal } })
      );

      expect(parsed.amount).toBe(expected);
    });

    it("parses EscrowReleased and DisputeRaised variants", () => {
      const released = (worker as any).parseEventPayload(makeEvent({ topic: [symbolTopic("EscrowReleased")] }));
      expect(released.event_type).toBe("EscrowReleased");

      const dispute = (worker as any).parseEventPayload(makeEvent({ topic: [symbolTopic("DisputeRaised")] }));
      expect(dispute.event_type).toBe("DisputeRaised");
    });

    it("throws so the event is DLQ'd when no topic resolves the event type", () => {
      const event = makeEvent({ topic: [] });

      expect(() => (worker as any).parseEventPayload(event)).toThrow(/does not resolve to a known escrow event type/);
    });

    it("throws so the event is DLQ'd when both txHash and id are absent", () => {
      const event = makeEvent({ id: undefined, txHash: undefined });

      expect(() => (worker as any).parseEventPayload(event)).toThrow(/neither txHash nor id/);
    });

    it("falls back to event.id for the transaction id when txHash is missing", () => {
      const parsed = (worker as any).parseEventPayload(makeEvent({ id: "evt-only", txHash: undefined }));

      expect(parsed.transaction_id).toBe("evt-only");
    });

    it("throws on undecodable event values so the caller routes it to the DLQ", () => {
      const event = makeEvent({ value: { xdr: "!!!not-base64-xdr!!!" } });

      expect(() => (worker as any).parseEventPayload(event)).toThrow();
    });
  });

  describe("Integration Tests", () => {
    function setupHappyPathDb(): jest.Mock {
      const clientQuery = jest.fn().mockResolvedValue({});
      (pool.query as jest.Mock).mockImplementation(async (query: string) => {
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
        await cb({ query: clientQuery });
      });
      return clientQuery;
    }

    it("processes an event sequence into escrow_transactions and advances the cursor", async () => {
      const clientQuery = setupHappyPathDb();
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

      // Events fetched with BOTH contract IDs and wildcard-padded topics
      expect(mockSorobanService.getEvents).toHaveBeenCalledWith(
        1001,
        1003,
        expect.arrayContaining(["C_MOCK_CONTRACT_ID", "C_SWAP_CONTRACT"]),
        [
          [expect.any(String), "*", "*"],
          [expect.any(String), "*", "*"],
          [expect.any(String), "*", "*"],
        ]
      );

      // Both rows inserted idempotently inside transactions — verify contents
      expect(withTransaction).toHaveBeenCalledTimes(2);
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining("ON CONFLICT (transaction_id) DO NOTHING"),
        ["tx_1", "EscrowFunded", "250", addr.strKey]
      );
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining("ON CONFLICT (transaction_id) DO NOTHING"),
        ["tx_2", "EscrowReleased", "0", "Unknown"]
      );

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

    it("DLQs events without a resolvable event type instead of inserting Unknown rows", async () => {
      setupHappyPathDb();
      mockSorobanService.getLatestLedger.mockResolvedValue(1005);
      mockSorobanService.getEvents.mockResolvedValue([
        makeEvent({ id: "no-type", txHash: "", topic: [] }),
      ] as any);

      await (worker as any).processNextBatch();

      expect(withTransaction).not.toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO failed_events"),
        ["no-type", expect.any(String), expect.stringMatching(/does not resolve|neither txHash/)]
      );
      // Cursor still advances — the event is safely parked for replay
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE indexer_state SET last_processed_ledger = $1"),
        [1003]
      );
    });

    describe("Notification triggers", () => {
      it("sends an ESCROW_FUNDED notification with the party address as userId when an EscrowFunded event commits", async () => {
        setupHappyPathDb();
        const addr = contractAddressScVal();
        mockSorobanService.getLatestLedger.mockResolvedValue(1005);
        mockSorobanService.getEvents.mockResolvedValue([
          makeEvent({
            id: "e1",
            txHash: "tx_funded",
            topic: [symbolTopic("EscrowFunded"), addr.scVal],
            value: { xdr: i128ScVal(BigInt(250)) },
          }),
        ] as any);

        await (worker as any).processNextBatch();

        expect(NotificationService.send).toHaveBeenCalledWith({
          type: NotificationType.ESCROW_FUNDED,
          userId: addr.strKey,
          payload: { transactionId: "tx_funded", amount: "250" },
        });
      });

      it("sends a DISPUTE_RAISED notification when a DisputeRaised event commits", async () => {
        setupHappyPathDb();
        const addr = contractAddressScVal();
        mockSorobanService.getLatestLedger.mockResolvedValue(1005);
        mockSorobanService.getEvents.mockResolvedValue([
          makeEvent({
            id: "e1",
            txHash: "tx_dispute",
            topic: [symbolTopic("DisputeRaised"), addr.scVal],
          }),
        ] as any);

        await (worker as any).processNextBatch();

        expect(NotificationService.send).toHaveBeenCalledWith({
          type: NotificationType.DISPUTE_RAISED,
          userId: addr.strKey,
          payload: { transactionId: "tx_dispute", amount: "0" },
        });
      });

      it("does not notify for event types with no mapped notification (e.g. EscrowReleased)", async () => {
        setupHappyPathDb();
        mockSorobanService.getLatestLedger.mockResolvedValue(1005);
        mockSorobanService.getEvents.mockResolvedValue([
          makeEvent({ id: "e1", txHash: "tx_released", topic: [symbolTopic("EscrowReleased")] }),
        ] as any);

        await (worker as any).processNextBatch();

        expect(NotificationService.send).not.toHaveBeenCalled();
      });

      it("does not fail event processing or block the cursor when NotificationService.send rejects", async () => {
        setupHappyPathDb();
        (NotificationService.send as jest.Mock).mockRejectedValue(new Error("queue unavailable"));
        mockSorobanService.getLatestLedger.mockResolvedValue(1005);
        mockSorobanService.getEvents.mockResolvedValue([
          makeEvent({ id: "e1", txHash: "tx_funded", topic: [symbolTopic("EscrowFunded")] }),
        ] as any);

        await expect((worker as any).processNextBatch()).resolves.not.toThrow();

        expect(pool.query).toHaveBeenCalledWith(
          expect.stringContaining("UPDATE indexer_state SET last_processed_ledger = $1"),
          [1003]
        );
      });
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

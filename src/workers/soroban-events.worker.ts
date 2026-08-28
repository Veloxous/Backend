import { SorobanService } from "../services/stellar/soroban.service";
import { pool, withTransaction } from "../db/db";
import { rpc, xdr, Address } from "@stellar/stellar-sdk";
import { NotificationService, NotificationType } from "../services/notification.service";

const LAG_THRESHOLD = 100;
const FINALITY_BUFFER = 2; // Process up to (latest - 2)
const POLL_INTERVAL = 3000;

export class SorobanEventsWorker {
  private service: SorobanService;
  private isRunning: boolean = false;
  private timeoutId: NodeJS.Timeout | null = null;
  private webhookUrl: string | undefined;
  // Events from either contract drive escrow state, so both are watched.
  private contractIds: string[];

  constructor() {
    this.service = new SorobanService();
    this.webhookUrl = process.env.ALERT_WEBHOOK_URL;
    // Without an escrow contract to watch the worker would silently index
    // nothing — fail fast instead.
    const escrowContractId = process.env.ESCROW_CONTRACT_ID;
    if (!escrowContractId) {
      throw new Error("ESCROW_CONTRACT_ID must be configured for the Soroban events worker");
    }
    this.contractIds = [escrowContractId, process.env.SWAP_CONTRACT_ID || ""].filter(
      (id) => id.length > 0
    );
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[SorobanEventsWorker] Starting worker...");
    await this.loop();
  }

  public stop() {
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    console.log("[SorobanEventsWorker] Stopped worker.");
  }

  private async loop() {
    if (!this.isRunning) return;

    try {
      await this.processNextBatch();
    } catch (error) {
      console.error("[SorobanEventsWorker] Error in polling loop:", error);
    } finally {
      if (this.isRunning) {
        this.timeoutId = setTimeout(() => this.loop(), POLL_INTERVAL);
      }
    }
  }

  private async processNextBatch() {
    const latestLedger = await this.service.getLatestLedger();
    const safeLedger = latestLedger - FINALITY_BUFFER;

    const lastProcessed = await this.getLastProcessedLedger();
    
    // Alert on lag
    if (latestLedger - lastProcessed > LAG_THRESHOLD) {
      await this.sendAlert(`High Ledger Lag Detected! Current: ${latestLedger}, Cursor: ${lastProcessed}`);
    }

    if (lastProcessed >= safeLedger) {
      // Up to date
      return;
    }

    const startLedger = lastProcessed + 1;
    // We only fetch a small batch or up to safeLedger
    const endLedger = Math.min(startLedger + 1000, safeLedger);

    console.log(`[SorobanEventsWorker] Fetching events from ${startLedger} to ${endLedger}...`);

    // Each filter topic must match the event's full topic list, so pad every
    // pattern with wildcards ("*") up to the max observed arity — otherwise
    // multi-topic events would never match a single-segment pattern.
    const topics = [
      [xdr.ScVal.scvSymbol("EscrowFunded").toXDR("base64"), "*", "*"],
      [xdr.ScVal.scvSymbol("EscrowReleased").toXDR("base64"), "*", "*"],
      [xdr.ScVal.scvSymbol("DisputeRaised").toXDR("base64"), "*", "*"],
    ];

    const events = await this.service.getEvents(startLedger, endLedger, this.contractIds, topics);

    for (const event of events) {
      // A database failure must abort the batch before the cursor advances,
      // so the same events are reprocessed on the next tick. Only parse
      // failures are contained (they go to the DLQ).
      await this.processEventWithDLQ(event);
    }

    // Update cursor — only reached when every event either committed or was
    // safely parked in the DLQ.
    await this.updateLastProcessedLedger(endLedger);
  }

  private async processEventWithDLQ(event: rpc.Api.EventResponse) {
    let parsedData: { transaction_id: string; event_type: string; amount: string; party: string };
    try {
      // 1. Parse Event — undecodable payloads go to the DLQ for manual replay.
      parsedData = this.parseEventPayload(event);
    } catch (error: any) {
      console.error(`[SorobanEventsWorker] Failed to parse event ${event.id}, moving to DLQ:`, error.message);
      await this.writeToDlq(event.txHash || event.id || "unknown", JSON.stringify(event), error.message);
      return;
    }

    // 2. Transactional processing. A database failure here propagates up so
    // processNextBatch skips the cursor update — this event is reprocessed
    // once the database is healthy again. It deliberately does NOT go to the
    // DLQ, which would stop it from being retried.
    await withTransaction(async (client) => {
      // Idempotent insert: if transaction_id exists, ignore
      await client.query(
        `INSERT INTO escrow_transactions (transaction_id, event_type, amount, party) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [parsedData.transaction_id, parsedData.event_type, parsedData.amount, parsedData.party]
      );
    });
    console.log(`[SorobanEventsWorker] Successfully processed event TX: ${parsedData.transaction_id}`);

    await this.notifyForEvent(parsedData);
  }

  /**
   * Best-effort notification dispatch for the subset of on-chain events that
   * are user-facing. Failures here are logged, never rethrown — a
   * notification outage must not block cursor advancement or reprocess an
   * already-committed event.
   */
  private async notifyForEvent(parsedData: { transaction_id: string; event_type: string; amount: string; party: string }) {
    const NOTIFICATION_TYPE_BY_EVENT: Partial<Record<string, NotificationType>> = {
      EscrowFunded: NotificationType.ESCROW_FUNDED,
      DisputeRaised: NotificationType.DISPUTE_RAISED,
    };

    const notificationType = NOTIFICATION_TYPE_BY_EVENT[parsedData.event_type];
    if (!notificationType) return;

    try {
      await NotificationService.send({
        type: notificationType,
        userId: parsedData.party,
        payload: {
          transactionId: parsedData.transaction_id,
          amount: parsedData.amount,
        },
      });
    } catch (error) {
      console.error(
        `[SorobanEventsWorker] Failed to send ${parsedData.event_type} notification for TX ${parsedData.transaction_id}:`,
        error
      );
    }
  }

  private async writeToDlq(transactionId: string, rawXdr: string, errorMessage: string): Promise<void> {
    await pool.query(`INSERT INTO failed_events (transaction_id, raw_xdr, error_message) VALUES ($1, $2, $3)`, [
      transactionId,
      rawXdr,
      errorMessage,
    ]);
  }

  private parseEventPayload(event: rpc.Api.EventResponse) {
    const parsed = {
      transaction_id: event.txHash || event.id,
      event_type: "Unknown",
      amount: "0",
      party: "Unknown",
    };

    // Collect every ScVal we can find: topics first (contract events put the
    // variant name there), then the event's data value.
    const scvals: xdr.ScVal[] = [];
    for (const topic of event.topic ?? []) {
      try {
        scvals.push(
          typeof topic === "string"
            ? xdr.ScVal.fromXDR(topic, "base64")
            : (topic as unknown as xdr.ScVal)
        );
      } catch {
        // Non-ScVal topic entries are ignored.
      }
    }

    const value: any = event.value;
    if (value) {
      // Depending on SDK version the value arrives pre-decoded or raw.
      if (typeof value.toXDR === "function") {
        scvals.push(value);
      } else if (value.xdr) {
        try {
          scvals.push(xdr.ScVal.fromXDR(value.xdr, "base64"));
        } catch {
          throw new Error("Event value is not decodable XDR");
        }
      }
    }

    for (const val of scvals) {
      switch (val.switch()) {
        case xdr.ScValType.scvSymbol(): {
          if (parsed.event_type === "Unknown") {
            parsed.event_type = val.sym().toString();
          }
          break;
        }
        case xdr.ScValType.scvAddress(): {
          if (parsed.party === "Unknown") {
            // The SDK's Address abstraction handles both account (G...) and
            // contract (C...) ScAddresses and produces a valid StrKey string.
            parsed.party = Address.fromScAddress(val.address()).toString();
          }
          break;
        }
        case xdr.ScValType.scvU64(): {
          if (parsed.amount === "0") {
            parsed.amount = val.u64().toString();
          }
          break;
        }
        case xdr.ScValType.scvI64(): {
          if (parsed.amount === "0") {
            parsed.amount = val.i64().toString();
          }
          break;
        }
        case xdr.ScValType.scvU128(): {
          if (parsed.amount === "0") {
            const parts = val.u128();
            parsed.amount = this.u128ToAmount(parts);
          }
          break;
        }
        case xdr.ScValType.scvI128(): {
          if (parsed.amount === "0") {
            parsed.amount = this.i128ToAmount(val.i128());
          }
          break;
        }
        default:
          break;
      }
    }

    if (!event.txHash && !event.id) {
      throw new Error("Event has neither txHash nor id — cannot be tracked");
    }
    if (parsed.event_type === "Unknown") {
      throw new Error("Event topic does not resolve to a known escrow event type");
    }

    return parsed;
  }

  /** Converts an Int128Parts (hi/lo) pair to a decimal string. */
  private u128ToAmount(parts: { hi(): any; lo(): any }): string {
    const hi = BigInt(parts.hi().toString());
    const lo = BigInt(parts.lo().toString());
    return (hi * BigInt(2) ** BigInt(64) + lo).toString();
  }

  private i128ToAmount(parts: { hi(): any; lo(): any }): string {
    const hi = BigInt(parts.hi().toString());
    if (hi < BigInt(0)) {
      // Two's complement: reinterpret hi as unsigned (hi + 2^64), then
      // subtract 2^128 from the combined value.
      const lo = BigInt(parts.lo().toString());
      const unsigned = (hi + BigInt(2) ** BigInt(64)) * BigInt(2) ** BigInt(64) + lo;
      return (unsigned - BigInt(2) ** BigInt(128)).toString();
    }
    return this.u128ToAmount(parts);
  }

  private async getLastProcessedLedger(): Promise<number> {
    const res = await pool.query(
      "SELECT last_processed_ledger FROM indexer_state WHERE key = 'soroban_escrow_events'"
    );
    if (res.rows.length === 0) {
      // Default fallback
      return 0;
    }
    return res.rows[0].last_processed_ledger;
  }

  private async updateLastProcessedLedger(ledger: number) {
    await pool.query(
      "UPDATE indexer_state SET last_processed_ledger = $1 WHERE key = 'soroban_escrow_events'",
      [ledger]
    );
  }

  private async sendAlert(message: string) {
    console.error(`[ALERT] ${message}`);
    if (this.webhookUrl) {
      try {
        await fetch(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        });
      } catch (e) {
        console.error("Failed to send webhook alert", e);
      }
    }
  }
}

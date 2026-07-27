import { SorobanService } from "../services/stellar/soroban.service";
import { pool, withTransaction } from "../db/db";
import { rpc, xdr } from "@stellar/stellar-sdk";

const LAG_THRESHOLD = 100;
const FINALITY_BUFFER = 2; // Process up to (latest - 2)
const POLL_INTERVAL = 3000;
const CONTRACT_ID = process.env.ESCROW_CONTRACT_ID || "C_MOCK_CONTRACT_ID";

export class SorobanEventsWorker {
  private service: SorobanService;
  private isRunning: boolean = false;
  private timeoutId: NodeJS.Timeout | null = null;
  private webhookUrl: string | undefined;

  constructor() {
    this.service = new SorobanService();
    this.webhookUrl = process.env.ALERT_WEBHOOK_URL;
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

    const topics = [
      [xdr.ScVal.scvSymbol("EscrowFunded").toXDR("base64")],
      [xdr.ScVal.scvSymbol("EscrowReleased").toXDR("base64")],
      [xdr.ScVal.scvSymbol("DisputeRaised").toXDR("base64")]
    ];

    const events = await this.service.getEvents(startLedger, endLedger, [CONTRACT_ID], topics);

    for (const event of events) {
      await this.processEventWithDLQ(event);
    }

    // Update cursor
    await this.updateLastProcessedLedger(endLedger);
  }

  private async processEventWithDLQ(event: rpc.Api.EventResponse) {
    try {
      // 1. Parse Event
      const parsedData = this.parseEventPayload(event);

      // 2. Transactional processing
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
    } catch (error: any) {
      console.error(`[SorobanEventsWorker] Failed to process event ${event.id}, moving to DLQ:`, error.message);
      try {
        await pool.query(
          `INSERT INTO failed_events (transaction_id, raw_xdr, error_message) VALUES ($1, $2, $3)`,
          [event.txHash, JSON.stringify(event), error.message]
        );
      } catch (dlqError) {
        console.error(`[SorobanEventsWorker] CRITICAL: Failed to write to DLQ!`, dlqError);
        // We still don't halt the worker, but we log the critical failure.
      }
    }
  }

  private parseEventPayload(event: rpc.Api.EventResponse) {
    // Assuming the event payload is an XDR ScVal string in base64
    // Since we don't have the exact ABI, this is a simulated parsing
    // In a real application, you'd use xdr.ScVal.fromXDR(event.value.xdr, 'base64') and extract fields
    
    // Simulate extraction for the task
    const parsed = {
      transaction_id: event.txHash,
      event_type: "Unknown",
      amount: "0",
      party: "Unknown"
    };
    
    // We try to interpret the topic[0] to determine event type
    if (event.topic && event.topic.length > 0) {
       try {
           const topicVal = xdr.ScVal.fromXDR(event.topic[0] as unknown as string, "base64");
           if (topicVal.switch() === xdr.ScValType.scvSymbol()) {
               parsed.event_type = topicVal.sym().toString();
           }
       } catch (e) {
           // fallback
       }
    }

    return parsed;
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

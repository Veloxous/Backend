import { pool, withTransaction } from "../db/db";
import { SorobanEventsWorker } from "../workers/soroban-events.worker";

async function replayDLQ() {
  console.log("Starting DLQ replay script...");
  const res = await pool.query("SELECT * FROM failed_events ORDER BY created_at ASC");
  
  if (res.rows.length === 0) {
    console.log("No failed events found in DLQ.");
    process.exit(0);
  }

  console.log(`Found ${res.rows.length} failed events. Attempting to replay...`);
  
  // We'll instantiate the worker just to reuse the parse logic and process logic,
  // but we can also just implement a custom replay loop.
  // Actually, since processEventWithDLQ handles DB insertion, we can call it or duplicate the core logic.
  
  let successCount = 0;
  let failCount = 0;

  for (const row of res.rows) {
    try {
      // Re-parse
      const event = JSON.parse(row.raw_xdr);
      const parsedData = parseEventPayload(event);

      // Re-insert
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO escrow_transactions (transaction_id, event_type, amount, party) 
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (transaction_id) DO NOTHING`,
          [parsedData.transaction_id, parsedData.event_type, parsedData.amount, parsedData.party]
        );
        
        // Remove from DLQ
        await client.query("DELETE FROM failed_events WHERE id = $1", [row.id]);
      });
      
      console.log(`Successfully replayed event ID ${row.id} (TX: ${row.transaction_id})`);
      successCount++;
    } catch (e: any) {
      console.error(`Failed to replay event ID ${row.id}:`, e.message);
      failCount++;
    }
  }

  console.log(`DLQ replay complete. Success: ${successCount}, Failed: ${failCount}`);
  process.exit(0);
}

// A copy of the parse logic, assuming the bug would be fixed here before running the script
function parseEventPayload(event: any) {
  const parsed = {
    transaction_id: event.txHash,
    event_type: "Unknown",
    amount: "0",
    party: "Unknown"
  };
  
  // Custom fix logic would go here.
  return parsed;
}

replayDLQ().catch(e => {
  console.error("DLQ Replay error:", e);
  process.exit(1);
});

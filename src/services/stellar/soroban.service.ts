import { rpc } from "@stellar/stellar-sdk";

export class SorobanService {
  private server: rpc.Server;

  constructor() {
    const rpcUrl = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
    this.server = new rpc.Server(rpcUrl);
  }

  /**
   * Helper method to handle RPC requests with exponential backoff for rate limits.
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 5
  ): Promise<T> {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await operation();
      } catch (error: any) {
        if (error?.response?.status === 429) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`[Soroban RPC] 429 Too Many Requests. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt++;
        } else {
          throw error;
        }
      }
    }
    throw new Error(`Soroban RPC operation failed after ${maxRetries} retries.`);
  }

  /**
   * Retrieves the latest ledger sequence from the network.
   */
  public async getLatestLedger(): Promise<number> {
    const response = await this.withRetry(() => this.server.getLatestLedger());
    return response.sequence;
  }

  /**
   * Fetches events for a specific contract and topic list within a ledger range.
   */
  public async getEvents(
    startLedger: number,
    endLedger?: number,
    contractIds: string[] = [],
    topics: string[][] = []
  ): Promise<rpc.Api.EventResponse[]> {
    const request: rpc.Api.EventFilter[] = [
      {
        type: "contract",
        contractIds,
        topics,
      },
    ];

    const response = await this.withRetry(() =>
      this.server.getEvents({
        startLedger,
        filters: request,
        // Optional filters for pagination or limits can be added here
      })
    );
    
    let events = response.events || [];
    
    // The RPC might return events beyond our strict endLedger if we didn't specify it in the API call itself.
    // The stellar SDK getEvents signature doesn't take endLedger directly, it just streams from startLedger up to a limit.
    // We should filter them in-memory to not exceed endLedger.
    if (endLedger !== undefined) {
      events = events.filter(e => parseInt(e.ledger, 10) <= endLedger);
    }
    
    return events;
  }
}

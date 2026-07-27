import { PoolClient } from "pg";

export interface CollateralCalculation {
  partyACollateral: number;
  partyBCollateral: number;
  topUpAmount: number | null;
  topUpRecipient: string | null;
  valueMismatch: boolean;
}

export class ValuationService {
  private readonly MISMATCH_THRESHOLD = 0.5; // 50% difference threshold

  /**
   * Calculate required collateral amounts for both parties and any required top-up
   */
  async calculateCollateral(
    client: PoolClient,
    listingAId: string,
    listingBId: string
  ): Promise<CollateralCalculation> {
    // Get both listings with their estimated values
    const listingsResult = await client.query(
      `SELECT id, owner_id, device_type, estimated_value 
       FROM listings 
       WHERE id IN ($1, $2)`,
      [listingAId, listingBId]
    );

    if (listingsResult.rows.length !== 2) {
      throw new Error("One or both listings not found");
    }

    const listingA = listingsResult.rows.find((r: any) => r.id === listingAId);
    const listingB = listingsResult.rows.find((r: any) => r.id === listingBId);

    if (!listingA || !listingB) {
      throw new Error("Failed to retrieve listings");
    }

    // If any listing doesn't have an estimated value, fetch historical averages
    const valueA = listingA.estimated_value || await this.getHistoricalAverage(client, listingA.device_type);
    const valueB = listingB.estimated_value || await this.getHistoricalAverage(client, listingB.device_type);

    // Party A's collateral equals Party B's device value, and vice versa
    const partyACollateral = valueB;
    const partyBCollateral = valueA;

    // Calculate if there's a significant value mismatch
    const minValue = Math.min(valueA, valueB);
    const maxValue = Math.max(valueA, valueB);
    const mismatchRatio = minValue / maxValue;
    
    let topUpAmount: number | null = null;
    let topUpRecipient: string | null = null;
    const valueMismatch = mismatchRatio < this.MISMATCH_THRESHOLD;

    if (valueMismatch) {
      // Calculate required top-up from the user with the cheaper device
      topUpAmount = maxValue - minValue;
      // The recipient is the owner of the more expensive device
      topUpRecipient = valueA > valueB ? listingA.owner_id : listingB.owner_id;
    }

    return {
      partyACollateral,
      partyBCollateral,
      topUpAmount,
      topUpRecipient,
      valueMismatch
    };
  }

  /**
   * Get historical average sale price for a device type from completed listings
   */
  private async getHistoricalAverage(client: PoolClient, deviceType: string): Promise<number> {
    const result = await client.query(
      `SELECT AVG(estimated_value) as avg_value
       FROM listings
       WHERE device_type = $1 
       AND deleted_at IS NOT NULL -- Completed/sold listings
       AND estimated_value IS NOT NULL`,
      [deviceType]
    );

    if (result.rows[0].avg_value) {
      return parseFloat(result.rows[0].avg_value);
    }

    // Fallback default value if no historical data
    const fallbackValues: Record<string, number> = {
      'iphone-13': 800,
      'iphone-14': 900,
      'macbook-pro-14': 1500,
      'samsung-s23': 700,
      'default': 500
    };

    return fallbackValues[deviceType.toLowerCase()] || fallbackValues['default'];
  }
}
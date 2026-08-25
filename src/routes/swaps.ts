import express from "express";
import { pool, withTransaction } from "../db/db";
import { ValuationService } from "../services/swap/valuation.service";
import { SorobanTransactionService } from "../services/swap/soroban-transaction.service";
import { SwapTimeoutWorker } from "../workers/swap-timeout.worker";

const router = express.Router();
const valuationService = new ValuationService();
const sorobanService = new SorobanTransactionService();

// Types
interface CreateSwapRequest {
  listing_b_id: string;
}

interface CounterOfferRequest {
  message?: string;
  new_terms?: any;
}

/**
 * Propose a new swap (link Listing A and Listing B)
 */
router.post("/", async (req, res) => {
  try {
    const { listing_b_id } = req.body as CreateSwapRequest;
    const user_id = req.headers["x-user-id"] as string; // In real app, this comes from auth middleware

    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!listing_b_id) {
      return res.status(400).json({ error: "listing_b_id is required" });
    }

    const result = await withTransaction(async (client) => {
      // Get the user's listing (Listing A) - assuming they can only propose from their own listing
      // In a real app, you'd verify the user owns listing_a
      const userListingResult = await client.query(
        `SELECT * FROM listings WHERE owner_id = $1 AND current_swap_id IS NULL AND is_locked = FALSE LIMIT 1`,
        [user_id]
      );

      if (userListingResult.rows.length === 0) {
        throw new Error("No active listings available to propose a swap from");
      }

      const listingA = userListingResult.rows[0];

      // Check if the target listing exists and is available
      const targetListingResult = await client.query(
        `SELECT * FROM listings WHERE id = $1 AND current_swap_id IS NULL AND is_locked = FALSE`,
        [listing_b_id]
      );

      if (targetListingResult.rows.length === 0) {
        throw new Error("Target listing is not available for swap");
      }

      const listingB = targetListingResult.rows[0];

      // Create the swap proposal
      const swapResult = await client.query(
        `INSERT INTO swaps (
          listing_a_id, listing_b_id, proposer_id, counterparty_id, state
        ) VALUES ($1, $2, $3, $4, 'proposed')
        RETURNING *`,
        [listingA.id, listingB.id, user_id, listingB.owner_id]
      );

      const swap = swapResult.rows[0];

      // Update both listings to reference this swap
      await client.query(
        `UPDATE listings SET current_swap_id = $1 WHERE id IN ($2, $3)`,
        [swap.id, listingA.id, listingB.id]
      );

      return swap;
    });

    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Counter-offer a swap proposal
 */
router.patch("/:id/counter", async (req, res) => {
  try {
    const { id } = req.params;
    const { message, new_terms } = req.body as CounterOfferRequest;
    const user_id = req.headers["x-user-id"] as string;

    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await withTransaction(async (client) => {
      // Lock the swap row
      const swapResult = await client.query(
        `SELECT * FROM swaps WHERE id = $1 AND state = 'proposed' AND counterparty_id = $2 FOR UPDATE`,
        [id, user_id]
      );

      if (swapResult.rows.length === 0) {
        throw new Error("Swap not found or cannot be countered");
      }

      // Update swap state to countered
      const updatedSwap = await client.query(
        `UPDATE swaps 
         SET state = 'countered', counter_offer_details = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [{ message, new_terms }, id]
      );

      return updatedSwap.rows[0];
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Accept a swap proposal or counter-offer
 */
router.patch("/:id/accept", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.headers["x-user-id"] as string;

    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await withTransaction(async (client) => {
      // First, lock the swap row
      const swapResult = await client.query(
        `SELECT * FROM swaps 
         WHERE id = $1 
         AND (state = 'proposed' OR state = 'countered')
         FOR UPDATE`,
        [id]
      );

      if (swapResult.rows.length === 0) {
        throw new Error("Swap not found or cannot be accepted");
      }

      const swap = swapResult.rows[0];

      // Verify the user is part of this swap
      if (swap.proposer_id !== user_id && swap.counterparty_id !== user_id) {
        throw new Error("Not authorized to accept this swap");
      }

      // Now lock both listings to ensure they're still available
      // Use SELECT FOR UPDATE to prevent concurrent modifications
      const listingsResult = await client.query(
        `SELECT * FROM listings 
         WHERE id IN ($1, $2) 
         AND is_locked = FALSE 
         AND current_swap_id = $3
         FOR UPDATE`,
        [swap.listing_a_id, swap.listing_b_id, id]
      );

      if (listingsResult.rows.length !== 2) {
        // One or both listings are no longer available
        throw new Error("One or both listings are no longer available for this swap");
      }

      // Calculate collateral requirements
      const collateralCalculation = await valuationService.calculateCollateral(
        client,
        swap.listing_a_id,
        swap.listing_b_id
      );

      // Update swap to agreed state
      const agreedSwap = await client.query(
        `UPDATE swaps 
         SET state = 'agreed', 
             agreed_at = NOW(),
             party_a_collateral_amount = $1,
             party_b_collateral_amount = $2,
             top_up_amount = $3,
             top_up_recipient = $4,
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [
          collateralCalculation.partyACollateral,
          collateralCalculation.partyBCollateral,
          collateralCalculation.topUpAmount,
          collateralCalculation.topUpRecipient,
          id
        ]
      );

      // Lock the listings so they can't be edited
      await client.query(
        `UPDATE listings SET is_locked = TRUE WHERE id IN ($1, $2)`,
        [swap.listing_a_id, swap.listing_b_id]
      );

      // Schedule timeout monitoring
      await SwapTimeoutWorker.scheduleSwapMonitoring(id);

      return {
        ...agreedSwap.rows[0],
        value_mismatch: collateralCalculation.valueMismatch,
        top_up_suggested: collateralCalculation.topUpAmount !== null
      };
    });

    res.json(result);
  } catch (error: any) {
    if (error.message.includes("no longer available")) {
      return res.status(409).json({ error: "Conflict: One or both listings are no longer available" });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * Reject a swap proposal
 */
router.patch("/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.headers["x-user-id"] as string;

    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await withTransaction(async (client) => {
      const swapResult = await client.query(
        `SELECT * FROM swaps WHERE id = $1 AND (state = 'proposed' OR state = 'countered') FOR UPDATE`,
        [id]
      );

      if (swapResult.rows.length === 0) {
        throw new Error("Swap not found or cannot be rejected");
      }

      const swap = swapResult.rows[0];

      // Update swap state
      await client.query(
        `UPDATE swaps SET state = 'rejected', updated_at = NOW() WHERE id = $1`,
        [id]
      );

      // Reset listings
      await client.query(
        `UPDATE listings SET current_swap_id = NULL WHERE id IN ($1, $2)`,
        [swap.listing_a_id, swap.listing_b_id]
      );
    });

    res.json({ status: "rejected" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Get the Soroban transaction XDR for depositing collateral
 */
router.get("/:id/transaction", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.headers["x-user-id"] as string;
    const user_public_key = req.headers["x-stellar-public-key"] as string;

    if (!user_id || !user_public_key) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const swapResult = await pool.query(
      `SELECT * FROM swaps WHERE id = $1 AND state = 'agreed'`,
      [id]
    );

    if (swapResult.rows.length === 0) {
      return res.status(404).json({ error: "Swap not found or not in agreed state" });
    }

    const swap = swapResult.rows[0];

    // Determine the required collateral amount for this user
    let requiredAmount: number;
    if (swap.proposer_id === user_id) {
      requiredAmount = swap.party_a_collateral_amount;
    } else if (swap.counterparty_id === user_id) {
      requiredAmount = swap.party_b_collateral_amount;
    } else {
      return res.status(403).json({ error: "Not authorized to generate transaction for this swap" });
    }

    // Get sequence number and build XDR
    const sequenceNumber = await sorobanService.getSequenceNumber(user_public_key);
    const xdr = await sorobanService.buildDepositCollateralXDR(
      id,
      requiredAmount,
      user_public_key,
      sequenceNumber
    );

    res.json({
      swap_id: id,
      required_collateral: requiredAmount,
      xdr,
      sequence_number: sequenceNumber
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Mark a swap as collateralized (called after on-chain deposit is confirmed)
 */
router.post("/:id/collateralized", async (req, res) => {
  try {
    const { id } = req.params;

    await withTransaction(async (client) => {
      const swapResult = await client.query(
        `SELECT * FROM swaps WHERE id = $1 AND state = 'agreed' FOR UPDATE`,
        [id]
      );

      if (swapResult.rows.length === 0) {
        throw new Error("Swap not found or cannot be marked as collateralized");
      }

      await client.query(
        `UPDATE swaps SET state = 'collateralized', collateralized_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id]
      );
    });

    res.json({ status: "collateralized" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Mark a swap as shipped
 */
router.post("/:id/shipped", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.headers["x-user-id"] as string;

    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await withTransaction(async (client) => {
      const swapResult = await client.query(
        `SELECT * FROM swaps WHERE id = $1 AND state = 'collateralized' AND (proposer_id = $2 OR counterparty_id = $2) FOR UPDATE`,
        [id, user_id]
      );

      if (swapResult.rows.length === 0) {
        throw new Error("Swap not found or cannot be marked as shipped");
      }

      await client.query(
        `UPDATE swaps SET state = 'shipped', shipped_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id]
      );
    });

    res.json({ status: "shipped" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Mark a swap as completed
 */
router.post("/:id/complete", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.headers["x-user-id"] as string;

    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await withTransaction(async (client) => {
      const swapResult = await client.query(
        `SELECT * FROM swaps WHERE id = $1 AND state = 'shipped' AND (proposer_id = $2 OR counterparty_id = $2) FOR UPDATE`,
        [id, user_id]
      );

      if (swapResult.rows.length === 0) {
        throw new Error("Swap not found or cannot be marked as completed");
      }

      const swap = swapResult.rows[0];

      // Mark swap as completed
      await client.query(
        `UPDATE swaps SET state = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id]
      );

      // Unlock listings and mark them as sold/deleted
      await client.query(
        `UPDATE listings SET is_locked = FALSE, current_swap_id = NULL, deleted_at = NOW() WHERE id IN ($1, $2)`,
        [swap.listing_a_id, swap.listing_b_id]
      );
    });

    res.json({ status: "completed" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
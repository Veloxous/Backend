import { PoolClient } from "pg";
import { pool, withTransaction } from "../../db/db";

export interface RepairRequest {
  id: string;
  user_id: string;
  technician_id: string;
  device_type: string;
  description: string;
  status: string;
  total_quote: number | null;
  escrow_funded: boolean;
  escrow_transaction_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Milestone {
  id: string;
  repair_id: string;
  milestone_number: number;
  title: string;
  description: string | null;
  amount: number;
  status: string;
  completed_at: Date | null;
  approved_at: Date | null;
  paid_at: Date | null;
}

export interface QuoteInput {
  total_quote: number;
  milestones: {
    title: string;
    description?: string;
    amount: number;
  }[];
}

export class RepairService {
  /**
   * Create a new repair request
   */
  async createRepairRequest(
    userId: string,
    technicianId: string,
    deviceType: string,
    description: string
  ): Promise<RepairRequest> {
    const result = await pool.query(
      `INSERT INTO repair_requests (user_id, technician_id, device_type, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, technicianId, deviceType, description]
    );
    return result.rows[0];
  }

  /**
   * Get a repair request by ID
   */
  async getRepairRequest(repairId: string): Promise<RepairRequest | null> {
    const result = await pool.query(
      `SELECT * FROM repair_requests WHERE id = $1`,
      [repairId]
    );
    return result.rows[0] || null;
  }

  /**
   * Technician submits a quote with milestone breakdown
   */
  async submitQuote(
    repairId: string,
    technicianId: string,
    quote: QuoteInput
  ): Promise<{ repair: RepairRequest; milestones: Milestone[] }> {
    return withTransaction(async (client) => {
      const repairResult = await client.query(
        `SELECT * FROM repair_requests WHERE id = $1 AND technician_id = $2 AND status = 'pending' FOR UPDATE`,
        [repairId, technicianId]
      );

      if (repairResult.rows.length === 0) {
        throw new Error("Repair request not found or cannot be quoted");
      }

      if (quote.milestones.length === 0) {
        throw new Error("At least one milestone is required");
      }

      const milestoneTotal = quote.milestones.reduce((sum, m) => sum + m.amount, 0);
      if (Math.abs(milestoneTotal - quote.total_quote) > 0.01) {
        throw new Error("Milestone amounts must sum to total quote");
      }

      const updatedRepair = await client.query(
        `UPDATE repair_requests
         SET status = 'quoted', total_quote = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [quote.total_quote, repairId]
      );

      await client.query(
        `DELETE FROM repair_milestones WHERE repair_id = $1`,
        [repairId]
      );

      const milestones: Milestone[] = [];
      for (let i = 0; i < quote.milestones.length; i++) {
        const m = quote.milestones[i];
        const result = await client.query(
          `INSERT INTO repair_milestones (repair_id, milestone_number, title, description, amount)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [repairId, i + 1, m.title, m.description || null, m.amount]
        );
        milestones.push(result.rows[0]);
      }

      return { repair: updatedRepair.rows[0], milestones };
    });
  }

  /**
   * User accepts the quote and funds escrow
   */
  async acceptQuote(
    repairId: string,
    userId: string,
    escrowTransactionId: string
  ): Promise<RepairRequest> {
    return withTransaction(async (client) => {
      const repairResult = await client.query(
        `SELECT * FROM repair_requests WHERE id = $1 AND user_id = $2 AND status = 'quoted' FOR UPDATE`,
        [repairId, userId]
      );

      if (repairResult.rows.length === 0) {
        throw new Error("Repair request not found or cannot be accepted");
      }

      const updatedRepair = await client.query(
        `UPDATE repair_requests
         SET status = 'accepted',
             escrow_funded = TRUE,
             escrow_transaction_id = $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [escrowTransactionId, repairId]
      );

      return updatedRepair.rows[0];
    });
  }

  /**
   * Technician marks a milestone as complete
   */
  async completeMilestone(
    repairId: string,
    milestoneNumber: number,
    technicianId: string
  ): Promise<Milestone> {
    return withTransaction(async (client) => {
      const repairResult = await client.query(
        `SELECT * FROM repair_requests WHERE id = $1 AND technician_id = $2 AND status IN ('accepted', 'in_progress') FOR UPDATE`,
        [repairId, technicianId]
      );

      if (repairResult.rows.length === 0) {
        throw new Error("Repair request not found or not in a completable state");
      }

      if (milestoneNumber > 1) {
        const prevResult = await client.query(
          `SELECT status FROM repair_milestones WHERE repair_id = $1 AND milestone_number = $2`,
          [repairId, milestoneNumber - 1]
        );

        if (prevResult.rows.length === 0 || prevResult.rows[0].status !== 'approved') {
          throw new Error("Previous milestone must be approved before completing this one");
        }
      }

      const milestoneResult = await client.query(
        `SELECT * FROM repair_milestones WHERE repair_id = $1 AND milestone_number = $2 AND status = 'pending' FOR UPDATE`,
        [repairId, milestoneNumber]
      );

      if (milestoneResult.rows.length === 0) {
        throw new Error("Milestone not found or already completed");
      }

      const updatedMilestone = await client.query(
        `UPDATE repair_milestones
         SET status = 'completed', completed_at = NOW(), updated_at = NOW()
         WHERE repair_id = $1 AND milestone_number = $2
         RETURNING *`,
        [repairId, milestoneNumber]
      );

      await client.query(
        `UPDATE repair_requests SET status = 'in_progress', updated_at = NOW() WHERE id = $1 AND status = 'accepted'`,
        [repairId]
      );

      return updatedMilestone.rows[0];
    });
  }

  /**
   * User approves a completed milestone (triggers payout)
   */
  async approveMilestone(
    repairId: string,
    milestoneNumber: number,
    userId: string
  ): Promise<Milestone> {
    return withTransaction(async (client) => {
      const repairResult = await client.query(
        `SELECT * FROM repair_requests WHERE id = $1 AND user_id = $2 AND status = 'in_progress' FOR UPDATE`,
        [repairId, userId]
      );

      if (repairResult.rows.length === 0) {
        throw new Error("Repair request not found or not in progress");
      }

      const milestoneResult = await client.query(
        `SELECT * FROM repair_milestones WHERE repair_id = $1 AND milestone_number = $2 AND status = 'completed' FOR UPDATE`,
        [repairId, milestoneNumber]
      );

      if (milestoneResult.rows.length === 0) {
        throw new Error("Milestone not found or not in completed state");
      }

      const updatedMilestone = await client.query(
        `UPDATE repair_milestones
         SET status = 'approved', approved_at = NOW(), updated_at = NOW()
         WHERE repair_id = $1 AND milestone_number = $2
         RETURNING *`,
        [repairId, milestoneNumber]
      );

      const allMilestones = await client.query(
        `SELECT * FROM repair_milestones WHERE repair_id = $1 ORDER BY milestone_number`,
        [repairId]
      );

      const allApproved = allMilestones.rows.every(
        (m: Milestone) => m.status === 'approved' || m.status === 'paid'
      );

      if (allApproved) {
        await client.query(
          `UPDATE repair_requests SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [repairId]
        );
      }

      return updatedMilestone.rows[0];
    });
  }

  /**
   * Get all milestones for a repair request
   */
  async getMilestones(repairId: string): Promise<Milestone[]> {
    const result = await pool.query(
      `SELECT * FROM repair_milestones WHERE repair_id = $1 ORDER BY milestone_number`,
      [repairId]
    );
    return result.rows;
  }

  /**
   * Verify user is involved in the repair (either as user or technician)
   */
  isInvolved(repair: RepairRequest, userId: string): boolean {
    return repair.user_id === userId || repair.technician_id === userId;
  }
}

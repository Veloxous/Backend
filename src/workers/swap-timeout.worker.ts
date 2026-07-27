import { Queue, Worker, Job } from "bullmq";
import nodemailer from "nodemailer";
import { pool } from "../db/db";
import dotenv from "dotenv";

dotenv.config();

// Create Redis connection for BullMQ
const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

// Create queue for swap timeouts
export const swapQueue = new Queue("swap-timeouts", { connection });

// Configure email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export class SwapTimeoutWorker {
  private worker: Worker;

  constructor() {
    this.worker = new Worker("swap-timeouts", this.processJob.bind(this), { connection });
    
    this.worker.on("completed", (job) => {
      console.log(`Swap timeout job ${job.id} completed`);
    });

    this.worker.on("failed", (job, error) => {
      console.error(`Swap timeout job ${job?.id} failed:`, error);
    });
  }

  /**
   * Schedule swap timeout monitoring for a newly agreed swap
   */
  static async scheduleSwapMonitoring(swapId: string) {
    // Schedule warning email in 12 hours
    await swapQueue.add(
      "send-collateral-warning",
      { swapId, type: "warning" },
      { delay: 12 * 60 * 60 * 1000 } // 12 hours in ms
    );

    // Schedule automatic cancellation in 24 hours
    await swapQueue.add(
      "cancel-expired-swap",
      { swapId, type: "cancellation" },
      { delay: 24 * 60 * 60 * 1000 } // 24 hours in ms
    );
  }

  /**
   * Process jobs from the queue
   */
  private async processJob(job: Job) {
    const { swapId, type } = job.data;

    if (type === "warning") {
      await this.sendCollateralWarningEmail(swapId);
    } else if (type === "cancellation") {
      await this.cancelExpiredSwap(swapId);
    }
  }

  /**
   * Send warning email to users who haven't deposited collateral yet
   */
  private async sendCollateralWarningEmail(swapId: string) {
    const client = await pool.connect();
    try {
      // Get swap details and check if it's still in agreed state
      const swapResult = await client.query(
        `SELECT s.*, 
                la.owner_email as party_a_email, 
                lb.owner_email as party_b_email
         FROM swaps s
         JOIN listings la ON s.listing_a_id = la.id
         JOIN listings lb ON s.listing_b_id = lb.id
         WHERE s.id = $1 AND s.state = 'agreed'`,
        [swapId]
      );

      if (swapResult.rows.length === 0) {
        console.log(`Swap ${swapId} is no longer in agreed state, skipping warning`);
        return;
      }

      const swap = swapResult.rows[0];
      const emails = [swap.party_a_email, swap.party_b_email].filter(Boolean);

      if (emails.length === 0) return;

      // Send email
      await transporter.sendMail({
        from: process.env.SMTP_FROM || "no-reply@veloxous.com",
        to: emails,
        subject: "Reminder: Deposit your collateral to complete the swap",
        html: `
          <h1>Collateral Deposit Reminder</h1>
          <p>Your swap #${swapId} has been in the agreed state for 12 hours.</p>
          <p>Please deposit your collateral within the next 12 hours to avoid automatic cancellation.</p>
        `
      });

      console.log(`Sent collateral warning emails for swap ${swapId}`);
    } finally {
      client.release();
    }
  }

  /**
   * Cancel an expired swap that's still waiting for collateral
   */
  private async cancelExpiredSwap(swapId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check if swap is still in agreed state and lock the rows
      const swapResult = await client.query(
        `SELECT * FROM swaps WHERE id = $1 AND state = 'agreed' FOR UPDATE`,
        [swapId]
      );

      if (swapResult.rows.length === 0) {
        console.log(`Swap ${swapId} is no longer in agreed state, skipping cancellation`);
        await client.query("COMMIT");
        return;
      }

      const swap = swapResult.rows[0];

      // Update swap state to cancelled
      await client.query(
        `UPDATE swaps SET state = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [swapId]
      );

      // Unlock both listings and reset their swap reference
      await client.query(
        `UPDATE listings 
         SET is_locked = FALSE, current_swap_id = NULL 
         WHERE id IN ($1, $2)`,
        [swap.listing_a_id, swap.listing_b_id]
      );

      await client.query("COMMIT");
      console.log(`Cancelled expired swap ${swapId}, reset listings to active`);

      // Send cancellation emails
      const emailsResult = await client.query(
        `SELECT la.owner_email as party_a_email, lb.owner_email as party_b_email
         FROM swaps s
         JOIN listings la ON s.listing_a_id = la.id
         JOIN listings lb ON s.listing_b_id = lb.id
         WHERE s.id = $1`,
        [swapId]
      );

      if (emailsResult.rows.length > 0) {
        const { party_a_email, party_b_email } = emailsResult.rows[0];
        const emails = [party_a_email, party_b_email].filter(Boolean);
        
        if (emails.length > 0) {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || "no-reply@veloxous.com",
            to: emails,
            subject: "Your swap has been cancelled due to inactivity",
            html: `
              <h1>Swap Cancelled</h1>
              <p>Your swap #${swapId} has been automatically cancelled because collateral was not deposited within 24 hours.</p>
              <p>Your listings have been reactivated and are available for new swap proposals.</p>
            `
          });
        }
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  /**
   * Start the worker
   */
  async start() {
    console.log("Swap timeout worker started");
  }

  /**
   * Close the worker
   */
  async close() {
    await this.worker.close();
  }
}
import { Queue, Job } from "bullmq";
import { z } from "zod";
import dotenv from "dotenv";
import { broadcast } from "./realtime/realtime.client";

dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

export const NOTIFICATION_QUEUE_NAME = "notifications";

export const notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, { connection });

export enum NotificationType {
  ESCROW_FUNDED = "ESCROW_FUNDED",
  ITEM_SHIPPED = "ITEM_SHIPPED",
  DISPUTE_RAISED = "DISPUTE_RAISED",
  REPUTATION_TIER_CHANGED = "REPUTATION_TIER_CHANGED",
}

// Job name used per notification type, e.g. "escrow-funded".
const JOB_NAME_BY_TYPE: Record<NotificationType, string> = {
  [NotificationType.ESCROW_FUNDED]: "escrow-funded",
  [NotificationType.ITEM_SHIPPED]: "item-shipped",
  [NotificationType.DISPUTE_RAISED]: "dispute-raised",
  [NotificationType.REPUTATION_TIER_CHANGED]: "reputation-tier-changed",
};

const sendInputSchema = z.object({
  type: z.nativeEnum(NotificationType),
  userId: z.string().min(1),
  email: z.string().email().optional(),
  payload: z.record(z.unknown()).default({}),
});

export type SendNotificationInput = z.input<typeof sendInputSchema>;

export interface NotificationJobData {
  type: NotificationType;
  userId: string;
  email: string;
  payload: Record<string, unknown>;
}

export const NotificationService = {
  /**
   * Routes a notification to its channels: an async BullMQ job for email
   * delivery (only enqueued when an email address is available) and a
   * best-effort Supabase Realtime broadcast for in-app push.
   */
  async send(input: SendNotificationInput): Promise<Job<NotificationJobData> | null> {
    const { type, userId, email, payload } = sendInputSchema.parse(input);

    let job: Job<NotificationJobData> | null = null;
    if (email) {
      job = await notificationQueue.add(JOB_NAME_BY_TYPE[type], { type, userId, email, payload });
    }

    try {
      await broadcast(`user:${userId}`, "notification", { type, payload });
    } catch (error) {
      // Realtime is a best-effort channel — email delivery (already
      // enqueued above) must not be blocked by a Supabase outage.
      console.error(`[NotificationService] Realtime broadcast failed for user ${userId}:`, error);
    }

    return job;
  },
};

import { Worker, Job } from "bullmq";
import dotenv from "dotenv";
import { NOTIFICATION_QUEUE_NAME, NotificationType, NotificationJobData } from "../services/notification.service";
import { EmailProvider } from "../services/email/email.provider";
import { render as renderEscrowFunded } from "../templates/email/escrow-funded.template";
import { render as renderItemShipped } from "../templates/email/item-shipped.template";
import { render as renderDisputeRaised } from "../templates/email/dispute-raised.template";
import { render as renderReputationTierChanged } from "../templates/email/reputation-tier-changed.template";

dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

type TemplateRenderer = (payload: Record<string, unknown>) => { subject: string; html: string };

const TEMPLATE_BY_TYPE: Record<NotificationType, TemplateRenderer> = {
  [NotificationType.ESCROW_FUNDED]: renderEscrowFunded as unknown as TemplateRenderer,
  [NotificationType.ITEM_SHIPPED]: renderItemShipped as unknown as TemplateRenderer,
  [NotificationType.DISPUTE_RAISED]: renderDisputeRaised as unknown as TemplateRenderer,
  [NotificationType.REPUTATION_TIER_CHANGED]: renderReputationTierChanged as unknown as TemplateRenderer,
};

export class NotificationWorker {
  private worker: Worker<NotificationJobData>;

  constructor() {
    this.worker = new Worker<NotificationJobData>(
      NOTIFICATION_QUEUE_NAME,
      this.processJob.bind(this),
      { connection }
    );

    this.worker.on("completed", (job) => {
      console.log(`Notification job ${job.id} (${job.data.type}) completed`);
    });

    this.worker.on("failed", (job, error) => {
      console.error(`Notification job ${job?.id} (${job?.data.type}) failed:`, error);
    });
  }

  async processJob(job: Job<NotificationJobData>): Promise<void> {
    const { type, email, payload } = job.data;

    const renderTemplate = TEMPLATE_BY_TYPE[type];
    if (!renderTemplate) {
      throw new Error(`No email template registered for notification type "${type}"`);
    }

    const { subject, html } = renderTemplate(payload);
    await EmailProvider.send({ to: email, subject, html });
  }

  async start(): Promise<void> {
    console.log("Notification worker started");
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

import { NotificationWorker } from "../../workers/notification.worker";
import { EmailProvider } from "../../services/email/email.provider";
import { NotificationType } from "../../services/notification.service";
import { render as renderEscrowFunded } from "../../templates/email/escrow-funded.template";
import { render as renderItemShipped } from "../../templates/email/item-shipped.template";
import { render as renderDisputeRaised } from "../../templates/email/dispute-raised.template";
import { render as renderReputationTierChanged } from "../../templates/email/reputation-tier-changed.template";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
  // notification.worker.ts transitively imports notification.service.ts,
  // which constructs a Queue at module load — it must be mocked too.
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn() })),
}));

jest.mock("../../services/email/email.provider", () => ({
  EmailProvider: { send: jest.fn() },
}));

describe("NotificationWorker.processJob", () => {
  let worker: NotificationWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    (EmailProvider.send as jest.Mock).mockResolvedValue(undefined);
    worker = new NotificationWorker();
  });

  it.each([
    [NotificationType.ESCROW_FUNDED, { transactionId: "tx1", amount: "100" }, renderEscrowFunded],
    [NotificationType.ITEM_SHIPPED, { itemTitle: "Widget" }, renderItemShipped],
    [NotificationType.DISPUTE_RAISED, { transactionId: "tx2" }, renderDisputeRaised],
    [
      NotificationType.REPUTATION_TIER_CHANGED,
      { previousTier: "Bronze", newTier: "Silver" },
      renderReputationTierChanged,
    ],
  ])("renders the %s template and sends it via the email provider", async (type, payload, renderer) => {
    const expected = (renderer as (p: any) => { subject: string; html: string })(payload);

    await worker.processJob({
      data: { type, userId: "user-1", email: "user@example.com", payload },
    } as any);

    expect(EmailProvider.send).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: expected.subject,
      html: expected.html,
    });
  });

  it("throws for a notification type without a registered template", async () => {
    await expect(
      worker.processJob({
        data: { type: "UNKNOWN" as NotificationType, userId: "user-1", email: "user@example.com", payload: {} },
      } as any)
    ).rejects.toThrow(/No email template registered/);

    expect(EmailProvider.send).not.toHaveBeenCalled();
  });
});

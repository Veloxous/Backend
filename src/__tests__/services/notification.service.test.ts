import { Queue } from "bullmq";
import { NotificationService, NotificationType } from "../../services/notification.service";
import { broadcast } from "../../services/realtime/realtime.client";

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn() })),
}));

jest.mock("../../services/realtime/realtime.client", () => ({
  broadcast: jest.fn(),
}));

// `notificationQueue` is constructed once, at module load, via `new Queue(...)`.
// Grabbing the `add` mock off that already-constructed instance (rather than
// referencing an outer `mockAdd` from inside the jest.mock factory) sidesteps
// the jest.mock hoisting/TDZ ordering trap.
const mockAdd = (Queue as unknown as jest.Mock).mock.results[0].value.add as jest.Mock;

describe("NotificationService.send", () => {
  beforeEach(() => {
    mockAdd.mockClear();
    mockAdd.mockResolvedValue({ id: "job-1" });
    (broadcast as jest.Mock).mockReset();
    (broadcast as jest.Mock).mockResolvedValue(undefined);
  });

  it.each([
    [NotificationType.ESCROW_FUNDED, "escrow-funded"],
    [NotificationType.ITEM_SHIPPED, "item-shipped"],
    [NotificationType.DISPUTE_RAISED, "dispute-raised"],
    [NotificationType.REPUTATION_TIER_CHANGED, "reputation-tier-changed"],
  ])("enqueues a %s email job with the correct payload", async (type, jobName) => {
    await NotificationService.send({
      type,
      userId: "user-1",
      email: "user@example.com",
      payload: { foo: "bar" },
    });

    expect(mockAdd).toHaveBeenCalledWith(jobName, {
      type,
      userId: "user-1",
      email: "user@example.com",
      payload: { foo: "bar" },
    });
  });

  it("broadcasts on the user's realtime channel", async () => {
    await NotificationService.send({
      type: NotificationType.ESCROW_FUNDED,
      userId: "user-1",
      email: "user@example.com",
      payload: { foo: "bar" },
    });

    expect(broadcast).toHaveBeenCalledWith("user:user-1", "notification", {
      type: NotificationType.ESCROW_FUNDED,
      payload: { foo: "bar" },
    });
  });

  it("does not enqueue an email job when no email is provided, but still broadcasts", async () => {
    const job = await NotificationService.send({
      type: NotificationType.DISPUTE_RAISED,
      userId: "user-2",
      payload: {},
    });

    expect(job).toBeNull();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith("user:user-2", "notification", {
      type: NotificationType.DISPUTE_RAISED,
      payload: {},
    });
  });

  it("rejects an invalid notification type before touching the queue or realtime client", async () => {
    await expect(
      NotificationService.send({
        type: "NOT_A_REAL_TYPE" as NotificationType,
        userId: "user-3",
        payload: {},
      })
    ).rejects.toThrow();

    expect(mockAdd).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("does not throw when the realtime broadcast fails (best-effort)", async () => {
    (broadcast as jest.Mock).mockRejectedValue(new Error("supabase down"));

    await expect(
      NotificationService.send({
        type: NotificationType.ESCROW_FUNDED,
        userId: "user-4",
        email: "user@example.com",
        payload: {},
      })
    ).resolves.toBeDefined();

    expect(mockAdd).toHaveBeenCalled();
  });
});

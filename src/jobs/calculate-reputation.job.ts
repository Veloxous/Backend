import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import cron from "node-cron";
import { ReputationJobPayload } from "../modules/reputation/types";
import { calculateReputation, getActiveUserIds } from "../modules/reputation/reputation.service";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

export const reputationQueue = new Queue("reputation-calculation", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export const reputationWorker = new Worker(
  "reputation-calculation",
  async (job: Job<ReputationJobPayload>) => {
    const { userId, trigger } = job.data;
    const profile = calculateReputation(userId);
    return { userId, trustScore: profile.trustScore, trigger };
  },
  { connection, concurrency: 10 }
);

export async function enqueueReputationCalculation(
  payload: ReputationJobPayload
): Promise<void> {
  await reputationQueue.add(
    `reputation-${payload.userId}`,
    payload,
    { jobId: `rep-${payload.userId}-${Date.now()}` }
  );
}

export function startHourlyReputationJob(): void {
  cron.schedule("0 * * * *", async () => {
    const activeUserIds = getActiveUserIds();
    for (const userId of activeUserIds) {
      await enqueueReputationCalculation({ userId, trigger: "hourly" });
    }
  });
}

export async function shutdownJobs(): Promise<void> {
  await reputationWorker.close();
  await reputationQueue.close();
  await connection.quit();
}

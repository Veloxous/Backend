import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { ReputationJobPayload } from "../modules/reputation/types";
import { calculateReputation } from "../modules/reputation/reputation.service";

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

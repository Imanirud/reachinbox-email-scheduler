import { Queue } from "bullmq";
import { redis } from "./redis";

export const EMAIL_QUEUE = "scheduled-emails";
export const emailQueue = new Queue(EMAIL_QUEUE, { connection: redis });

export const enqueueEmail = async (emailId: string, scheduledAt: Date) => {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  await emailQueue.add("deliver", { emailId }, {
    jobId: emailId,
    delay,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  });
};

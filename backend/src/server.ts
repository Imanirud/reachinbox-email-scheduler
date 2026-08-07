import app from "./app";
import { configurePassport } from "./auth";
import { config } from "./config";
import { prisma } from "./lib/prisma";
import { enqueueEmail } from "./lib/queue";
import { redis } from "./lib/redis";
import { startWorker } from "./worker";

const boot = async () => {
  configurePassport();
  await prisma.$connect();
  await redis.ping();

  // Reset any interrupted jobs that were stuck in PROCESSING state during server shutdown/restart back to SCHEDULED
  await prisma.emailJob.updateMany({
    where: { status: "PROCESSING" },
    data: { status: "SCHEDULED" },
  });

  // Re-enqueue all scheduled jobs to guarantee BullMQ persistence across restarts
  const pending = await prisma.emailJob.findMany({
    where: { status: "SCHEDULED" },
    select: { id: true, scheduledAt: true },
  });

  console.log(`[Boot] Found ${pending.length} pending email jobs. Enqueuing into BullMQ...`);
  await Promise.all(pending.map((email) => enqueueEmail(email.id, email.scheduledAt).catch(() => undefined)));

  const worker = startWorker();
  worker.on("error", (error) => console.error("Email worker error:", error));

  app.listen(config.port, () => console.log(`🚀 ReachX API listening on http://localhost:${config.port}`));
};

boot().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});


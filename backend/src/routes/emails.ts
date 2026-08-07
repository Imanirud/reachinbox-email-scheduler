import { createHash } from "crypto";
import { Router } from "express";
import { EmailStatus } from "@prisma/client";
import { z } from "zod";
import { config } from "../config";
import { enqueueEmail, emailQueue } from "../lib/queue";
import { reserveDeliverySlot } from "../lib/rate-scheduler";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB limit
const router = Router(); router.use(requireAuth);
const schema = z.object({
  recipients: z.array(z.string().trim().toLowerCase().email()).min(1).max(10_000),
  senderEmail: z.string().trim().toLowerCase().email(),
  senderAppPassword: z.string().trim().optional(),
  subject: z.string().trim().min(1).max(250),
  body: z.string().trim().min(1).max(100_000),
  startAt: z.union([z.string(), z.date()]).optional().transform((val) => {
    if (!val) return new Date();
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date() : d;
  }),
  delaySeconds: z.coerce.number().int().min(0).max(3600).default(config.defaultDelaySeconds),
  hourlyLimit: z.coerce.number().int().min(1).max(100000).default(config.maxEmailsPerHour),
});

router.post("/schedule", upload.array("attachments", 10), async (req, res, next) => {
  try {
    if (typeof req.body.recipients === "string") {
      try { req.body.recipients = JSON.parse(req.body.recipients); } catch (e) {}
    }
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      return res.status(400).json({ error: `Validation error: ${msg}` });
    }
    const input = parsed.data;
    let requestedAt = input.startAt;
    if (requestedAt.getTime() < Date.now() - 60_000) {
      requestedAt = new Date();
    }

    const sender = await prisma.sender.upsert({
      where: { userId_email: { userId: req.userId!, email: input.senderEmail } },
      update: input.senderAppPassword ? { appPassword: input.senderAppPassword } : {},
      create: { userId: req.userId!, email: input.senderEmail, appPassword: input.senderAppPassword },
    });

    const requestKey = req.get("Idempotency-Key") ?? createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const jobs = [] as { id: string; recipient: string; scheduledAt: Date }[];

    for (const recipient of [...new Set(input.recipients)]) {
      const idempotencyKey = createHash("sha256").update(`${req.userId}:${requestKey}:${recipient}`).digest("hex");
      const existing = await prisma.emailJob.findUnique({ where: { idempotencyKey } });
      if (existing) {
        jobs.push(existing);
        continue;
      }

      const scheduledAt = await reserveDeliverySlot(sender.id, requestedAt, input.delaySeconds, input.hourlyLimit);
      const job = await prisma.emailJob.create({
        data: {
          userId: req.userId!,
          senderId: sender.id,
          recipient,
          subject: input.subject,
          body: input.body,
          scheduledAt,
          idempotencyKey,
        },
      });

      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        await prisma.attachment.createMany({
          data: req.files.map(file => ({
            emailJobId: job.id,
            filename: file.originalname,
            content: file.buffer,
            mimeType: file.mimetype,
            size: file.size
          }))
        });
      }

      await enqueueEmail(job.id, scheduledAt);
      await prisma.emailJob.update({ where: { id: job.id }, data: { queueJobId: job.id } });
      jobs.push(job);
    }

    res.status(201).json({ scheduled: jobs.length, jobs });
  } catch (err) {
    next(err);
  }
});
router.get("/", async (req, res) => {
  const status = z.enum(["scheduled", "sent", "failed"]).catch("scheduled").parse(req.query.status); const statuses: Record<string, EmailStatus[]> = { scheduled: [EmailStatus.SCHEDULED, EmailStatus.PROCESSING], sent: [EmailStatus.SENT], failed: [EmailStatus.FAILED] };
  const emails = await prisma.emailJob.findMany({ where: { userId: req.userId, status: { in: statuses[status] } }, include: { sender: { select: { email: true, name: true } } }, orderBy: status === "sent" ? { sentAt: "desc" } : { scheduledAt: "asc" }, take: 200 }); res.json({ emails });
});
router.get("/:id", async (req, res) => { const email = await prisma.emailJob.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { sender: true } }); if (!email) return res.status(404).json({ error: "Email not found" }); res.json({ email }); });
router.post("/:id/cancel", async (req, res) => { const email = await prisma.emailJob.findFirst({ where: { id: req.params.id, userId: req.userId } }); if (!email || email.status !== EmailStatus.SCHEDULED) return res.status(409).json({ error: "Only scheduled emails can be cancelled" }); await (await emailQueue.getJob(email.id))?.remove(); res.json({ email: await prisma.emailJob.update({ where: { id: email.id }, data: { status: EmailStatus.CANCELLED } }) }); });

router.get("/:id/preview", async (req, res) => {
  const email = await prisma.emailJob.findFirst({
    where: { id: req.params.id },
    include: { sender: true, attachments: true },
  });
  if (!email) return res.status(404).send("Email not found");

  const date = email.sentAt ?? email.scheduledAt;
  const htmlBody = email.body.replace(/\n/g, "<br />");
  const attachmentsList = email.attachments.length
    ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;">
         <p style="font-size:12px;color:#6b7280;margin:0 0 8px;font-weight:600;">📎 Attachments (${email.attachments.length})</p>
         ${email.attachments.map(a => `<span style="display:inline-block;background:#f3f4f6;padding:4px 10px;border-radius:12px;font-size:11px;margin:2px 4px;color:#374151;">${a.filename} (${(a.size / 1024).toFixed(1)} KB)</span>`).join("")}
       </div>`
    : "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email Preview – ${email.subject}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;background:#f9fafb;color:#1f2937;min-height:100vh;display:flex;justify-content:center;padding:40px 20px}
.container{max-width:680px;width:100%;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden}
.header{background:linear-gradient(135deg,#00a940,#00c950);color:#fff;padding:20px 28px;display:flex;align-items:center;gap:10px}
.header h1{font-size:16px;font-weight:600;letter-spacing:-.3px}
.header .badge{background:rgba(255,255,255,.2);padding:3px 10px;border-radius:12px;font-size:10px;font-weight:500;margin-left:auto}
.meta{padding:20px 28px;border-bottom:1px solid #f3f4f6;font-size:13px;display:grid;grid-template-columns:60px 1fr;gap:6px 0}
.meta .label{color:#9ca3af;font-weight:500}
.meta .value{color:#374151}
.subject-bar{padding:16px 28px;border-bottom:1px solid #f3f4f6;font-size:15px;font-weight:600;color:#111827}
.body{padding:24px 28px;font-size:14px;line-height:1.7;color:#374151;min-height:120px}
.footer{background:#f9fafb;padding:14px 28px;font-size:10px;color:#9ca3af;text-align:center;border-top:1px solid #f3f4f6}
</style></head><body>
<div class="container">
  <div class="header">
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <h1>ReachX Email Preview</h1>
    <span class="badge">${email.status}</span>
  </div>
  <div class="meta">
    <span class="label">From</span><span class="value">${email.sender.name ? `${email.sender.name} &lt;${email.sender.email}&gt;` : email.sender.email}</span>
    <span class="label">To</span><span class="value">${email.recipient}</span>
    <span class="label">Date</span><span class="value">${new Date(date).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}</span>
  </div>
  <div class="subject-bar">${email.subject}</div>
  <div class="body">${htmlBody}${attachmentsList}</div>
  <div class="footer">Delivered by ReachX Email Scheduler · Preview generated at ${new Date().toLocaleString("en-IN")}</div>
</div>
</body></html>`);
});

export default router;

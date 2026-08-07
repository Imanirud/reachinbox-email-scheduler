import { EmailStatus } from "@prisma/client";
import { Job, Worker } from "bullmq";
import nodemailer, { Transporter } from "nodemailer";
import { config } from "./config";
import { EMAIL_QUEUE } from "./lib/queue";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

let defaultTransporter: Transporter | null = null;
const senderTransporters = new Map<string, Transporter>();

const getDefaultTransporter = async (): Promise<Transporter> => {
  if (defaultTransporter) return defaultTransporter;

  if (config.smtp.user && config.smtp.pass) {
    if (config.smtp.host === "smtp.gmail.com") {
      defaultTransporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      });
    } else {
      defaultTransporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      });
    }
    return defaultTransporter;
  }

  // Fallback: Automatically generate an Ethereal test account if no credentials specified in env
  const testAccount = await nodemailer.createTestAccount();
  console.log(`[Ethereal SMTP] Auto-created test account: ${testAccount.user}`);
  defaultTransporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
  return defaultTransporter;
};

const getSenderTransporter = (senderEmail: string, appPassword: string): Transporter => {
  if (senderTransporters.has(senderEmail)) return senderTransporters.get(senderEmail)!;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: senderEmail, pass: appPassword },
  });
  senderTransporters.set(senderEmail, transporter);
  return transporter;
};

const processEmail = async (job: Job<{ emailId: string }>) => {
  const email = await prisma.emailJob.findUnique({ where: { id: job.data.emailId }, include: { sender: true, attachments: true } });
  if (!email || email.status === EmailStatus.SENT || email.status === EmailStatus.CANCELLED) return;

  await prisma.emailJob.update({
    where: { id: email.id },
    data: { status: EmailStatus.PROCESSING, attempts: { increment: 1 }, failureReason: null },
  });

  try {
    // Use sender's own credentials if available, otherwise fall back to default
    const transporter = email.sender.appPassword
      ? getSenderTransporter(email.sender.email, email.sender.appPassword)
      : await getDefaultTransporter();

    const senderAddress = email.sender.name
      ? `${email.sender.name} <${email.sender.email}>`
      : (email.sender.email || config.smtp.from || "scheduler@reachx.ai");

    const info = await transporter.sendMail({
      from: senderAddress,
      to: email.recipient,
      subject: email.subject,
      text: email.body,
      html: email.body.replace(/\n/g, "<br />"),
      headers: { "X-ReachX-Email-Job": email.id },
      attachments: email.attachments.map(att => ({
        filename: att.filename,
        content: Buffer.from(att.content),
        contentType: att.mimeType
      })),
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) || null;
    if (previewUrl) {
      console.log(`[Ethereal SMTP] Email sent to ${email.recipient}. Preview URL: ${previewUrl}`);
    }

    await prisma.emailJob.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.SENT,
        sentAt: new Date(),
        previewUrl: typeof previewUrl === "string" ? previewUrl : null,
        failureReason: null,
      },
    });
  } catch (error) {
    console.error(`[Worker Error] Failed to deliver email ${email.id}:`, error);
    await prisma.emailJob.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.FAILED,
        failedAt: new Date(),
        failureReason: error instanceof Error ? error.message : "Unknown SMTP delivery error",
      },
    });
    throw error;
  }
};

export const startWorker = () => {
  const worker = new Worker(EMAIL_QUEUE, processEmail, {
    connection: redis,
    concurrency: config.workerConcurrency,
  });
  return worker;
};


import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();
router.use(requireAuth);
router.get("/", async (req, res) => res.json({ senders: await prisma.sender.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "asc" } }) }));
router.post("/", async (req, res) => {
  const input = z.object({ email: z.string().email(), name: z.string().trim().max(120).optional() }).parse(req.body);
  const sender = await prisma.sender.upsert({ where: { userId_email: { userId: req.userId!, email: input.email.toLowerCase() } }, update: { name: input.name }, create: { userId: req.userId!, email: input.email.toLowerCase(), name: input.name } });
  res.status(201).json({ sender });
});
export default router;

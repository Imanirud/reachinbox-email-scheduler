import { Router } from "express";
import { config, hasGoogleOAuth } from "../config";
import { createSessionToken, passport } from "../auth";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import bcrypt from "bcrypt";
import { z } from "zod";

const router = Router();
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: config.frontendUrl.startsWith("https") };
router.post("/login", async (req, res) => {
  const input = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  if (input.email.toLowerCase() !== config.localLoginEmail || input.password !== config.localLoginPassword) return res.status(401).json({ error: "Invalid email or password" });
  const passwordHash = await bcrypt.hash(config.localLoginPassword, 12);
  const user = await prisma.user.upsert({
    where: { email: config.localLoginEmail },
    update: { passwordHash, name: "Oliver Brown" },
    create: { email: config.localLoginEmail, name: "Oliver Brown", passwordHash },
  });
  const customSender = "itsanirudh18@gmail.com";
  await prisma.sender.upsert({
    where: { userId_email: { userId: user.id, email: customSender } },
    update: {},
    create: { userId: user.id, email: customSender, name: "Anirudh" },
  });
  res.cookie("reachx_token", createSessionToken(user.id), { ...cookieOptions, maxAge: 604_800_000 });
  res.json({ user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } });
});
router.get("/google", (req, res, next) => {
  if (!hasGoogleOAuth) return res.status(503).json({ error: "Google OAuth is not configured" });
  passport.authenticate("google", { scope: ["profile", "email"], session: false })(req, res, next);
});
router.get("/google/callback", (req, res, next) => {
  if (!hasGoogleOAuth) return res.redirect(`${config.frontendUrl}/?authError=oauth_not_configured`);
  passport.authenticate("google", { session: false }, (error: Error | null, user?: { id: string }) => {
    if (error || !user) return res.redirect(`${config.frontendUrl}/?authError=google_login_failed`);
    res.cookie("reachx_token", createSessionToken(user.id), { ...cookieOptions, maxAge: 604_800_000 });
    res.redirect(config.frontendUrl);
  })(req, res, next);
});
router.post("/logout", (_req, res) => { res.clearCookie("reachx_token", cookieOptions); res.status(204).send(); });
router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, email: true, name: true, avatarUrl: true } });
  if (!user) return res.status(401).json({ error: "User not found" });
  res.json({ user });
});
export default router;

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import passport from "passport";
import authRouter from "./routes/auth";
import senderRouter from "./routes/senders";
import emailRouter from "./routes/emails";
import { config } from "./config";

const app = express();
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(helmet()); app.use(morgan("dev")); app.use(express.json({ limit: "2mb" })); app.use(cookieParser()); app.use(passport.initialize());
app.get("/", (_req, res) => res.json({ success: true, message: "ReachX Email Scheduler API is running" }));
app.use("/api/auth", authRouter); app.use("/api/senders", senderRouter); app.use("/api/emails", emailRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const msg = issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return res.status(400).json({ error: `Validation error: ${msg}`, details: error });
  }
  console.error("Express Error Handler:", error);
  res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
});
export default app;

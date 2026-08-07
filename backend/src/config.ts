import "dotenv/config";

const numberFromEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  port: numberFromEnv("PORT", 5000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`,
  jwtSecret: process.env.JWT_SECRET ?? "",
  localLoginEmail: (process.env.LOCAL_LOGIN_EMAIL ?? "oliver.brown@domain.io").toLowerCase(),
  localLoginPassword: process.env.LOCAL_LOGIN_PASSWORD ?? "password123",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleCallback: process.env.GOOGLE_CALLBACK ?? "http://localhost:5000/api/auth/google/callback",
  smtp: {
    host: process.env.SMTP_HOST ?? "smtp.ethereal.email",
    port: numberFromEnv("SMTP_PORT", 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "",
  },
  workerConcurrency: numberFromEnv("WORKER_CONCURRENCY", 5),
  maxEmailsPerHour: numberFromEnv("MAX_EMAILS_PER_HOUR", 200),
  defaultDelaySeconds: numberFromEnv("DEFAULT_DELAY_SECONDS", 2),
};

export const hasGoogleOAuth = Boolean(config.googleClientId && config.googleClientSecret);
export const hasSmtp = Boolean(config.smtp.user && config.smtp.pass && config.smtp.from);

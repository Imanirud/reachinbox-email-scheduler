import passport from "passport";
import { Profile, Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import { config, hasGoogleOAuth } from "./config";
import { prisma } from "./lib/prisma";

export const configurePassport = () => {
  if (!hasGoogleOAuth) return;
  passport.use(new GoogleStrategy({ clientID: config.googleClientId, clientSecret: config.googleClientSecret, callbackURL: config.googleCallback }, async (_access, _refresh, profile: Profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error("Google did not return an email address"));
      const user = await prisma.user.upsert({ where: { googleId: profile.id }, update: { email, name: profile.displayName || email, avatarUrl: profile.photos?.[0]?.value }, create: { googleId: profile.id, email, name: profile.displayName || email, avatarUrl: profile.photos?.[0]?.value } });
      if (user.email && user.email.includes("@")) {
        await prisma.sender.upsert({ where: { userId_email: { userId: user.id, email: user.email.toLowerCase() } }, update: {}, create: { userId: user.id, email: user.email.toLowerCase(), name: user.name } });
      }
      done(null, user);
    } catch (error) { done(error as Error); }
  }));
};
export const createSessionToken = (userId: string) => jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "7d" });
export { passport };

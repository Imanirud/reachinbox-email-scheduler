import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.reachx_token;
  if (!token || !config.jwtSecret) return res.status(401).json({ error: "Authentication required" });
  try { req.userId = (jwt.verify(token, config.jwtSecret) as { sub: string }).sub; next(); }
  catch { res.status(401).json({ error: "Your session has expired" }); }
};

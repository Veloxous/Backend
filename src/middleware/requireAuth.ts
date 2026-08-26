import express from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_change_me_in_prod";

export interface AuthedRequest extends express.Request {
  userId?: string;
}

/**
 * Verifies the Bearer JWT issued by POST /auth and exposes the account id as
 * req.userId. Client-controlled headers are never trusted for identity.
 */
export function requireAuth(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(header.slice("Bearer ".length), JWT_SECRET) as { sub?: string };
    if (!payload.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

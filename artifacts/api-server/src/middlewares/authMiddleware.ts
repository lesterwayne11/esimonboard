import type { NextFunction, Request, Response } from "express";
import { findCustomerBySessionToken, type Customer, SESSION_COOKIE } from "../lib/store";

declare global {
  namespace Express {
    interface Request {
      user?: Customer;
      sessionToken?: string;
    }
  }
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    req.sessionToken = token;
    req.user = await findCustomerBySessionToken(token) ?? undefined;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Please log in to continue" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access is required" });
    return;
  }
  next();
}
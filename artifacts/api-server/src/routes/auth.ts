import { Router, type IRouter } from "express";
import {
  createCustomer,
  createSession,
  deleteSession,
  findCustomerByEmail,
  logActivity,
  publicCustomer,
  verifyPassword,
  SESSION_COOKIE,
} from "../lib/store";

const router: IRouter = Router();

function cleanCredentials(body: unknown) {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  return { name, email, password };
}

function setSessionCookie(res: Parameters<typeof router.post>[1] extends never ? never : any, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: "/",
  });
}

router.get("/auth/me", async (req, res): Promise<void> => {
  res.json({ user: req.user ? publicCustomer(req.user) : null });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const { name, email, password } = cleanCredentials(req.body);
  if (name.length < 2 || !email.includes("@") || password.length < 8) {
    res.status(400).json({ error: "Use a name, a valid email, and a password with at least 8 characters" });
    return;
  }
  if (await findCustomerByEmail(email)) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }
  try {
    const role = process.env.ADMIN_EMAIL?.trim().toLowerCase() === email ? "admin" : "customer";
    const customer = await createCustomer({ name, email, password, role });
    const token = await createSession(customer.id);
    setSessionCookie(res, token);
    await logActivity({ actor: email, action: "Customer account created", relatedCustomerId: customer.id, result: "SUCCESS" });
    res.status(201).json({ user: publicCustomer(customer) });
  } catch (error) {
    req.log.error({ err: error }, "Unable to register customer");
    res.status(500).json({ error: "We could not create your account" });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = cleanCredentials(req.body);
  const customer = await findCustomerByEmail(email);
  if (!customer || !verifyPassword(password, customer.passwordHash)) {
    res.status(401).json({ error: "Email or password is incorrect" });
    return;
  }
  const token = await createSession(customer.id);
  setSessionCookie(res, token);
  await logActivity({
    actor: customer.email,
    action: customer.role === "admin" ? "Admin logged in" : "Customer logged in",
    adminId: customer.role === "admin" ? customer.id : undefined,
    result: "SUCCESS",
  });
  res.json({ user: publicCustomer(customer) });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await deleteSession(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ user: null });
});

export default router;
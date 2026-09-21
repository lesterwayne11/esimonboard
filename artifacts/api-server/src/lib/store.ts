import crypto from "node:crypto";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import {
  adminActivityLogs,
  authSessions,
  customers,
  db,
  esimPlans,
  orders,
  type Customer,
  type EsimPlanRecord,
  type OrderRecord,
} from "@workspace/db";

const SESSION_COOKIE = "esim_onboard_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export { SESSION_COOKIE };
export type { Customer };

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [, salt, expected] = encoded.split("$");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

export async function findCustomerByEmail(email: string) {
  const result = await db.select().from(customers).where(eq(customers.email, normalizeEmail(email))).limit(1);
  return result[0] ?? null;
}

export async function findCustomerById(id: string) {
  const result = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return result[0] ?? null;
}

export async function createCustomer(input: { name: string; email: string; password: string; role?: string }) {
  const result = await db
    .insert(customers)
    .values({
      name: input.name.trim(),
      email: normalizeEmail(input.email),
      passwordHash: hashPassword(input.password),
      role: input.role ?? "customer",
    })
    .returning();
  return result[0];
}

export async function createSession(customerId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.insert(authSessions).values({
    customerId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function findCustomerBySessionToken(token: string | undefined) {
  if (!token) return null;
  const result = await db
    .select({ customer: customers, session: authSessions })
    .from(authSessions)
    .innerJoin(customers, eq(authSessions.customerId, customers.id))
    .where(and(eq(authSessions.tokenHash, hashToken(token)), sql`${authSessions.expiresAt} > now()`))
    .limit(1);
  return result[0]?.customer ?? null;
}

export async function deleteSession(token: string | undefined) {
  if (token) await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
}

export function publicCustomer(customer: Customer) {
  return { id: customer.id, name: customer.name, email: customer.email, role: customer.role };
}

export async function upsertProviderPlan(plan: {
  packageCode: string;
  name: string;
  location: string;
  providerPricePhp: number;
  volumeBytes: number;
  dataGb: number;
  duration: number;
  durationUnit: string;
  supportTopUp: boolean;
  speed: string;
  activeType: number;
}) {
  const existing = await db.select().from(esimPlans).where(eq(esimPlans.packageCode, plan.packageCode)).limit(1);
  const values = {
    name: plan.name,
    location: plan.location,
    providerPricePhp: plan.providerPricePhp.toFixed(2),
    volumeBytes: plan.volumeBytes,
    dataGb: plan.dataGb.toFixed(3),
    duration: plan.duration,
    durationUnit: plan.durationUnit,
    supportTopUp: plan.supportTopUp,
    speed: plan.speed,
    activeType: plan.activeType,
    providerSyncedAt: new Date(),
    updatedAt: new Date(),
  };
  if (existing[0]) {
    const result = await db.update(esimPlans).set(values).where(eq(esimPlans.packageCode, plan.packageCode)).returning();
    return result[0];
  }
  const result = await db.insert(esimPlans).values({ packageCode: plan.packageCode, ...values }).returning();
  return result[0];
}

export async function listCustomerPlans(search?: string, location?: string) {
  const filters = [eq(esimPlans.enabled, true)];
  if (location && location !== "All destinations") filters.push(eq(esimPlans.location, location));
  if (search?.trim()) {
    const value = `%${search.trim()}%`;
    filters.push(sql`(${ilike(esimPlans.name, value)} OR ${ilike(esimPlans.location, value)} OR ${ilike(esimPlans.packageCode, value)})`);
  }
  return db.select().from(esimPlans).where(and(...filters)).orderBy(esimPlans.location, esimPlans.dataGb);
}

export async function listAdminPlans() {
  return db.select().from(esimPlans).orderBy(esimPlans.location, esimPlans.dataGb);
}

export async function getPlanByCode(packageCode: string) {
  const result = await db.select().from(esimPlans).where(eq(esimPlans.packageCode, packageCode)).limit(1);
  return result[0] ?? null;
}

export async function updatePlanPricing(packageCode: string, input: { markupPhp?: number; sellingPricePhp?: number | null; enabled?: boolean }) {
  const current = await db.select().from(esimPlans).where(eq(esimPlans.packageCode, packageCode)).limit(1);
  if (!current[0]) return null;
  const nextMarkup = input.markupPhp ?? Number(current[0].markupPhp);
  const nextSelling = input.sellingPricePhp === undefined ? current[0].sellingPricePhp : input.sellingPricePhp === null ? null : input.sellingPricePhp.toFixed(2);
  const result = await db
    .update(esimPlans)
    .set({
      markupPhp: nextMarkup.toFixed(2),
      sellingPricePhp: nextSelling,
      enabled: input.enabled ?? current[0].enabled,
      updatedAt: new Date(),
    })
    .where(eq(esimPlans.packageCode, packageCode))
    .returning();
  return result[0];
}

export function customerPlanPrice(plan: EsimPlanRecord) {
  return plan.sellingPricePhp !== null
    ? Number(plan.sellingPricePhp)
    : Number(plan.providerPricePhp) + Number(plan.markupPhp);
}

export async function persistOrder(input: {
  customerId?: string;
  orderNo: string;
  transactionId: string;
  packageCode: string;
  packageName: string;
  location: string;
  dataGb: number | null;
  totalVolumeBytes: number | null;
  totalDuration: number | null;
  durationUnit: string | null;
  amountPhp: number;
  esimStatus: string;
  smdpStatus: string;
  iccid: string | null;
  esimTranNo: string | null;
  qrCodeUrl: string | null;
  shortUrl: string | null;
  expiresAt: string | null;
}) {
  const result = await db
    .insert(orders)
    .values({
      customerId: input.customerId,
      orderNo: input.orderNo,
      transactionId: input.transactionId,
      packageCode: input.packageCode,
      packageName: input.packageName,
      location: input.location,
      dataGb: input.dataGb?.toFixed(3),
      totalVolumeBytes: input.totalVolumeBytes,
      totalDuration: input.totalDuration,
      durationUnit: input.durationUnit,
      amountPhp: input.amountPhp.toFixed(2),
      esimStatus: input.esimStatus,
      smdpStatus: input.smdpStatus,
      iccid: input.iccid,
      esimTranNo: input.esimTranNo,
      qrCodeUrl: input.qrCodeUrl,
      shortUrl: input.shortUrl,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    })
    .returning();
  return result[0];
}

export async function listCustomerOrders(customerId: string, limit = 20) {
  return db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt)).limit(limit);
}

export async function listAllOrders(limit = 20) {
  return db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
}

export async function countTable(table: typeof customers | typeof orders) {
  const result = await db.select({ count: sql<number>`count(*)` }).from(table);
  return Number(result[0]?.count ?? 0);
}

export async function getAdminStats() {
  const [customerCount, orderCount, activeCount, revenue] = await Promise.all([
    countTable(customers),
    countTable(orders),
    db.select({ count: sql<number>`count(*)` }).from(orders).where(sql`${orders.iccid} is not null and ${orders.esimStatus} not in ('EXPIRED', 'FAILED')`),
    db.select({ total: sql<string>`coalesce(sum(${orders.amountPhp}), 0)` }).from(orders).where(eq(orders.paymentStatus, "PAID")),
  ]);
  return {
    totalCustomers: customerCount,
    totalOrders: orderCount,
    totalEsimsSold: orderCount,
    activeEsims: Number(activeCount[0]?.count ?? 0),
    revenuePhp: Number(revenue[0]?.total ?? 0),
  };
}

export async function logActivity(input: {
  adminId?: string;
  actor: string;
  action: string;
  relatedOrderNo?: string;
  relatedCustomerId?: string;
  relatedPackageCode?: string;
  details?: Record<string, unknown>;
  result?: string;
}) {
  await db.insert(adminActivityLogs).values({
    adminId: input.adminId,
    actor: input.actor,
    action: input.action,
    relatedOrderNo: input.relatedOrderNo,
    relatedCustomerId: input.relatedCustomerId,
    relatedPackageCode: input.relatedPackageCode,
    details: input.details ?? {},
    result: input.result ?? "SUCCESS",
  });
}

export async function listActivityLogs(limit = 100) {
  return db.select().from(adminActivityLogs).orderBy(desc(adminActivityLogs.createdAt)).limit(limit);
}

export type StoredOrder = OrderRecord;
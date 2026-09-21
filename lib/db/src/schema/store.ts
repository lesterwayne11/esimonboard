import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  bigint,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("customer"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("customers_email_idx").on(table.email)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_idx").on(table.tokenHash),
    index("auth_sessions_customer_idx").on(table.customerId),
  ],
);

export const esimPlans = pgTable(
  "esim_plans",
  {
    packageCode: text("package_code").primaryKey(),
    name: text("name").notNull(),
    location: text("location").notNull(),
    providerPricePhp: numeric("provider_price_php", { precision: 12, scale: 2 }).notNull(),
    markupPhp: numeric("markup_php", { precision: 12, scale: 2 }).notNull().default("0"),
    sellingPricePhp: numeric("selling_price_php", { precision: 12, scale: 2 }),
    volumeBytes: bigint("volume_bytes", { mode: "number" }).notNull(),
    dataGb: numeric("data_gb", { precision: 12, scale: 3 }).notNull(),
    duration: integer("duration").notNull(),
    durationUnit: text("duration_unit").notNull(),
    supportTopUp: boolean("support_top_up").notNull().default(false),
    speed: text("speed").notNull(),
    activeType: integer("active_type").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    providerSyncedAt: timestamp("provider_synced_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("esim_plans_location_idx").on(table.location)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNo: text("order_no").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    transactionId: text("transaction_id").notNull(),
    packageCode: text("package_code").notNull(),
    packageName: text("package_name").notNull(),
    location: text("location").notNull(),
    dataGb: numeric("data_gb", { precision: 12, scale: 3 }),
    totalVolumeBytes: bigint("total_volume_bytes", { mode: "number" }),
    totalDuration: integer("total_duration"),
    durationUnit: text("duration_unit"),
    amountPhp: numeric("amount_php", { precision: 12, scale: 2 }).notNull(),
    paymentStatus: text("payment_status").notNull().default("DEMO_NOT_CHARGED"),
    esimStatus: text("esim_status").notNull().default("PROVISIONING"),
    smdpStatus: text("smdp_status").notNull().default("PENDING"),
    iccid: text("iccid"),
    esimTranNo: text("esim_tran_no"),
    qrCodeUrl: text("qr_code_url"),
    shortUrl: text("short_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("orders_order_no_idx").on(table.orderNo),
    index("orders_customer_idx").on(table.customerId),
    index("orders_created_at_idx").on(table.createdAt),
  ],
);

export const adminActivityLogs = pgTable(
  "admin_activity_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminId: uuid("admin_id").references(() => customers.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    relatedOrderNo: text("related_order_no"),
    relatedCustomerId: uuid("related_customer_id"),
    relatedPackageCode: text("related_package_code"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("admin_activity_created_at_idx").on(table.createdAt)],
);

export type Customer = typeof customers.$inferSelect;
export type EsimPlanRecord = typeof esimPlans.$inferSelect;
export type OrderRecord = typeof orders.$inferSelect;
import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/authMiddleware";
import {
  getAdminStats,
  listActivityLogs,
  listAdminPlans,
  listAllOrders,
  logActivity,
  updatePlanPricing,
} from "../lib/store";

const router: IRouter = Router();

router.use("/admin", requireAdmin);

router.get("/admin/overview", async (_req, res): Promise<void> => {
  const [stats, recentOrders] = await Promise.all([getAdminStats(), listAllOrders(10)]);
  res.json({
    ...stats,
    recentOrders: recentOrders.map((order) => ({
      orderNo: order.orderNo,
      packageName: order.packageName,
      location: order.location,
      amountPhp: Number(order.amountPhp),
      paymentStatus: order.paymentStatus,
      esimStatus: order.esimStatus,
      createdAt: order.createdAt,
    })),
  });
});

router.get("/admin/plans", async (_req, res): Promise<void> => {
  const plans = await listAdminPlans();
  res.json({
    plans: plans.map((plan) => ({
      packageCode: plan.packageCode,
      name: plan.name,
      location: plan.location,
      dataGb: Number(plan.dataGb),
      volumeBytes: plan.volumeBytes,
      duration: plan.duration,
      durationUnit: plan.durationUnit,
      providerPricePhp: Number(plan.providerPricePhp),
      markupPhp: Number(plan.markupPhp),
      sellingPricePhp: plan.sellingPricePhp === null ? null : Number(plan.sellingPricePhp),
      customerPricePhp: plan.sellingPricePhp === null ? Number(plan.providerPricePhp) + Number(plan.markupPhp) : Number(plan.sellingPricePhp),
      supportTopUp: plan.supportTopUp,
      enabled: plan.enabled,
    })),
  });
});

router.patch("/admin/plans/:packageCode", async (req, res): Promise<void> => {
  const packageCode = req.params.packageCode.trim();
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const markupPhp = body.markupPhp === undefined ? undefined : Number(body.markupPhp);
  const sellingPricePhp = body.sellingPricePhp === undefined || body.sellingPricePhp === null ? body.sellingPricePhp === null ? null : undefined : Number(body.sellingPricePhp);
  const enabled = body.enabled === undefined ? undefined : Boolean(body.enabled);
  if ((markupPhp !== undefined && (!Number.isFinite(markupPhp) || markupPhp < 0)) || (typeof sellingPricePhp === "number" && (!Number.isFinite(sellingPricePhp) || sellingPricePhp < 0))) {
    res.status(400).json({ error: "Pricing values must be zero or greater" });
    return;
  }
  const updated = await updatePlanPricing(packageCode, { markupPhp, sellingPricePhp, enabled });
  if (!updated) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  await logActivity({
    adminId: req.user!.id,
    actor: req.user!.email,
    action: sellingPricePhp !== undefined ? "Admin changed eSIM plan price" : "Admin updated eSIM plan",
    relatedPackageCode: packageCode,
    details: { markupPhp, sellingPricePhp, enabled },
  });
  res.json({
    packageCode: updated.packageCode,
    markupPhp: Number(updated.markupPhp),
    sellingPricePhp: updated.sellingPricePhp === null ? null : Number(updated.sellingPricePhp),
    customerPricePhp: updated.sellingPricePhp === null ? Number(updated.providerPricePhp) + Number(updated.markupPhp) : Number(updated.sellingPricePhp),
    enabled: updated.enabled,
  });
});

router.get("/admin/activity", async (_req, res): Promise<void> => {
  const logs = await listActivityLogs();
  res.json({ logs });
});

export default router;
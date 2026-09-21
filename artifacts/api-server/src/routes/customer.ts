import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/authMiddleware";
import { listCustomerOrders, publicCustomer } from "../lib/store";
import { asNumber, callEsimAccessAllowingFailure } from "../lib/esim-access";

const router: IRouter = Router();

async function liveUsage(iccid: string | null, totalVolumeBytes: number | null) {
  if (!iccid) return { usedBytes: null, remainingBytes: null };
  const result = await callEsimAccessAllowingFailure<{ esimList?: Array<{ orderUsage?: unknown }> }>("/esim/query", {
    orderNo: "",
    iccid,
    pager: { pageNum: 1, pageSize: 20 },
  });
  const usedBytes = result.success && result.obj?.esimList?.[0]
    ? asNumber(result.obj.esimList[0].orderUsage, NaN)
    : NaN;
  return {
    usedBytes: Number.isFinite(usedBytes) ? usedBytes : null,
    remainingBytes: Number.isFinite(usedBytes) && totalVolumeBytes !== null ? Math.max(totalVolumeBytes - usedBytes, 0) : null,
  };
}

async function serializeOrder(order: Awaited<ReturnType<typeof listCustomerOrders>>[number]) {
  const usage = await liveUsage(order.iccid, order.totalVolumeBytes);
  return {
    orderNo: order.orderNo,
    transactionId: order.transactionId,
    packageCode: order.packageCode,
    packageName: order.packageName,
    location: order.location,
    dataGb: order.dataGb === null ? null : Number(order.dataGb),
    totalVolumeBytes: order.totalVolumeBytes,
    usedBytes: usage.usedBytes,
    remainingBytes: usage.remainingBytes,
    totalDuration: order.totalDuration,
    durationUnit: order.durationUnit,
    amountPhp: Number(order.amountPhp),
    paymentStatus: order.paymentStatus,
    esimStatus: order.esimStatus,
    smdpStatus: order.smdpStatus,
    iccid: order.iccid,
    esimTranNo: order.esimTranNo,
    qrCodeUrl: order.qrCodeUrl,
    shortUrl: order.shortUrl,
    expiresAt: order.expiresAt,
    createdAt: order.createdAt,
  };
}

router.get("/customer/dashboard", requireAuth, async (req, res): Promise<void> => {
  const orders = await listCustomerOrders(req.user!.id, 10);
  const serialized = await Promise.all(orders.map(serializeOrder));
  res.json({
    user: publicCustomer(req.user!),
    activeEsims: serialized.filter((order) => order.iccid || !["EXPIRED", "FAILED"].includes(order.esimStatus.toUpperCase())),
    recentOrders: serialized.slice(0, 5),
  });
});

router.get("/customer/esims", requireAuth, async (req, res): Promise<void> => {
  const orders = await listCustomerOrders(req.user!.id, 50);
  res.json({ esims: await Promise.all(orders.map(serializeOrder)) });
});

router.get("/customer/orders", requireAuth, async (req, res): Promise<void> => {
  const orders = await listCustomerOrders(req.user!.id, 50);
  res.json({ orders: await Promise.all(orders.map(serializeOrder)) });
});

export default router;
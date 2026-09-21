import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import {
  CreateEsimOrderBody,
  GetEsimBalanceResponse,
  GetEsimPlansResponse,
  CreateEsimOrderResponse,
  CreateEsimTopupBody,
  CreateEsimTopupResponse,
  GetEsimLookupQueryParams,
  GetEsimLookupResponse,
  GetEsimOrderParams,
  GetEsimOrderResponse,
  GetEsimPlansQueryParams,
  GetEsimTopupsQueryParams,
  GetEsimTopupsResponse,
} from "@workspace/api-zod";
import {
  EsimAccessError,
  asNumber,
  asString,
  callEsimAccess,
  callEsimAccessAllowingFailure,
  formatOrder,
  formatPlan,
  formatLookup,
  type EsimDetails,
  type EsimPackage,
} from "../lib/esim-access";
import {
  customerPlanPrice,
  getPlanByCode,
  listCustomerPlans,
  logActivity,
  persistOrder,
  upsertProviderPlan,
} from "../lib/store";

const router: IRouter = Router();

function providerError(error: unknown): string {
  if (error instanceof EsimAccessError) {
    return error.message;
  }
  return "The eSIM provider is temporarily unavailable";
}

function providerStatus(error: unknown): number {
  return error instanceof EsimAccessError && error.code === "200007"
    ? 400
    : 502;
}

async function fetchPackages(filters: {
  locationCode?: string;
  iccid?: string;
  packageCode?: string;
}): Promise<EsimPackage[]> {
  const result = await callEsimAccess<{ packageList?: EsimPackage[] }>(
    "/package/list",
    {
      locationCode: filters.locationCode ?? "",
      type: "",
      slug: "",
      packageCode: filters.packageCode ?? "",
      iccid: filters.iccid ?? "",
    },
  );
  return Array.isArray(result.packageList) ? result.packageList : [];
}

async function findPlan(packageCode: string) {
  const packages = await fetchPackages({ packageCode });
  const packageRecord = packages.find(
    (candidate) => asString(candidate.packageCode) === packageCode,
  );
  if (!packageRecord) return null;
  const formatted = formatPlan(packageRecord);
  const stored = await upsertProviderPlan({
    packageCode: formatted.packageCode,
    name: formatted.name,
    location: formatted.location,
    providerPricePhp: formatted.providerPricePhp,
    volumeBytes: formatted.volumeBytes,
    dataGb: formatted.dataGb,
    duration: formatted.duration,
    durationUnit: formatted.durationUnit,
    supportTopUp: formatted.supportTopUp,
    speed: formatted.speed,
    activeType: formatted.activeType,
  });
  if (!stored.enabled) return null;
  return { ...formatted, pricePhp: customerPlanPrice(stored) };
}

async function syncPlan(packageRecord: EsimPackage) {
  const formatted = formatPlan(packageRecord);
  const stored = await upsertProviderPlan({
    packageCode: formatted.packageCode,
    name: formatted.name,
    location: formatted.location,
    providerPricePhp: formatted.providerPricePhp,
    volumeBytes: formatted.volumeBytes,
    dataGb: formatted.dataGb,
    duration: formatted.duration,
    durationUnit: formatted.durationUnit,
    supportTopUp: formatted.supportTopUp,
    speed: formatted.speed,
    activeType: formatted.activeType,
  });
  return { ...formatted, pricePhp: customerPlanPrice(stored), enabled: stored.enabled };
}

async function fetchOrderDetails(orderNo: string): Promise<EsimDetails | null> {
  const result = await callEsimAccessAllowingFailure<{
    esimList?: EsimDetails[];
  }>("/esim/query", {
    orderNo,
    iccid: "",
    pager: { pageNum: 1, pageSize: 20 },
  });

  if (!result.success || !result.obj?.esimList?.length) {
    if (result.errorCode === "200002" || result.errorCode === "200010") {
      return null;
    }
    throw new EsimAccessError(
      result.errorMsg || "Unable to load that eSIM order",
      result.errorCode ?? null,
    );
  }

  return result.obj.esimList[0] ?? null;
}

async function fetchIccidDetails(iccid: string): Promise<EsimDetails | null> {
  const result = await callEsimAccessAllowingFailure<{
    esimList?: EsimDetails[];
  }>("/esim/query", {
    orderNo: "",
    iccid,
    pager: { pageNum: 1, pageSize: 20 },
  });

  if (!result.success || !result.obj?.esimList?.length) {
    if (
      result.errorCode === "200002" ||
      result.errorCode === "200010" ||
      result.errorCode === "000105"
    ) {
      return null;
    }
    throw new EsimAccessError(
      result.errorMsg || "Unable to find that eSIM",
      result.errorCode ?? null,
    );
  }

  return result.obj.esimList[0] ?? null;
}

async function waitForOrder(orderNo: string): Promise<EsimDetails | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    const details = await fetchOrderDetails(orderNo);
    if (details?.iccid || details?.qrCodeUrl) {
      return details;
    }
  }
  return fetchOrderDetails(orderNo);
}

router.get("/esim/plans", async (req, res): Promise<void> => {
  const parsed = GetEsimPlansQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const packages = await fetchPackages(parsed.data);
    await Promise.all(packages.filter((plan) => asString(plan.packageCode)).map(syncPlan));
    const providerCodes = new Set(packages.map((plan) => asString(plan.packageCode)).filter(Boolean));
    const storedPlans = (await listCustomerPlans()).filter((plan) => providerCodes.has(plan.packageCode));
    const plans = storedPlans.map((plan) => ({
      packageCode: plan.packageCode,
      name: plan.name,
      location: plan.location,
      pricePhp: customerPlanPrice(plan),
      volumeBytes: plan.volumeBytes,
      dataGb: Number(plan.dataGb),
      duration: plan.duration,
      durationUnit: plan.durationUnit,
      supportTopUp: plan.supportTopUp,
      speed: plan.speed,
      activeType: plan.activeType,
    }));
    const regions = Array.from(
      new Set(
        packages
          .map((plan) => asString(plan.location))
          .flatMap((location) => location.split(","))
          .map((location) => location.trim())
          .filter(Boolean),
      ),
    ).sort();

    res.json(
      GetEsimPlansResponse.parse({
        plans,
        regions,
        total: plans.length,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to load eSIM plans");
    res.status(502).json({ error: providerError(error) });
  }
});

router.get("/esim/balance", async (req, res): Promise<void> => {
  try {
    const result = await callEsimAccess<{ balance?: unknown }>(
      "/balance/query",
    );
    res.json(
      GetEsimBalanceResponse.parse({
        balanceUsd: asNumber(result.balance) / 10000,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to load eSIM balance");
    res.status(502).json({ error: providerError(error) });
  }
});

router.get("/esim/lookup", async (req, res): Promise<void> => {
  const parsed = GetEsimLookupQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid ICCID" });
    return;
  }

  try {
    const details = await fetchIccidDetails(parsed.data.iccid);
    if (!details) {
      res.status(404).json({ error: "We could not find an eSIM with that ICCID" });
      return;
    }
    const packageCode = asString(details.packageList?.[0]?.packageCode);
    const plan = packageCode ? await findPlan(packageCode) : null;
    if (!plan) {
      res.status(502).json({ error: "The eSIM plan could not be loaded" });
      return;
    }
    res.json(GetEsimLookupResponse.parse(formatLookup(details, plan)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to look up eSIM");
    res.status(502).json({ error: providerError(error) });
  }
});

router.get("/esim/topups", async (req, res): Promise<void> => {
  const parsed = GetEsimTopupsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid ICCID" });
    return;
  }

  try {
    const packages = await fetchPackages({ iccid: parsed.data.iccid });
    const uniquePackages = new Map<string, EsimPackage>();
    for (const packageRecord of packages) {
      const packageCode = asString(packageRecord.packageCode);
      if (packageCode && !uniquePackages.has(packageCode)) uniquePackages.set(packageCode, packageRecord);
    }
    const plans = (await Promise.all(Array.from(uniquePackages.values()).map(syncPlan)))
      .filter((plan) => plan.packageCode.length > 0 && plan.supportTopUp);
    res.json(
      GetEsimTopupsResponse.parse({
        plans,
        regions: [],
        total: plans.length,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to load compatible eSIM top-ups");
    res.status(502).json({ error: providerError(error) });
  }
});

router.post("/esim/orders", async (req, res): Promise<void> => {
  const parsed = CreateEsimOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const plan = await findPlan(parsed.data.packageCode);
    if (!plan) {
      res.status(400).json({ error: "That eSIM plan is no longer available" });
      return;
    }

    const transactionId = `roamly_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const orderResult = await callEsimAccess<{
      orderNo?: unknown;
      transactionId?: unknown;
    }>("/esim/order", {
      transactionId,
      packageInfoList: [{ packageCode: plan.packageCode, count: 1 }],
    });
    const orderNo = asString(orderResult.orderNo);
    if (!orderNo) {
      res.status(502).json({ error: "The provider did not return an order number" });
      return;
    }

    const details = await waitForOrder(orderNo);
    const response = CreateEsimOrderResponse.parse(
      formatOrder(
        details ?? {
          orderNo,
          transactionId,
          esimStatus: "PROVISIONING",
          smdpStatus: "PENDING",
        },
        plan,
      ),
    );
    try {
      await persistOrder({
        customerId: req.user?.id,
        orderNo: response.orderNo,
        transactionId: response.transactionId,
        packageCode: response.packageCode,
        packageName: response.packageName,
        location: plan.location,
        dataGb: response.dataGb,
        totalVolumeBytes: response.totalVolumeBytes,
        totalDuration: response.totalDuration,
        durationUnit: response.durationUnit,
        amountPhp: response.pricePhp,
        esimStatus: response.status,
        smdpStatus: response.smdpStatus,
        iccid: response.iccid,
        esimTranNo: response.esimTranNo,
        qrCodeUrl: response.qrCodeUrl,
        shortUrl: response.shortUrl,
        expiresAt: response.expiresAt,
      });
      await logActivity({
        actor: req.user?.email ?? "Guest",
        action: "Order created",
        relatedOrderNo: response.orderNo,
        relatedCustomerId: req.user?.id,
        relatedPackageCode: response.packageCode,
        details: { paymentStatus: "DEMO_NOT_CHARGED" },
      });
    } catch (persistenceError) {
      req.log.error({ err: persistenceError, orderNo: response.orderNo }, "Order created but could not be persisted");
    }
    res.status(201).json(response);
  } catch (error) {
    req.log.error({ err: error }, "Unable to create eSIM order");
    res.status(providerStatus(error)).json({ error: providerError(error) });
  }
});

router.post("/esim/topups", async (req, res): Promise<void> => {
  const parsed = CreateEsimTopupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid ICCID and top-up package" });
    return;
  }

  try {
    const details = await fetchIccidDetails(parsed.data.iccid);
    if (!details) {
      res.status(404).json({ error: "We could not find an eSIM with that ICCID" });
      return;
    }
    const compatiblePackages = await fetchPackages({ iccid: parsed.data.iccid });
    const packageRecord = compatiblePackages.find(
      (candidate) =>
        asString(candidate.packageCode) === parsed.data.packageCode &&
        asNumber(candidate.supportTopUpType) === 2,
    );
    if (!packageRecord) {
      res.status(400).json({ error: "That top-up package is not compatible with this eSIM" });
      return;
    }
    const esimTranNo = asString(details.esimTranNo);
    if (!esimTranNo) {
      res.status(400).json({ error: "This eSIM is not ready for a top-up yet" });
      return;
    }

    const transactionId = `onboard_topup_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await callEsimAccess("/esim/topup", {
      esimTranNo,
      iccid: "",
      packageCode: parsed.data.packageCode,
      transactionId,
    });
    const plan = await syncPlan(packageRecord);
    await logActivity({
      actor: req.user?.email ?? "Guest",
      action: "Top-up submitted",
      relatedCustomerId: req.user?.id,
      relatedPackageCode: plan.packageCode,
      details: { iccid: parsed.data.iccid, transactionId },
    });
    res.status(201).json(
      CreateEsimTopupResponse.parse({
        transactionId,
        iccid: parsed.data.iccid,
        packageCode: plan.packageCode,
        packageName: plan.name,
        pricePhp: plan.pricePhp,
        status: "PROCESSING",
        message: "The carrier accepted the top-up. Refresh the eSIM shortly to confirm it.",
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to top up eSIM");
    res.status(providerStatus(error)).json({ error: providerError(error) });
  }
});

router.get("/esim/orders/:orderNo", async (req, res): Promise<void> => {
  const parsed = GetEsimOrderParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const details = await fetchOrderDetails(parsed.data.orderNo);
    if (!details) {
      res.status(404).json({ error: "Order is still provisioning or was not found" });
      return;
    }

    const packageCode = asString(details.packageList?.[0]?.packageCode);
    const plan = packageCode
      ? await findPlan(packageCode)
      : null;
    if (!plan) {
      res.status(502).json({ error: "The order plan could not be loaded" });
      return;
    }

    res.json(GetEsimOrderResponse.parse(formatOrder(details, plan)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load eSIM order");
    res.status(502).json({ error: providerError(error) });
  }
});

export default router;
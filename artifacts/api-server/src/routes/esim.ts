import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import {
  CreateEsimOrderBody,
  GetEsimBalanceResponse,
  GetEsimPlansResponse,
  CreateEsimOrderResponse,
  GetEsimOrderParams,
  GetEsimOrderResponse,
  GetEsimPlansQueryParams,
} from "@workspace/api-zod";
import {
  EsimAccessError,
  asNumber,
  asString,
  callEsimAccess,
  callEsimAccessAllowingFailure,
  formatOrder,
  formatPlan,
  type EsimDetails,
  type EsimPackage,
} from "../lib/esim-access";

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
  return packageRecord ? formatPlan(packageRecord) : null;
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
    if (result.errorCode === "200002") {
      return null;
    }
    throw new EsimAccessError(
      result.errorMsg || "Unable to load that eSIM order",
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
    const plans = packages
      .map(formatPlan)
      .filter((plan) => plan.packageCode.length > 0);
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
    res.status(201).json(response);
  } catch (error) {
    req.log.error({ err: error }, "Unable to create eSIM order");
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
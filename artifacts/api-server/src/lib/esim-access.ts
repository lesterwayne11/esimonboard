import crypto from "node:crypto";

const BASE_URL = "https://api.esimaccess.com/api/v1/open";

type ProviderResponse<T> = {
  success?: boolean;
  errorCode?: string | null;
  errorMsg?: string | null;
  obj?: T;
};

export type EsimPackage = {
  packageCode?: unknown;
  name?: unknown;
  price?: unknown;
  retailPrice?: unknown;
  volume?: unknown;
  duration?: unknown;
  durationUnit?: unknown;
  location?: unknown;
  supportTopUpType?: unknown;
  speed?: unknown;
  activeType?: unknown;
};

export type EsimDetails = {
  esimTranNo?: unknown;
  orderNo?: unknown;
  transactionId?: unknown;
  iccid?: unknown;
  qrCodeUrl?: unknown;
  shortUrl?: unknown;
  smdpStatus?: unknown;
  esimStatus?: unknown;
  totalVolume?: unknown;
  totalDuration?: unknown;
  durationUnit?: unknown;
  expiredTime?: unknown;
  packageList?: Array<Record<string, unknown>>;
};

export class EsimAccessError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "EsimAccessError";
    this.code = code;
  }
}

function getAccessCode(): string {
  const accessCode = process.env.ESIM_ACCESS_CODE;
  if (!accessCode) {
    throw new EsimAccessError("eSIM Access is not configured");
  }
  return accessCode;
}

export async function callEsimAccess<T>(
  endpoint: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const accessCode = getAccessCode();
  const bodyString = JSON.stringify(body);
  const timestamp = Date.now().toString();
  const requestId = crypto.randomUUID();
  const signatureString = timestamp + requestId + accessCode + bodyString;
  const signature = crypto
    .createHmac("sha256", accessCode)
    .update(signatureString)
    .digest("hex")
    .toLowerCase();

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "RT-AccessCode": accessCode,
        "RT-Timestamp": timestamp,
        "RT-RequestID": requestId,
        "RT-Signature": signature,
      },
      body: bodyString,
    });
  } catch {
    throw new EsimAccessError("Unable to reach the eSIM provider");
  }

  let data: ProviderResponse<T>;
  try {
    data = (await response.json()) as ProviderResponse<T>;
  } catch {
    throw new EsimAccessError("The eSIM provider returned an invalid response");
  }

  if (!response.ok || !data.success) {
    throw new EsimAccessError(
      data.errorMsg || "The eSIM provider rejected the request",
      data.errorCode ?? null,
    );
  }

  return data.obj as T;
}

export async function callEsimAccessAllowingFailure<T>(
  endpoint: string,
  body: Record<string, unknown> = {},
): Promise<ProviderResponse<T>> {
  try {
    return { success: true, obj: await callEsimAccess<T>(endpoint, body) };
  } catch (error) {
    if (error instanceof EsimAccessError) {
      return { success: false, errorCode: error.code, errorMsg: error.message };
    }
    throw error;
  }
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

export function formatPlan(plan: EsimPackage) {
  const volumeBytes = asNumber(plan.volume);
  return {
    packageCode: asString(plan.packageCode),
    name: asString(plan.name, "Travel eSIM"),
    location: asString(plan.location),
    priceUsd: asNumber(plan.price) / 10000,
    retailPriceUsd: asNumber(plan.retailPrice) / 10000,
    volumeBytes,
    dataGb: volumeBytes / 1024 ** 3,
    duration: asNumber(plan.duration),
    durationUnit: asString(plan.durationUnit, "DAY"),
    supportTopUp: asNumber(plan.supportTopUpType) === 2,
    speed: asString(plan.speed, "5G/LTE"),
    activeType: asNumber(plan.activeType, 1),
  };
}

export function formatOrder(
  details: EsimDetails,
  plan: ReturnType<typeof formatPlan>,
) {
  const totalVolumeBytes = asNumber(details.totalVolume, plan.volumeBytes);
  const packageCode =
    asString(details.packageList?.[0]?.packageCode) || plan.packageCode;
  const packageName =
    asString(details.packageList?.[0]?.packageName) || plan.name;

  return {
    orderNo: asString(details.orderNo),
    transactionId: asString(details.transactionId),
    packageCode,
    packageName,
    priceUsd: plan.priceUsd,
    status: asString(details.esimStatus, "PROVISIONING"),
    smdpStatus: asString(details.smdpStatus, "PENDING"),
    iccid: typeof details.iccid === "string" ? details.iccid : null,
    esimTranNo:
      typeof details.esimTranNo === "string" ? details.esimTranNo : null,
    qrCodeUrl:
      typeof details.qrCodeUrl === "string" ? details.qrCodeUrl : null,
    shortUrl: typeof details.shortUrl === "string" ? details.shortUrl : null,
    totalVolumeBytes: totalVolumeBytes || null,
    dataGb: totalVolumeBytes ? totalVolumeBytes / 1024 ** 3 : null,
    totalDuration:
      typeof details.totalDuration === "number"
        ? details.totalDuration
        : plan.duration || null,
    durationUnit:
      typeof details.durationUnit === "string"
        ? details.durationUnit
        : plan.durationUnit || null,
    expiresAt:
      typeof details.expiredTime === "string" ? details.expiredTime : null,
  };
}
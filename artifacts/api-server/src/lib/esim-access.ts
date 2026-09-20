import crypto from "node:crypto";

const BASE_URL = "https://api.esimaccess.com/api/v1/open";
const DEFAULT_USD_TO_PHP = 58.4;

function numericEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function customerPricePhp(priceUsd: number): number {
  const exchangeRate = numericEnv("ESIM_USD_TO_PHP", DEFAULT_USD_TO_PHP);
  const markupPhp = numericEnv("ESIM_GLOBAL_MARKUP_PHP", 0);
  return Math.round((priceUsd * exchangeRate + markupPhp) * 100) / 100;
}

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
  orderUsage?: unknown;
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
  const priceUsd = asNumber(plan.price) / 10000;
  return {
    packageCode: asString(plan.packageCode),
    name: asString(plan.name, "Travel eSIM"),
    location: asString(plan.location),
    pricePhp: customerPricePhp(priceUsd),
    priceUsd,
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
    pricePhp: plan.pricePhp,
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

export function formatLookup(
  details: EsimDetails,
  plan: ReturnType<typeof formatPlan>,
) {
  const totalVolumeBytes = asNumber(details.totalVolume, plan.volumeBytes) || null;
  const usedBytes =
    typeof details.orderUsage === "number" && Number.isFinite(details.orderUsage)
      ? details.orderUsage
      : null;
  const remainingBytes =
    totalVolumeBytes !== null && usedBytes !== null
      ? Math.max(totalVolumeBytes - usedBytes, 0)
      : null;
  const packageCode =
    asString(details.packageList?.[0]?.packageCode) || plan.packageCode;
  const packageName =
    asString(details.packageList?.[0]?.packageName) || plan.name;

  return {
    iccid: asString(details.iccid),
    esimTranNo:
      typeof details.esimTranNo === "string" ? details.esimTranNo : null,
    orderNo: typeof details.orderNo === "string" ? details.orderNo : null,
    transactionId:
      typeof details.transactionId === "string" ? details.transactionId : null,
    packageCode,
    packageName,
    totalVolumeBytes,
    usedBytes,
    remainingBytes,
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
    status: asString(details.esimStatus, "UNKNOWN"),
    smdpStatus: asString(details.smdpStatus, "UNKNOWN"),
    supportTopUp: plan.supportTopUp,
    qrCodeUrl:
      typeof details.qrCodeUrl === "string" ? details.qrCodeUrl : null,
    shortUrl: typeof details.shortUrl === "string" ? details.shortUrl : null,
  };
}
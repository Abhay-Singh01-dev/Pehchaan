// "Make alerts reliable on this phone" (backend spec 11.8, FC-9). Several Indian phone makers' battery savers
// delay or stop Chrome's background delivery; the steps to prevent it depend on the maker. The maker is guessed
// from the user agent, or from the model that Chrome's client hints give when the user agent hides it ("K").
// A wrong guess only changes which heading and extra step are shown.
export type PhoneBrand = "xiaomi" | "vivo" | "oppo" | "oneplus" | "samsung" | "other";
export type BatteryStep = "chrome" | "autostart" | "notifications" | "test";

// Checked in this order: OnePlus before Oppo, whose model codes (CPH…) it partly shares.
const BRANDS: Array<[PhoneBrand, RegExp]> = [
  // Xiaomi's newer model codes: M2101K6G, 2201117TI, 23021RAAEG.
  ["xiaomi", /\b(xiaomi|redmi|poco|mi \d+)|\bM2\d{3}[A-Z]\w*\b|\b2\d{4,7}[A-Z]{1,5}\b/i],
  ["vivo", /\b(vivo|iqoo)\b|\bV2\d{3}[A-Z]?\b|\bI2\d{3}\b/i],
  ["oneplus", /\boneplus\b|\b(GM|HD|IN|KB|LE|NE|DN|EB|BE)\d{4}\b/i],
  ["oppo", /\b(oppo|realme)\b|\bCPH\d{4}\b|\bRMX\d{4}\b/i],
  ["samsung", /\bsamsung\b|\bSM-[A-Z]\d{3}/i],
];

export function phoneBrand(userAgent: string, model = ""): PhoneBrand {
  const text = `${userAgent} ${model}`;
  return BRANDS.find(([, re]) => re.test(text))?.[0] ?? "other";
}

/** The steps for this maker, in order. */
export function batterySteps(brand: PhoneBrand): BatteryStep[] {
  return brand === "xiaomi" ? ["chrome", "autostart", "notifications", "test"] : ["chrome", "notifications", "test"];
}

/** The model from Chrome's client hints, where available (Android Chrome); "" otherwise. */
export async function phoneModel(): Promise<string> {
  type HighEntropy = { getHighEntropyValues(hints: string[]): Promise<{ model?: string }> };
  const uaData = (navigator as unknown as { userAgentData?: HighEntropy }).userAgentData;
  try {
    return (await uaData?.getHighEntropyValues(["model"]))?.model ?? "";
  } catch {
    return "";
  }
}

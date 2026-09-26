// Which battery-saver steps to show (backend spec 11.8, FC-9): the phone maker, from the user agent or the model.
import { describe, expect, it } from "vitest";
import { batterySteps, phoneBrand } from "@/app/phoneBrand";

const android = (model: string) =>
  `Mozilla/5.0 (Linux; Android 13; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36`;

describe("phoneBrand", () => {
  it.each([
    ["Redmi Note 12 Pro", "xiaomi"],
    ["POCO X5 Pro 5G", "xiaomi"],
    ["M2101K6G", "xiaomi"],
    ["23021RAAEG", "xiaomi"],
    ["vivo 1906", "vivo"],
    ["V2111", "vivo"],
    ["I2202", "vivo"],
    ["RMX3491", "oppo"],
    ["CPH2239", "oppo"],
    ["OPPO A74", "oppo"],
    ["ONEPLUS A6003", "oneplus"],
    ["KB2001", "oneplus"],
    ["SM-A525F", "samsung"],
    ["Pixel 7", "other"],
  ])("%s → %s", (model, brand) => {
    expect(phoneBrand(android(model))).toBe(brand);
  });

  it("Chrome's reduced user agent hides the model ('K'): the model from client hints decides", () => {
    expect(phoneBrand(android("K"))).toBe("other");
    expect(phoneBrand(android("K"), "Redmi Note 11")).toBe("xiaomi");
    expect(phoneBrand(android("K"), "SM-S911B")).toBe("samsung");
  });
});

describe("batterySteps", () => {
  it("Xiaomi also needs Autostart; every Android phone gets the Chrome battery and notification steps", () => {
    expect(batterySteps("xiaomi")).toEqual(["chrome", "autostart", "notifications", "test"]);
    for (const b of ["vivo", "oppo", "oneplus", "samsung", "other"] as const) {
      expect(batterySteps(b)).toEqual(["chrome", "notifications", "test"]);
    }
  });
});

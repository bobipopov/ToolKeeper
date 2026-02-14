import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn (class name merge utility)", () => {
  it("merges multiple class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "extra")).toBe("base extra");
  });

  it("deduplicates Tailwind conflicts (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("returns empty string for no input", () => {
    expect(cn()).toBe("");
  });
});

describe("validateCodeInRange (inline logic)", () => {
  // Mirrors the validation logic from Inventory.tsx for numeric codes
  function validateNumeric(code: string, from: string, to: string): boolean {
    const num = parseInt(code, 10);
    const f = parseInt(from, 10);
    const t = parseInt(to, 10);
    return !isNaN(num) && num >= f && num < t;
  }

  // Mirrors the validation logic from Inventory.tsx for letter-prefixed codes
  function validateLetterPrefix(code: string, from: string, to: string): boolean {
    const prefix = from.replace(/[0-9]/g, "");
    if (!code.startsWith(prefix)) return false;
    const num = parseInt(code.replace(prefix, ""), 10);
    const f = parseInt(from.replace(prefix, ""), 10);
    const t = parseInt(to.replace(prefix, ""), 10);
    return !isNaN(num) && num >= f && num <= t;
  }

  it("accepts numeric code within range", () => {
    expect(validateNumeric("5", "1", "10")).toBe(true);
  });

  it("rejects numeric code outside range", () => {
    expect(validateNumeric("15", "1", "10")).toBe(false);
  });

  it("rejects non-numeric code", () => {
    expect(validateNumeric("abc", "1", "10")).toBe(false);
  });

  it("accepts code at range start boundary", () => {
    expect(validateNumeric("1", "1", "10")).toBe(true);
  });

  it("rejects code at range end boundary (exclusive)", () => {
    expect(validateNumeric("10", "1", "10")).toBe(false);
  });

  it("accepts letter-prefixed code within range", () => {
    expect(validateLetterPrefix("L5", "L1", "L50")).toBe(true);
  });

  it("rejects letter-prefixed code outside range", () => {
    expect(validateLetterPrefix("L51", "L1", "L50")).toBe(false);
  });

  it("rejects wrong prefix", () => {
    expect(validateLetterPrefix("M5", "L1", "L50")).toBe(false);
  });

  it("accepts letter-prefixed code at boundaries (inclusive)", () => {
    expect(validateLetterPrefix("L1", "L1", "L50")).toBe(true);
    expect(validateLetterPrefix("L50", "L1", "L50")).toBe(true);
  });
});

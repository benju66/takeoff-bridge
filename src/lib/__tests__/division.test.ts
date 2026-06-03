import { describe, it, expect } from "vitest";
import { getDivisionCode } from "../division";

describe("getDivisionCode", () => {
  it("extracts 2-digit code from standard XX-YYYY.ZZZ format", () => {
    expect(getDivisionCode("09-2100.001")).toBe("09");
    expect(getDivisionCode("04-0000.001")).toBe("04");
    expect(getDivisionCode("32-1000.002")).toBe("32");
  });

  it("extracts 2-digit code from XX-YYYY format (no suffix)", () => {
    expect(getDivisionCode("04-0000")).toBe("04");
    expect(getDivisionCode("09-2900")).toBe("09");
  });

  it("extracts 2-digit code from no-hyphen numeric strings", () => {
    expect(getDivisionCode("091234")).toBe("09");
    expect(getDivisionCode("04")).toBe("04");
  });

  it("returns empty string for empty or too-short input", () => {
    expect(getDivisionCode("")).toBe("");
    expect(getDivisionCode("X")).toBe("");
  });

  it("returns empty string for non-digit prefix", () => {
    expect(getDivisionCode("AB-1234")).toBe("");
    expect(getDivisionCode("MANUAL")).toBe("");
    expect(getDivisionCode("XX")).toBe("");
  });

  it("returns empty string for mixed digit/letter prefix", () => {
    expect(getDivisionCode("A9-2100")).toBe("");
    expect(getDivisionCode("9A-2100")).toBe("");
  });
});

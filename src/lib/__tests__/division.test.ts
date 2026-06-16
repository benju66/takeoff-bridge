import { describe, it, expect } from "vitest";
import { getDivisionCode, getBaseCode, getCodeSuffix } from "../division";

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

describe("getBaseCode", () => {
  it("strips the .NNN suffix from standard XX-YYYY.ZZZ format", () => {
    expect(getBaseCode("09-2100.001")).toBe("09-2100");
    expect(getBaseCode("04-0000.001")).toBe("04-0000");
    expect(getBaseCode("32-1613.007")).toBe("32-1613");
  });

  it("returns the whole code when there is no suffix", () => {
    expect(getBaseCode("04-0000")).toBe("04-0000");
    expect(getBaseCode("09-2900")).toBe("09-2900");
  });

  it("returns the whole bare code for no-hyphen numeric strings", () => {
    expect(getBaseCode("091234")).toBe("091234");
    expect(getBaseCode("04")).toBe("04");
  });

  it("returns empty string for empty or too-short input", () => {
    expect(getBaseCode("")).toBe("");
    expect(getBaseCode("X")).toBe("");
  });

  it("returns empty string for invalid (non-digit) prefix", () => {
    expect(getBaseCode("AB-1234.005")).toBe("");
    expect(getBaseCode("MANUAL")).toBe("");
    expect(getBaseCode("9A-2100")).toBe("");
  });
});

describe("getCodeSuffix", () => {
  it("extracts the suffix digits after the dot", () => {
    expect(getCodeSuffix("09-2100.001")).toBe("001");
    expect(getCodeSuffix("04-0000.001")).toBe("001");
    expect(getCodeSuffix("26-0000.006")).toBe("006");
  });

  it("returns empty string when there is no suffix", () => {
    expect(getCodeSuffix("04-0000")).toBe("");
    expect(getCodeSuffix("09-2900")).toBe("");
    expect(getCodeSuffix("091234")).toBe("");
  });

  it("returns empty string for empty or too-short input", () => {
    expect(getCodeSuffix("")).toBe("");
    expect(getCodeSuffix("X")).toBe("");
  });

  it("returns empty string for invalid (non-digit) prefix even with a dot", () => {
    expect(getCodeSuffix("AB-1234.005")).toBe("");
    expect(getCodeSuffix("MANUAL.001")).toBe("");
  });
});

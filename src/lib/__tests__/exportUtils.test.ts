import { describe, it, expect } from "vitest";
import { escapeCSVField, getColumnLetter } from "../exportUtils";

describe("escapeCSVField", () => {
  it("returns empty string for null/undefined", () => {
    expect(escapeCSVField(null)).toBe("");
    expect(escapeCSVField(undefined)).toBe("");
  });

  it("returns plain string when no special characters", () => {
    expect(escapeCSVField("hello")).toBe("hello");
    expect(escapeCSVField(123)).toBe("123");
  });

  it("wraps strings containing commas in double quotes", () => {
    expect(escapeCSVField("hello, world")).toBe('"hello, world"');
  });

  it("wraps strings containing double quotes and doubles them", () => {
    expect(escapeCSVField('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps strings containing newlines", () => {
    expect(escapeCSVField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCSVField("line1\rline2")).toBe('"line1\rline2"');
  });

  it("handles mixed special characters", () => {
    expect(escapeCSVField('a,b"c\nd')).toBe('"a,b""c\nd"');
  });

  it("converts boolean and number to string", () => {
    expect(escapeCSVField(true)).toBe("true");
    expect(escapeCSVField(0)).toBe("0");
  });
});

describe("getColumnLetter", () => {
  it("converts single-letter columns", () => {
    expect(getColumnLetter(1)).toBe("A");
    expect(getColumnLetter(26)).toBe("Z");
  });

  it("converts double-letter columns", () => {
    expect(getColumnLetter(27)).toBe("AA");
    expect(getColumnLetter(28)).toBe("AB");
    expect(getColumnLetter(52)).toBe("AZ");
    expect(getColumnLetter(702)).toBe("ZZ");
  });

  it("converts triple-letter columns", () => {
    expect(getColumnLetter(703)).toBe("AAA");
  });

  it("returns empty string for 0", () => {
    expect(getColumnLetter(0)).toBe("");
  });
});

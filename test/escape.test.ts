import { describe, it, expect } from "vitest";
import { escapeHtml } from "../src/escape";

describe("escapeHtml", () => {
  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes ampersands first so entities are not double-decoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("escapes both quote styles for attribute safety", () => {
    expect(escapeHtml(`"x'y`)).toBe("&quot;x&#39;y");
  });

  it("leaves ordinary token names untouched", () => {
    expect(escapeHtml("Chumble Crudluck")).toBe("Chumble Crudluck");
  });
});

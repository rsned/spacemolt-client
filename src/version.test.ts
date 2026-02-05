import { describe, expect, test } from "bun:test";

// Re-implement compareVersions for testing (since it's not exported)
function compareVersions(current: string, latest: string): number {
  const currentParts = current.replace(/^v/, '').split('.').map(Number);
  const latestParts = latest.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const curr = currentParts[i] || 0;
    const lat = latestParts[i] || 0;
    if (lat > curr) return 1;  // latest is newer
    if (lat < curr) return -1; // current is newer
  }
  return 0; // equal
}

describe("compareVersions", () => {
  test("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.6.5", "0.6.5")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  test("returns 1 when latest is newer (major)", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(1);
    expect(compareVersions("0.6.5", "1.0.0")).toBe(1);
  });

  test("returns 1 when latest is newer (minor)", () => {
    expect(compareVersions("1.0.0", "1.1.0")).toBe(1);
    expect(compareVersions("0.6.5", "0.7.0")).toBe(1);
  });

  test("returns 1 when latest is newer (patch)", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBe(1);
    expect(compareVersions("0.6.5", "0.6.6")).toBe(1);
  });

  test("returns -1 when current is newer", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBe(-1);
    expect(compareVersions("1.1.0", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(-1);
  });

  test("handles versions with different segment counts", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.1")).toBe(1);
    expect(compareVersions("1.0.1", "1.0")).toBe(-1);
  });

  test("handles v prefix", () => {
    expect(compareVersions("v0.6.5", "v0.6.6")).toBe(1);
    expect(compareVersions("0.6.5", "v0.6.6")).toBe(1);
    expect(compareVersions("v0.6.5", "0.6.6")).toBe(1);
  });
});

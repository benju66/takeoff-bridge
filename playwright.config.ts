import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

// Manually load .env.local to populate process.env for E2E tests
try {
  const envPath = path.resolve(__dirname, ".env.local");
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, "utf-8");
    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const [key, ...values] = trimmed.split("=");
        const value = values.join("=").trim();
        process.env[key.trim()] = value;
      }
    }
    console.log("Playwright config loaded .env.local variables successfully.");
  }
} catch (err) {
  console.error("Failed to load .env.local in Playwright config:", err);
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});

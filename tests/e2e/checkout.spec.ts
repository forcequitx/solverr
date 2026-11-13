import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalScroll, test } from "./fixtures";

/** A customer paying the demo store, which runs in test mode: NEAR Intents is simulated, so no money moves. */

const FLAT_WHITE = "/l/lnk_DemoFlatWhite000001";
const TIP_JAR = "/l/lnk_DemoTipJar00000001";
/** A NEAR account that belongs to no one, for refunds. */
const refundAccount = () => randomBytes(32).toString("hex");

/** Opens the flat white's checkout and picks `coin` on NEAR; the worker creates the demo store when it starts, so the link may take a moment. */
async function openCheckout(page: Page, coin = /^USDC ≈/) {
  await expect(async () => {
    await page.goto(FLAT_WHITE);
    await expect(page.getByRole("button", { name: /Continue to payment/ })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.waitForURL(/\/pay\/inv_/);
  await page.getByRole("button", { name: /^NEAR \d+ coins/ }).click();
  await page.getByRole("button", { name: coin }).first().click();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.getByRole("radio", { name: /Send manually/ }).click();
}

async function showAddress(page: Page) {
  await page.getByRole("checkbox").first().check();
  await page.getByLabel(/address for refunds/i).fill(refundAccount());
  await page.getByRole("button", { name: /Show payment address/ }).click();
  await expect(page.getByText("Send exactly")).toBeVisible();
}

test("the demo store lists its products", async ({ page }) => {
  await page.goto("/demo");
  for (const product of ["Flat white", "House beans, 1 kg", "Tip the baristas"]) await expect(page.getByRole("heading", { name: product })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay with crypto" })).toHaveCount(3);
});

test("a customer pays the flat white with USDC on NEAR and gets a receipt showing what the business received", async ({ page }) => {
  await openCheckout(page);
  const show = page.getByRole("button", { name: /Show payment address/ });
  await expect(show).toBeDisabled();
  await showAddress(page);
  await expect(page.getByText(/one-time/).first()).toBeVisible();
  await expect(page.getByText("Simulate a payment (test mode)")).toBeVisible();

  await page.getByRole("button", { name: /^Paid$/ }).click();
  await expect(page.getByText("Payment complete").first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: /View receipt/ }).or(page.getByRole("link", { name: /View receipt/ })).first().click();
  await expect(page.getByText("Northwind Coffee (demo)").first()).toBeVisible();
  await expect(page.getByText("Business received")).toBeVisible();
  await expect(page.getByText(/USDC on Base/).first()).toBeVisible();
  await expect(page.getByText(/USDC on NEAR/).first()).toBeVisible();
});

test("a refund address that is not a NEAR address is refused before any payment address is shown", async ({ page }) => {
  await openCheckout(page);
  await page.getByRole("checkbox").first().check();
  await page.getByLabel(/address for refunds/i).fill("Not An Address!");
  await page.getByRole("button", { name: /Show payment address/ }).click();
  await expect(page.getByText("This is not a valid NEAR address. Check it and try again.")).toBeVisible();
  await expect(page.getByText("Send exactly")).toHaveCount(0);
});

test("a payment NEAR Intents returns shows the refund screen", async ({ page }) => {
  await openCheckout(page);
  await showAddress(page);
  await page.getByRole("button", { name: /^Refunded$/ }).click();
  await expect(page.getByText("Your payment was refunded").first()).toBeVisible({ timeout: 90_000 });
});

test("a tip asks for an amount and refuses one out of range", async ({ page }) => {
  await expect(async () => {
    await page.goto(TIP_JAR);
    await expect(page.getByRole("button", { name: /Continue to payment/ })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  const amount = page.getByLabel("Amount in USD");
  await amount.fill("0");
  await expect(page.getByText(/Enter an amount from 0.01/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue to payment/ })).toBeDisabled();
  await amount.fill("3.50");
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.waitForURL(/\/pay\/inv_/);
  await expect(page.getByText("3.50").first()).toBeVisible();
});

/** The simulated network rounds amounts, so the 24-digit grouping itself is covered by the `amountGroups` unit test. */
test("a wNEAR amount fits a phone and Copy amount copies exactly the number shown @phone", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openCheckout(page, /^wNEAR ≈/);
  await showAddress(page);
  const hero = page.locator("h2", { hasText: /send exactly/i }).locator("xpath=following-sibling::p[1]");
  await expectNoHorizontalScroll(page);
  const shown = (await hero.textContent())!.replace("wNEAR", "").trim();
  expect(shown).toMatch(/^\d+(\.\d+)?$/);

  await page.getByRole("button", { name: /Copy amount/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
});

test("the checkout fits a phone screen through to the payment address @phone", async ({ page }) => {
  await openCheckout(page);
  await expectNoHorizontalScroll(page);
  await showAddress(page);
  await expectNoHorizontalScroll(page);
  await expect(page.getByRole("button", { name: /Copy address/ })).toBeVisible();
});

import { expect, test as base, type Page } from "@playwright/test";
import sharp from "sharp";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** Every page talks only to the local servers: wallet SDKs, fonts and RPCs elsewhere are refused, so no test traffic leaves the machine. */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
    await provide(context);
  },
});
export { expect };

/** Signs in with a fresh EVM key through the same wallet endpoints the sign-in page uses; returns the wallet's address. */
export async function signIn(page: Page): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey());
  await page.goto("/robots.txt");
  const post = (path: string, body: object) =>
    page.evaluate(
      async ([url, data]) => {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
        return { status: response.status, body: await response.json().catch(() => null) };
      },
      [path, body] as const,
    );
  const challenge = await post("/api/auth/wallet/challenge", { kind: "evm", address: account.address });
  expect(challenge.status).toBe(200);
  const verify = await post("/api/auth/wallet/verify", { nonce: challenge.body.nonce, signature: await account.signMessage({ message: challenge.body.message }) });
  expect(verify.status).toBe(200);
  return account.address;
}

/** Signs in as a new owner and finishes setup: the business `name`, the sign-in wallet as payout wallet on Base, receiving USDC. */
export async function setUpBusiness(page: Page, name: string): Promise<string> {
  const address = await signIn(page);
  await page.goto("/onboarding");
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await choose(page, "payout-network", /^Base/);
  await page.getByRole("button", { name: /Use the wallet you signed in with/ }).click();
  await expect(page.getByText("Payments go to your wallet on Base")).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL(/\/dashboard$/);
  return address;
}

/** A small PNG logo, as a file the page's file input accepts. */
export async function pngLogo(color = "#155dfc") {
  const buffer = await sharp({ create: { width: 128, height: 128, channels: 3, background: color } }).png().toBuffer();
  return { name: "logo.png", mimeType: "image/png", buffer };
}

/** Picks an option in a SearchSelect (the app's dropdown) by its visible label. */
export async function choose(page: Page, fieldId: string, option: RegExp) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole("option", { name: option }).first().click();
}

/** The page fits the screen width, with no sideways scrolling. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

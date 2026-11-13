import { choose, expect, expectNoHorizontalScroll, pngLogo, signIn, test } from "./fixtures";

/** Business setup as a new owner sees it: sign in, business details with a logo, then network, coin and payout wallet. */

test("a signed-out visitor sees a three-step setup that starts with sign-in", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  for (const label of ["Sign in", "Business details", "Where you get paid"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Connect your site|\$1 payment/)).toHaveCount(0);
});

test("a new owner sets up the business with a logo, the network, the coin and the payout wallet", async ({ page }) => {
  const address = await signIn(page);
  await page.goto("/onboarding");
  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  const next = page.getByRole("button", { name: "Next step" });
  await expect(next).toBeDisabled();

  await page.getByLabel("Business name").fill("Harbor Bakery");
  await page.getByLabel("Website (optional)").fill("https://harbor.example");
  await page.locator('input[type="file"]').setInputFiles(await pngLogo());
  await expect(page.locator('img[src^="blob:"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace logo" })).toBeVisible();
  await next.click();

  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where you get paid" })).toBeVisible();
  await choose(page, "payout-network", /^Base/);
  await expect(page.locator("#settlement-coin")).toContainText("USDC on Base");
  const finish = page.getByRole("button", { name: "Finish setup" });
  await expect(finish).toBeDisabled();

  await page.getByRole("button", { name: /Use the wallet you signed in with/ }).click();
  await expect(page.getByText("Payments go to your wallet on Base")).toBeVisible();
  await expect(page.getByText(address)).toBeVisible();
  await expect(finish).toBeEnabled();
  await finish.click();
  await page.waitForURL(/\/dashboard$/);

  await page.goto("/dashboard/settings");
  await expect(page.locator('img[src^="/api/v1/logos/"]').first()).toBeVisible();
  await expect(page.getByText("Payments go to your wallet on Base")).toBeVisible();
  await expect(page.locator("#settlement-coin")).toContainText("USDC on Base");
  await expect(page.getByLabel("Business name")).toHaveValue("Harbor Bakery");
});

test("switching the network lists that network's coins and asks for a wallet on it again", async ({ page }) => {
  await signIn(page);
  await page.goto("/onboarding");
  await page.getByLabel("Business name").fill("Network Switch Cafe");
  await page.getByRole("button", { name: "Next step" }).click();
  await choose(page, "payout-network", /^Base/);
  await page.getByRole("button", { name: /Use the wallet you signed in with/ }).click();
  await expect(page.getByText("Payments go to your wallet on Base")).toBeVisible();

  await choose(page, "payout-network", /^Ethereum/);
  const finish = page.getByRole("button", { name: "Finish setup" });
  await expect(finish).toBeDisabled();
  await expect(page.getByText("Payments go to your wallet on Base")).toHaveCount(0);
  await page.locator("#settlement-coin").click();
  for (const coin of [/^USDC on Ethereum/, /^USDT on Ethereum/, /^ETH on Ethereum \(native coin\)/]) await expect(page.getByRole("option", { name: coin })).toBeVisible();
  await page.getByRole("option", { name: /^ETH on Ethereum/ }).click();

  await page.getByRole("button", { name: /Use the wallet you signed in with/ }).click();
  await expect(page.getByText("Payments go to your wallet on Ethereum")).toBeVisible();
  await expect(finish).toBeEnabled();
  await expect(page.getByText("NEAR Intents currently refuses payments under $1,000 into ETH on Ethereum (native coin).")).toBeVisible();

  await choose(page, "payout-network", /^Solana/);
  await expect(page.getByRole("button", { name: /Use the wallet you signed in with/ })).toHaveCount(0);
  await expect(finish).toBeDisabled();
  await expect(page.locator("#settlement-coin")).toContainText("USDC on Solana");
});

test("a logo that is too large is refused before upload, and a file that is not an image keeps the business step open", async ({ page }) => {
  await signIn(page);
  await page.goto("/onboarding");
  await page.getByLabel("Business name").fill("Logo Check Shop");
  const fileInput = page.locator('input[type="file"]');

  await fileInput.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(801 * 1024) });
  await expect(page.getByText("The logo can be at most 800 KB.")).toBeVisible();
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);

  await fileInput.setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)>") });
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByText("Upload a PNG, JPEG or WebP image.")).toBeVisible();
  await expect(page.getByText("Step 2 of 3")).toBeVisible();

  /** After a refusal the dock button offers a retry; it saves the business already created instead of making another. */
  await fileInput.setInputFiles(await pngLogo("#7ccf00"));
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible();
});

test("creating another business saves it once, even when its first logo is refused", async ({ page }) => {
  await signIn(page);
  await page.goto("/onboarding");
  await page.getByLabel("Business name").fill("First Shop");
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible();

  await page.goto("/onboarding?new=1");
  await page.getByLabel("Business name").fill("Second Shop");
  await page.locator('input[type="file"]').setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByText("Upload a PNG, JPEG or WebP image.")).toBeVisible();
  await page.waitForURL(/\/onboarding$/);
  await expect(page.getByText("Step 2 of 3")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(await pngLogo());
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await page.goto("/dashboard");
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(2);
  await expect(page.getByRole("menuitemradio", { name: /Second Shop/ })).toHaveCount(1);
});

test("going back to the business step shows what was saved and does not upload the logo again", async ({ page }) => {
  await signIn(page);
  await page.goto("/onboarding");
  await page.getByLabel("Business name").fill("Back And Forth");
  await page.locator('input[type="file"]').setInputFiles(await pngLogo());
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Business name")).toHaveValue("Back And Forth");
  await page.reload();
  await page.getByRole("button", { name: "Back" }).click();
  const stored = page.locator('img[src^="/api/v1/logos/"]');
  await expect(stored).toBeVisible();
  const before = await stored.getAttribute("src");

  /** The first save from a reloaded page can wait for the dev server to compile it. */
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator('img[src^="/api/v1/logos/"]')).toHaveAttribute("src", before!);
});

test("an owner who finished setup goes to the dashboard when signing in again", async ({ page }) => {
  await signIn(page);
  await page.goto("/onboarding");
  await page.getByLabel("Business name").fill("Finished Shop");
  await page.getByRole("button", { name: "Next step" }).click();
  await choose(page, "payout-network", /^Base/);
  await page.getByRole("button", { name: /Use the wallet you signed in with/ }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL(/\/dashboard$/);

  await page.goto("/signin");
  await page.waitForURL(/\/dashboard$/);
});

test("every setup step fits a phone screen and keeps Back and Next in reach @phone", async ({ page }) => {
  await page.goto("/onboarding");
  await expectNoHorizontalScroll(page);
  await signIn(page);
  await page.goto("/onboarding");
  await page.getByLabel("Business name").fill("Phone Shop");
  await page.locator('input[type="file"]').setInputFiles(await pngLogo());
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expect(page.getByRole("button", { name: "Finish setup" })).toBeInViewport();
});

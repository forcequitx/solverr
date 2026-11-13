import { expect, setUpBusiness, test } from "./fixtures";

/** A business owner's daily tools and a developer's first API calls, against a business set up through the real setup flow. */

test("the dashboard and its pages need a sign-in", async ({ page }) => {
  for (const path of ["/dashboard", "/dashboard/settings", "/dashboard/developers"]) {
    await page.goto(path);
    await expect(page.getByText("Step 1 of 3")).toBeVisible();
    expect(new URL(page.url()).pathname).not.toMatch(/^\/dashboard/);
  }
});

test("an owner creates a payment link, sees it in the pay button snippet, and customers can open it", async ({ page }) => {
  await setUpBusiness(page, "Corner Cafe");
  await page.goto("/dashboard/links");
  await page.getByLabel("What is it for?").fill("Flat white");
  await page.getByLabel("Amount").fill("4.50");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Flat white").first()).toBeVisible();

  await page.goto("/dashboard/button");
  const snippet = page.getByText(/data-solverr-link="lnk_/).first();
  await expect(snippet).toBeVisible();
  const linkId = /data-solverr-link="(lnk_[A-Za-z0-9]+)"/.exec((await snippet.textContent()) ?? "")?.[1];
  expect(linkId).toBeTruthy();

  await page.goto(`/l/${linkId}`);
  await expect(page.getByText("Corner Cafe").first()).toBeVisible();
  await expect(page.getByText("Demo")).toHaveCount(0);
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.waitForURL(/\/pay\/inv_/);
  await expect(page.getByText("4.50").first()).toBeVisible();
});

test("a developer creates an API key and uses it to create an invoice, once per idempotency key", async ({ page }) => {
  await setUpBusiness(page, "Api Shop");
  await page.goto("/dashboard/developers");
  await page.getByRole("button", { name: "Create API key" }).click();
  const secret = (await page.getByText(/^sk_live_/).first().textContent())?.trim() ?? "";
  expect(secret).toMatch(/^sk_live_/);
  await expect(page.getByText("Copy it now. Solverr cannot show it again.")).toBeVisible();

  const create = (key: string, idempotencyKey: string) =>
    page.request.post("/api/v1/invoices", {
      headers: { authorization: `Bearer ${key}`, "idempotency-key": idempotencyKey },
      data: { amount: "25.00", currency: "USD", order_id: "order-1042", description: "Internal note" },
    });

  const first = await create(secret, "order-1042");
  expect(first.status()).toBe(201);
  const invoice = await first.json();
  expect(invoice).toMatchObject({ object: "invoice", amount: "25.00", currency: "USD", order_id: "order-1042" });
  expect(invoice.checkout_url).toContain(`/pay/${invoice.id}`);

  const replay = await create(secret, "order-1042");
  expect(replay.status()).toBe(201);
  expect(replay.headers()["idempotent-replayed"]).toBe("true");
  expect((await replay.json()).id).toBe(invoice.id);

  const wrongKey = await create("sk_live_not_a_real_key_000000000000", "order-1043");
  expect(wrongKey.status()).toBe(401);

  /** The public checkout view of the invoice shows the amount and keeps the business's own note private. */
  const status = await page.request.get(`/api/v1/invoices/${invoice.id}/status`);
  expect(status.status()).toBe(200);
  const checkout = await status.json();
  expect(checkout).toMatchObject({ amount: "25.00", order_id: "order-1042" });
  expect(JSON.stringify(checkout)).not.toContain("Internal note");

  await page.goto(new URL(invoice.checkout_url).pathname);
  await expect(page.getByText("25.00").first()).toBeVisible();
  await expect(page.getByText("Api Shop").first()).toBeVisible();
});

test("settings show the verified payout wallet, and its coin can be changed to another one on that network", async ({ page }) => {
  const address = await setUpBusiness(page, "Settings Shop");
  await page.goto("/dashboard/settings");
  await expect(page.getByText("Payments go to your wallet on Base")).toBeVisible();
  await expect(page.getByText(address).first()).toBeVisible();
  await page.locator("#settlement-coin").click();
  await page.getByRole("option", { name: /^ETH on Base/ }).click();
  const coinForm = page.locator("form").filter({ has: page.locator("#settlement-coin") });
  await coinForm.getByRole("button", { name: "Save" }).click();
  /** Reloading before the save answers would cancel it. */
  await expect(coinForm.getByRole("button", { name: /Saved/ })).toBeVisible();
  await page.reload();
  await expect(page.locator("#settlement-coin")).toContainText("ETH on Base");
});

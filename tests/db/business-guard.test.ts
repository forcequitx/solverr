import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Merchant, TeamRole } from "@/generated/prisma/client";
import { GET as exportPayments } from "@/app/(dashboard)/dashboard/payments/export/route";
import { MERCHANT_COOKIE, OTHER_BUSINESS_MESSAGE } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { updateProfileAction } from "@/lib/merchants/actions/account";
import { editable, ownerOnly } from "@/lib/merchants/actions/shared";
import { createInvoice, createMerchant } from "./factories";

/** The signed-in user and the business their `solverr_merchant` cookie selects, as the request would carry them. */
const request = vi.hoisted(() => ({ user: { id: "", name: "", email: "" }, selected: "" }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === MERCHANT_COOKIE && request.selected ? { name, value: request.selected } : undefined) }),
}));

vi.mock("@/lib/auth/server", () => ({
  getAuth: () => ({ api: { getSession: async () => ({ user: request.user, session: { createdAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000) } }) } }),
  sessionExtensionDue: () => false,
}));

/** A user who owns X and Y (or has `roleInY` there), signed in with Y selected, as after switching to Y in another tab. */
async function signedInWithTwoBusinesses(roleInY: TeamRole = "owner"): Promise<{ x: Merchant; y: Merchant }> {
  const db = getDb();
  const id = randomUUID();
  const user = await db.user.create({ data: { id, name: "Ada", email: `${id}@example.com` } });
  const x = await createMerchant({ name: "Business X" });
  const y = await createMerchant({ name: "Business Y" });
  await db.teamMember.createMany({
    data: [
      { id: newId("tm"), merchantId: x.id, userId: user.id, role: "owner" },
      { id: newId("tm"), merchantId: y.id, userId: user.id, role: roleInY },
    ],
  });
  request.user = { id: user.id, name: user.name, email: user.email };
  request.selected = y.id;
  return { x, y };
}

describe("dashboard business guard", () => {
  it("lets actions run on the business the page showed when it is still selected", async () => {
    const { y } = await signedInWithTwoBusinesses();
    await expect(editable(y.id)).resolves.toMatchObject({ merchant: { id: y.id }, role: "owner" });
    await expect(ownerOnly("Only the owner can do this.", y.id)).resolves.toMatchObject({ merchant: { id: y.id } });
  });

  it("refuses with 409 when the page showed another business, even one the user owns", async () => {
    const { x } = await signedInWithTwoBusinesses();
    await expect(editable(x.id)).rejects.toMatchObject({ status: 409, message: OTHER_BUSINESS_MESSAGE });
    await expect(ownerOnly("Only the owner can do this.", x.id)).rejects.toMatchObject({ status: 409, message: OTHER_BUSINESS_MESSAGE });
  });

  it("still refuses teammates the owner-only settings of the selected business", async () => {
    const { y } = await signedInWithTwoBusinesses("developer");
    await expect(ownerOnly("Only the owner can do this.", y.id)).rejects.toMatchObject({ status: 403, message: "Only the owner can do this." });
  });

  it("does not rename the selected business from a tab that shows another one", async () => {
    const { x, y } = await signedInWithTwoBusinesses();
    await expect(updateProfileAction(x.id, { name: "Renamed" })).resolves.toEqual({ ok: false, error: OTHER_BUSINESS_MESSAGE });
    const names = await getDb().merchant.findMany({ where: { id: { in: [x.id, y.id] } }, select: { name: true }, orderBy: { name: "asc" } });
    expect(names.map(({ name }) => name)).toEqual(["Business X", "Business Y"]);
  });
});

describe("payments CSV export", () => {
  const exportUrl = (query: Record<string, string>) => new Request(`http://localhost/dashboard/payments/export?${new URLSearchParams(query)}`);

  it("refuses a link from a tab that shows another business", async () => {
    const { x } = await signedInWithTwoBusinesses();
    const response = await exportPayments(exportUrl({ merchant: x.id }));
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(OTHER_BUSINESS_MESSAGE);
  });

  it("applies the list's filters and starts with a UTF-8 byte order mark", async () => {
    const { y } = await signedInWithTwoBusinesses();
    await createInvoice(y, { orderId: "café-1", description: "=SUM(A1)", status: "paid" });
    await createInvoice(y, { orderId: "café-2", status: "expired" });
    await createInvoice(y, { orderId: "tea-1", status: "paid" });
    const response = await exportPayments(exportUrl({ merchant: y.id, status: "paid", search: "CAFÉ" }));
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    /** TextDecoder drops the byte order mark, as spreadsheet apps do. */
    const lines = new TextDecoder().decode(bytes).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("café-1");
    expect(lines[1]).toContain("'=SUM(A1)");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { OneClickError, OneClickSlotTimeout } from "@/lib/oneclick/client";
import { checkHealth, paymentsDelayed } from "@/lib/payments/health";

const oneClick = vi.hoisted(() => ({ requestEstimate: vi.fn() }));

vi.mock("@/lib/oneclick/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oneclick/client")>()),
  requestEstimate: oneClick.requestEstimate,
}));

/** A 1Click answer with `status` and the JSON body `{ message }`, as the client builds it. */
const answer = (status: number, message: string) => new OneClickError(`1Click POST /v0/quote failed with ${status}`, status, { message });

const failures = async () => (await getDb().serviceHealth.findUnique({ where: { id: "oneclick" } }))?.consecutiveFailures;

beforeEach(() => {
  oneClick.requestEstimate.mockReset();
});

describe("checkHealth", () => {
  it("records a healthy 1Click when the probe quote succeeds", async () => {
    oneClick.requestEstimate.mockResolvedValue({});
    expect(await checkHealth()).toBe(true);
    expect(await failures()).toBe(0);
    expect(await paymentsDelayed()).toBe(false);
  });

  it("counts a refused probe route (400) as 1Click answering, so no delay notice appears", async () => {
    oneClick.requestEstimate.mockRejectedValue(answer(400, "Quoting for this pair is not available"));
    expect(await checkHealth()).toBe(true);
    expect(await checkHealth()).toBe(true);
    expect(await failures()).toBe(0);
    expect(await paymentsDelayed()).toBe(false);
  });

  it.each([
    [401, "Invalid token"],
    [403, "Forbidden"],
    [408, "Request Timeout"],
    [429, "Too Many Requests"],
    [503, "Service Unavailable"],
  ])("counts a %i answer as a failure and shows the delay notice after two in a row", async (status, message) => {
    oneClick.requestEstimate.mockRejectedValue(answer(status, message));
    expect(await checkHealth()).toBe(false);
    expect(await paymentsDelayed()).toBe(false);
    expect(await checkHealth()).toBe(false);
    expect(await failures()).toBe(2);
    expect(await paymentsDelayed()).toBe(true);
  });

  it("counts an unreachable 1Click as a failure", async () => {
    oneClick.requestEstimate.mockRejectedValue(new OneClickError("1Click POST /v0/quote did not respond in time"));
    expect(await checkHealth()).toBe(false);
    expect(await failures()).toBe(1);
  });

  it("clears the delay notice once 1Click answers again, even with a refused route", async () => {
    oneClick.requestEstimate.mockRejectedValue(answer(503, "Service Unavailable"));
    await checkHealth();
    await checkHealth();
    expect(await paymentsDelayed()).toBe(true);
    oneClick.requestEstimate.mockRejectedValue(answer(400, "Quoting for this pair is not available"));
    expect(await checkHealth()).toBe(true);
    expect(await failures()).toBe(0);
    expect(await paymentsDelayed()).toBe(false);
  });

  it("skips the check without recording anything when no rate-limit slot was free", async () => {
    oneClick.requestEstimate.mockRejectedValue(new OneClickSlotTimeout(5_000));
    expect(await checkHealth()).toBe(true);
    expect(await failures()).toBeUndefined();
  });
});

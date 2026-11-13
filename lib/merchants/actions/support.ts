"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { type ActionResult, editable, fail, ID } from "@/lib/merchants/actions/shared";

/** Marks a support case on one of the business's invoices as resolved. */
export async function resolveSupportCaseAction(merchantId: string, caseId: string): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    await getDb().supportCase.updateMany({ where: { id: ID.parse(caseId), invoice: { merchantId: merchant.id } }, data: { status: "resolved" } });
    revalidatePath("/dashboard/support");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

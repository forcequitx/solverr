import type { SupportCaseKind } from "@/generated/prisma/client";

/** Plain names for each support case problem, in the order the dashboard lists them. */
export const CASE_KIND_LABELS: Record<SupportCaseKind, string> = {
  swap_failed: "Failed swap",
  stuck: "Payment stuck",
  wrong_chain: "Wrong network",
  wrong_coin: "Wrong coin",
  missing_memo: "Missing memo",
  not_found: "Payment not found",
};

export const caseKindLabel = (kind: string) => CASE_KIND_LABELS[kind as SupportCaseKind] ?? kind.replace(/_/g, " ");

import type { ReactNode } from "react";
import { EMPTY_LIST_HEIGHT } from "@/components/dashboard/list/list-styles";

/** A list card's empty state, centered in the compact empty-list height. */
export function ListEmpty({ children }: { children: ReactNode }) {
  return <div className={`flex flex-col px-5 pb-5 sm:px-6 sm:pb-6 [&>*]:flex-1 [&>*]:justify-center ${EMPTY_LIST_HEIGHT}`}>{children}</div>;
}

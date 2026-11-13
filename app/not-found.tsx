import type { Metadata } from "next";
import { ErrorScreen } from "@/components/ui/error-screen";

export const metadata: Metadata = { title: "Page not found · Solverr" };

export default function NotFound() {
  return (
    <ErrorScreen
      fullPage
      title="This page does not exist"
      message="The link may be wrong or out of date. Check the address, or go back to the home page."
      link={{ href: "/", label: "Go to the home page" }}
    />
  );
}

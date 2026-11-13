import { ErrorScreen } from "@/components/ui/error-screen";

/** Shown inside the dashboard shell when a payment or transfer page calls `notFound()`: the record does not exist or belongs to another business. */
export default function DashboardNotFound() {
  return (
    <ErrorScreen
      title="This page does not exist"
      message="It may have been removed, or it belongs to another business. Go back to the dashboard to find what you need."
      link={{ href: "/dashboard", label: "Go to the dashboard" }}
    />
  );
}

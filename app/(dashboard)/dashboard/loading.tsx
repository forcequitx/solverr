import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown while any dashboard page loads: the header card and placeholder cards sized like the Overview page's first rows. */
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex animate-fade-in flex-col gap-4 sm:gap-5">
      <Card className="flex flex-col gap-4 px-5 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-40" />
        </div>
      </Card>
      <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {[0, 1].map((card) => (
          <Card key={card} className="flex h-[465px] flex-col gap-5 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
            </div>
            <Skeleton className="h-10 w-36" />
            <Skeleton className="w-full flex-1 rounded-[14px]" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <Card key={card} className="flex h-[150px] flex-col justify-between p-4 sm:p-5">
            <Skeleton className="size-9" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-20" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

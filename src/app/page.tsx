import { DashboardSummary } from "../modules/analytics/ui/dashboard-summary";
import { dashboardCopy } from "../modules/analytics/ui/dashboard-copy";

export default function HomePage() {
  return (
    <section
      aria-labelledby="dashboard-title"
      className="flex w-full max-w-5xl min-w-0 flex-col gap-6"
    >
      <header className="flex w-full max-w-full min-w-0 flex-col gap-2">
        <h1
          className="text-heading-sm text-text font-medium"
          id="dashboard-title"
        >
          {dashboardCopy.title}
        </h1>
        <p className="text-body text-text-muted max-w-xl">
          {dashboardCopy.description}
        </p>
      </header>
      <DashboardSummary />
    </section>
  );
}

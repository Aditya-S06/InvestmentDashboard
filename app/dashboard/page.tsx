import { DashboardClient } from './_components/dashboard-client';
import { QuotesProvider } from './_components/quotes-provider';

export default function DashboardPage() {
  return (
    <QuotesProvider>
      <DashboardClient />
    </QuotesProvider>
  );
}

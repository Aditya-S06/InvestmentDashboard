import { DashboardNav } from './_components/dashboard-nav';
import { WatchlistProvider } from './_components/watchlist-provider';
import { TradeTicketProvider } from './_components/trade-ticket-provider';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!(await getServerSession(authOptions))?.user) redirect('/login');
  return (
    <WatchlistProvider>
      <TradeTicketProvider>
        <div className="flex h-screen flex-col overflow-hidden bg-background">
          <DashboardNav />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </TradeTicketProvider>
    </WatchlistProvider>
  );
}

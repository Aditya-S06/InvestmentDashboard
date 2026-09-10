import { DeskLaunchForm } from './_components/desk-launch-form';
import { DeskRecentRuns } from './_components/desk-recent-runs';

export default function TradingDeskPage() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Trading Desk</h1>
      <DeskLaunchForm />
      <DeskRecentRuns />
      <p className="text-xs text-muted-foreground">Simulated research desk. Not an order. Not advice.</p>
    </main>
  );
}

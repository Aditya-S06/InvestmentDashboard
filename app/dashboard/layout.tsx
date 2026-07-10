import { DashboardProvider } from './_components/dashboard-provider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardProvider>{children}</DashboardProvider>;
}

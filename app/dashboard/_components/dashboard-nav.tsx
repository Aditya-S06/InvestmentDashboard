'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  Activity,
  BookOpenCheck,
  Briefcase,
  LayoutGrid,
  LogOut,
  Sparkles,
  WalletCards,
  Youtube,
} from 'lucide-react';
import { useBrokerAccess } from './use-broker-access';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { href: '/dashboard/insights', label: 'Insights', icon: Sparkles },
  { href: '/dashboard/youtube-analysis', label: 'YouTube', icon: Youtube },
  { href: '/dashboard/paper', label: 'Simulate', icon: WalletCards },
  { href: '/dashboard/journal', label: 'Journal', icon: BookOpenCheck },
];

const BROKER_LINK = { href: '/dashboard/webull', label: 'Broker', icon: Briefcase };

export function DashboardNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const broker = useBrokerAccess();

  const links = broker.available ? [...LINKS, BROKER_LINK] : LINKS;

  return (
    <nav className="z-[60] shrink-0 border-b border-border bg-card/95 backdrop-blur-sm">
      <div className="flex items-center gap-1 overflow-x-auto px-3 py-1.5">
        <span className="mr-2 flex shrink-0 items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-[#00c853]/10 border border-[#00c853]/30">
            <Activity className="h-3.5 w-3.5 text-[#00c853]" />
          </span>
          <span className="hidden font-display text-sm font-bold tracking-tight sm:block">Market Intel</span>
        </span>

        {links.map(({ href, label, icon: Icon }) => {
          const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-[#00c853]/15 text-[#00c853]'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}

        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          <span className="hidden text-xs text-muted-foreground sm:block">
            {session?.user?.name || session?.user?.email}
          </span>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </nav>
  );
}

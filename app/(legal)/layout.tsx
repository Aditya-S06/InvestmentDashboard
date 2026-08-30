import Link from 'next/link';
import { Activity } from 'lucide-react';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-2xl py-8">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link href="/login" className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#00c853]/30 bg-[#00c853]/10">
              <Activity className="h-5 w-5 text-[#00c853]" />
            </div>
            <span className="font-display text-2xl font-bold tracking-tight text-foreground">Market Intel</span>
          </Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Back to sign in
          </Link>
        </header>

        <div
          className="rounded-lg border border-border bg-card p-6 sm:p-8"
          style={{ boxShadow: 'var(--shadow-lg)' }}
        >
          {children}
        </div>

        <p className="mt-6 text-center text-[10px] text-muted-foreground opacity-60">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          {' · '}
          <Link href="/terms" className="hover:text-foreground">
            Terms of Use
          </Link>
        </p>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy · Market Intel',
  description: 'How this personal portfolio dashboard handles account and usage data.',
};

const ISSUES_URL = 'https://github.com/Aditya-S06/InvestmentDashboard/issues';

export default function PrivacyPage() {
  return (
    <article className="space-y-5 text-sm leading-relaxed text-muted-foreground">
      <div>
        <h1 className="font-display text-xl font-bold text-foreground">Privacy Policy</h1>
        <p className="mt-1 text-xs">Last updated August 29, 2026. This is not legal advice.</p>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Who this is</h2>
        <p>
          Market Intel is a personal portfolio project by the operator of the{' '}
          <a
            href="https://github.com/Aditya-S06/InvestmentDashboard"
            className="text-[#00c853] hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Aditya-S06/InvestmentDashboard
          </a>{' '}
          repository. It is not a company product, a brokerage, or a bank. There is no privacy
          team and no certification behind this page.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">What is collected</h2>
        <p>If you create an account, the app stores:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Email address and optional name</li>
          <li>A hashed password (not the password itself)</li>
          <li>Watchlist tickers you add</li>
          <li>Paper-trading and journal records you enter</li>
          <li>Optional API keys you save in settings (stored in the database)</li>
          <li>A session cookie so you stay signed in</li>
          <li>Ordinary server logs (paths, errors; may include an IP address)</li>
        </ul>
        <p>
          Optional features, if the operator turns them on, can also store Insights chat
          sessions, YouTube video summaries, and admin broker/order records.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Why</h2>
        <p>
          That data exists so the dashboard can sign you in and show your lists, notes, and
          (when enabled) optional AI or broker tools. There is no advertising profile and no
          third-party analytics SDK on these pages.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Sale of data</h2>
        <p>Data is not sold. There is no ad network and no data-broker relationship.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Third parties actually used</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Postgres hosting (typically Supabase) for accounts and app data</li>
          <li>Yahoo Finance, via the yfinance library, for market quotes and related data</li>
          <li>OpenRouter, only if Insights is configured</li>
          <li>YouTube Data API, only if video analysis is configured</li>
          <li>Webull OpenAPI, only if the operator enables the admin broker features</li>
        </ul>
        <p>
          Whoever deploys this app also sees what their host logs. That depends on where the
          operator runs it, not on a single vendor baked into the project.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Deletion and contact</h2>
        <p>
          There is no in-app account-deletion button. To ask that your account and stored data
          be removed, open a GitHub issue on{' '}
          <a href={ISSUES_URL} className="text-[#00c853] hover:underline" target="_blank" rel="noreferrer">
            Aditya-S06/InvestmentDashboard
          </a>{' '}
          and say which email the account uses. The operator will delete what they can from the
          running database. Backups and host logs may linger for a while.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">This may change or shut down</h2>
        <p>
          This is a personal project. Features can change, and the hosted instance can go away
          without notice. If it shuts down, stored data may be deleted with it.
        </p>
      </section>

      <p className="text-xs">
        See also the <Link href="/terms" className="text-[#00c853] hover:underline">Terms of Use</Link>.
      </p>
    </article>
  );
}

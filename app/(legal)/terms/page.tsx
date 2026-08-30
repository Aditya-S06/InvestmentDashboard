import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Use · Market Intel',
  description: 'Terms for using this personal portfolio market dashboard.',
};

const ISSUES_URL = 'https://github.com/Aditya-S06/InvestmentDashboard/issues';

export default function TermsPage() {
  return (
    <article className="space-y-5 text-sm leading-relaxed text-muted-foreground">
      <div>
        <h1 className="font-display text-xl font-bold text-foreground">Terms of Use</h1>
        <p className="mt-1 text-xs">Last updated August 29, 2026. This is not legal advice.</p>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Personal project, as-is</h2>
        <p>
          Market Intel is a personal portfolio dashboard, not a licensed brokerage, advisor, or
          bank. It is provided as-is, with no warranty that it will be accurate, available, or
          fit for any purpose. Charts, indicators, and AI text are tools for looking at public
          market data — they are not investment advice, and nothing here is a prediction or a
          guarantee.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Acceptable use</h2>
        <p>Do not use this app to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Attack, scrape, or overload the service or its data providers</li>
          <li>Break the law or store illegal content</li>
          <li>Try to access someone else’s account or data</li>
          <li>Circumvent signup gates, rate limits, or admin-only broker tools</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Accounts</h2>
        <p>
          Accounts may be refused or removed at any time, including if signup is disabled, if
          the project is shut down, or if use looks abusive. You are responsible for keeping
          your password to yourself.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Limitation of liability</h2>
        <p>
          To the extent the law allows, the operator is not liable for lost money, missed
          trades, downtime, bad data from third parties, or anything else that happens because
          you used this project. If you cannot accept that, do not use the app.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Contact</h2>
        <p>
          Questions, problems, and data-deletion requests go to GitHub issues on{' '}
          <a href={ISSUES_URL} className="text-[#00c853] hover:underline" target="_blank" rel="noreferrer">
            Aditya-S06/InvestmentDashboard
          </a>
          . There is no support desk.
        </p>
      </section>

      <p className="text-xs">
        See also the <Link href="/privacy" className="text-[#00c853] hover:underline">Privacy Policy</Link>.
      </p>
    </article>
  );
}

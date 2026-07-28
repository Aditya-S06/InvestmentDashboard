import { Suspense } from 'react';
import { PersonalJournalClient } from './_components/personal-journal-client';

export default function JournalPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <PersonalJournalClient />
    </Suspense>
  );
}

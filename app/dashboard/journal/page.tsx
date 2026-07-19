import { Suspense } from 'react';
import { JournalClient } from './_components/journal-client';

export default function JournalPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <JournalClient />
    </Suspense>
  );
}

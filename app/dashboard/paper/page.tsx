import { Suspense } from 'react';
import { PaperClient } from './_components/paper-client';

export default function PaperPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <PaperClient />
    </Suspense>
  );
}

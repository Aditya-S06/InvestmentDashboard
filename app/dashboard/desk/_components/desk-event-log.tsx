'use client';

import { useEffect, useRef } from 'react';

export function DeskEventLog({ lines }: { lines: string[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
      <header className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        Event log
      </header>
      <div className="min-h-[12rem] flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
        {lines.length === 0 ? (
          <p>No events yet.</p>
        ) : (
          lines.map((line, index) => (
            <div key={`${index}-${line.slice(0, 24)}`}>{line}</div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}

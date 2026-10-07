'use client';

import { memo, useEffect, useRef } from 'react';

export const DeskEventLog = memo(function DeskEventLog({ lines, omitted = 0 }: { lines: string[]; omitted?: number }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
      <header className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        Event log
      </header>
      {omitted > 0 && <p className="px-3 pt-2 text-xs text-muted-foreground">
        {omitted} older displayed {omitted === 1 ? 'entry' : 'entries'} omitted. Complete run logs are retained.
      </p>}
      <div className="min-h-[12rem] flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
        {lines.length === 0 ? (
          <p>No events yet.</p>
        ) : (
          lines.map((line, index) => (
            <div key={omitted + index}>{line}</div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
});

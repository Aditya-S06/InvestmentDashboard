'use client';

export function DeskMemoPane({ agent, text }: { agent: string | null; text: string }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
      <header className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        Memo{agent ? ` · ${agent}` : ''}
      </header>
      <div className="min-h-[12rem] flex-1 overflow-auto px-3 py-2">
        {text ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{text}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">Waiting for the first memo.</p>
        )}
      </div>
    </section>
  );
}

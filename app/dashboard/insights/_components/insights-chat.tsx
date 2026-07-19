'use client';

import { Bot, ExternalLink, Loader2, User } from 'lucide-react';
import type { InsightChatMetadata } from '@/lib/insights/types';
import { InsightPickCard } from './insight-pick-card';
import { InsightMarkdown } from './insight-markdown';

export interface InsightUiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: InsightChatMetadata | null;
}

interface InsightsChatProps {
  messages: InsightUiMessage[];
  status: string | null;
  loading: boolean;
  onSelectTicker: (symbol: string) => void;
}

export function InsightsChat({ messages, status, loading, onSelectTicker }: InsightsChatProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {messages.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#00c853]/30 bg-[#00c853]/10">
                <Bot className="h-5 w-5 text-[#00c853]" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">AI Insights</h2>
                <p className="text-sm text-muted-foreground">
                  Research specific tickers or new ideas. Mention your watchlist only when you want it included.
                </p>
              </div>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {message.role === 'assistant' && (
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#00c853]/30 bg-[#00c853]/10">
                <Bot className="h-4 w-4 text-[#00c853]" />
              </div>
            )}

            <div className={`max-w-[85%] ${message.role === 'user' ? 'order-first' : ''}`}>
              <div
                className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'border-[#00c853]/30 bg-[#00c853]/10 text-foreground'
                    : 'border-border bg-card text-foreground'
                }`}
              >
                {message.role === 'assistant' ? (
                  message.content ? (
                    <InsightMarkdown content={message.content} />
                  ) : loading ? (
                    'Researching...'
                  ) : null
                ) : (
                  <div className="space-y-2">
                    {(message.metadata?.images?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {message.metadata?.images?.map((image, index) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={`${message.id}-img-${index}`}
                            src={image.url}
                            alt={image.name || `Attachment ${index + 1}`}
                            className="max-h-40 max-w-full rounded-md border border-border object-contain"
                          />
                        ))}
                      </div>
                    )}
                    {message.content ? <div>{message.content}</div> : null}
                  </div>
                )}
              </div>

              {(message.metadata?.picks?.length ?? 0) > 0 && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {message.metadata?.picks?.map((pick) => (
                    <InsightPickCard key={`${message.id}-${pick.symbol}`} pick={pick} onSelectTicker={onSelectTicker} />
                  ))}
                </div>
              )}

              {(message.metadata?.citations?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.metadata?.citations?.slice(0, 8).map((citation) => (
                    <a
                      key={citation.url}
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      {citation.title || new URL(citation.url).hostname}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {message.role === 'user' && (
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        {(loading || status) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00c853]" />}
            <span>{status ?? 'Working...'}</span>
          </div>
        )}
      </div>
    </div>
  );
}


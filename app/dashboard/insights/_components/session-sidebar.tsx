'use client';

import { ChevronLeft, MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { InsightSessionSummary } from '@/lib/insights/types';

interface SessionSidebarProps {
  open: boolean;
  sessions: InsightSessionSummary[];
  activeSessionId: string | null;
  onNew: () => void;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onCollapse: () => void;
}

export function SessionSidebar({
  open,
  sessions,
  activeSessionId,
  onNew,
  onSelect,
  onDelete,
  onCollapse,
}: SessionSidebarProps) {
  return (
    <aside
      className={`hidden shrink-0 border-r border-border bg-card/60 transition-all duration-300 md:flex md:flex-col ${
        open ? 'w-72' : 'w-0 overflow-hidden border-r-0'
      }`}
    >
      <div className="flex min-w-[18rem] flex-col">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <button
            type="button"
            onClick={onNew}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm transition-colors hover:bg-secondary/70"
          >
            <Plus className="h-4 w-4" />
            New research chat
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="Hide chat history"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center text-xs text-muted-foreground">
              <MessageSquare className="mb-2 h-5 w-5 opacity-40" />
              No insight chats yet.
            </div>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                    activeSessionId === session.id
                      ? 'bg-[#00c853]/10 text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60'
                  }`}
                >
                  <button type="button" onClick={() => onSelect(session.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate">{session.title}</div>
                    <div className="mt-0.5 text-[10px] opacity-70">{new Date(session.updatedAt).toLocaleString()}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(session.id)}
                    className="rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title="Delete chat"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

'use client';

import { DESK_ANALYSTS, type DeskAnalyst, type DeskRunStatus } from '@/lib/desk/types';

const PHASES = [
  { id: 'analysts', label: 'Analysts' },
  { id: 'debate', label: 'Debate' },
  { id: 'research_manager', label: 'Research Manager' },
  { id: 'trader', label: 'Trader' },
  { id: 'risk', label: 'Risk' },
  { id: 'portfolio_manager', label: 'Portfolio Manager' },
] as const;

type PhaseId = (typeof PHASES)[number]['id'];

const ANALYST_LABEL: Record<DeskAnalyst, string> = {
  market: 'Market',
  social: 'Social',
  news: 'News',
  fundamentals: 'Fundamentals',
};

const RISK_ROLES = [
  { id: 'risky', label: 'Risky' },
  { id: 'safe', label: 'Safe' },
  { id: 'neutral', label: 'Neutral' },
] as const;

export type DeskAgentStatus = 'idle' | 'running' | 'done';

export type DeskRunTimelineProps = {
  analysts: DeskAnalyst[];
  phase: string | null;
  agentStatus: Record<string, DeskAgentStatus>;
  debateRound: number | null;
  debateSide: string | null;
  runStatus: DeskRunStatus;
};

function isPhaseId(value: string): value is PhaseId {
  switch (value) {
    case 'analysts':
    case 'debate':
    case 'research_manager':
    case 'trader':
    case 'risk':
    case 'portfolio_manager':
      return true;
    default:
      return false;
  }
}

function phaseTone(
  id: PhaseId,
  current: string | null,
  runStatus: DeskRunStatus,
): 'pending' | 'active' | 'done' {
  const order = PHASES.map((phase) => phase.id);
  const currentId = current && isPhaseId(current) ? current : null;
  const i = order.indexOf(id);
  const c = currentId ? order.indexOf(currentId) : -1;
  const terminalDone = runStatus === 'completed' || runStatus === 'review';
  if (terminalDone) return 'done';
  if (c < 0) return 'pending';
  if (i < c) return 'done';
  if (i === c) return runStatus === 'failed' || runStatus === 'cancelled' ? 'done' : 'active';
  return 'pending';
}

function chipClass(status: DeskAgentStatus, activePhase: boolean) {
  switch (status) {
    case 'running':
      return 'border-[#00c853]/40 bg-[#00c853]/15 text-[#00c853]';
    case 'done':
      return 'border-border bg-secondary text-foreground';
    case 'idle':
      return activePhase
        ? 'border-border text-muted-foreground'
        : 'border-transparent text-muted-foreground/70';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function DeskRunTimeline({
  analysts,
  phase,
  agentStatus,
  debateRound,
  debateSide,
  runStatus,
}: DeskRunTimelineProps) {
  const selected = DESK_ANALYSTS.filter((analyst) => analysts.includes(analyst));

  return (
    <ol className="space-y-2 rounded-lg border border-border bg-card p-4">
      {PHASES.map((item) => {
        const tone = phaseTone(item.id, phase, runStatus);
        return (
          <li key={item.id} className="flex flex-wrap items-center gap-2">
            <span
              className={`w-40 shrink-0 text-xs font-medium ${
                tone === 'active' ? 'text-[#00c853]' : tone === 'done' ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {item.label}
            </span>
            {item.id === 'analysts' &&
              selected.map((analyst) => {
                const status = agentStatus[analyst] ?? 'idle';
                return (
                  <span
                    key={analyst}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${chipClass(status, tone === 'active')}`}
                  >
                    {ANALYST_LABEL[analyst]}
                  </span>
                );
              })}
            {item.id === 'debate' && (
              <span className="text-[11px] text-muted-foreground">
                {debateRound != null ? `Round ${debateRound}${debateSide ? ` · ${debateSide}` : ''}` : '—'}
              </span>
            )}
            {item.id === 'risk' &&
              RISK_ROLES.map((role) => {
                const status = agentStatus[role.id] ?? 'idle';
                return (
                  <span
                    key={role.id}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${chipClass(status, tone === 'active')}`}
                  >
                    {role.label}
                  </span>
                );
              })}
          </li>
        );
      })}
    </ol>
  );
}

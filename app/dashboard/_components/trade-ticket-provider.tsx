'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { TradeTicket } from './trade-ticket';
import { useBrokerAccess } from './use-broker-access';

export type TradeTicketDraft = {
  symbol: string;
  side: 'BUY' | 'SELL' | 'SHORT';
  source: 'grid' | 'watchlist' | 'detail' | 'insights' | 'youtube' | 'broker' | 'journal';
  thesis?: string;
  invalidation?: string;
  setupTag?: string;
  strategyTag?: string;
  preNotes?: string;
  suggestedStop?: number;
  suggestedTarget?: number;
  suggestedQty?: number;
  sourceUrl?: string;
  lastPrice?: number;
};

type Ctx = {
  openTradeTicket: (draft: TradeTicketDraft) => void;
  closeTradeTicket: () => void;
  draft: TradeTicketDraft | null;
};

const TradeTicketContext = createContext<Ctx | null>(null);

export function TradeTicketProvider({ children }: { children: ReactNode }) {
  const broker = useBrokerAccess();
  const [draft, setDraft] = useState<TradeTicketDraft | null>(null);

  const openTradeTicket = useCallback((next: TradeTicketDraft) => {
    setDraft(next);
    try {
      sessionStorage.setItem('oracle.webullTradeDraft', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const closeTradeTicket = useCallback(() => setDraft(null), []);

  // A null context hides every Trade button for non-admins and unconfigured desks.
  const value = useMemo(
    () => (broker.available ? { openTradeTicket, closeTradeTicket, draft } : null),
    [broker.available, openTradeTicket, closeTradeTicket, draft],
  );

  return (
    <TradeTicketContext.Provider value={value}>
      {children}
      {draft ? <TradeTicket draft={draft} onClose={closeTradeTicket} /> : null}
    </TradeTicketContext.Provider>
  );
}

export function useTradeTicket() {
  const ctx = useContext(TradeTicketContext);
  if (!ctx) throw new Error('useTradeTicket must be used within TradeTicketProvider');
  return ctx;
}

export function useTradeTicketOptional() {
  return useContext(TradeTicketContext);
}

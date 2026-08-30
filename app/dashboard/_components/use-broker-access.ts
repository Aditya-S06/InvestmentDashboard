'use client';

import { useEffect, useState } from 'react';

export type BrokerAccess = {
  /** True only when /api/broker/status returns 200 with a configured broker. */
  available: boolean;
  environment: string;
  loading: boolean;
};

const UNAVAILABLE = { available: false, environment: '' };

// Shared across components so the whole dashboard costs one status request.
let statusPromise: Promise<{ available: boolean; environment: string }> | null = null;

function loadStatus() {
  if (!statusPromise) {
    statusPromise = fetch('/api/broker/status', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return UNAVAILABLE;
        const data = await res.json();
        return {
          available: Boolean(data?.configured),
          environment: String(data?.environment ?? ''),
        };
      })
      .catch(() => UNAVAILABLE);
  }
  return statusPromise;
}

/** Non-admins get 403 here, so this doubles as the gate for all Webull UI. */
export function useBrokerAccess(): BrokerAccess {
  const [state, setState] = useState<BrokerAccess>({ ...UNAVAILABLE, loading: true });

  useEffect(() => {
    let active = true;
    loadStatus().then((status) => {
      if (active) setState({ ...status, loading: false });
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';

interface SearchResult {
  symbol: string;
  name: string;
}

export function TickerSearch({ onSelectTicker }: { onSelectTicker: (symbol: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef?.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef?.current && !inputRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (value: string) => {
    setQuery(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (value?.trim()?.length < 1) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    timeoutRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(value)}`);
        if (res.ok) {
          const data = await res.json();
          // Deduplicate
          const seen = new Set<string>();
          const unique = (data ?? []).filter((r: SearchResult) => {
            if (seen.has(r?.symbol)) return false;
            seen.add(r?.symbol);
            return true;
          });
          setResults(unique);
          setShowDropdown(true);
        }
      } catch { /* ignore */ }
      setLoading(false);
    }, 300);
  };

  const handleSelect = (symbol: string) => {
    onSelectTicker(symbol);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query?.trim()) {
      handleSelect(query.trim().toUpperCase());
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if ((results?.length ?? 0) > 0) setShowDropdown(true); }}
          placeholder="Search ticker symbol (e.g., AAPL, MSFT)..."
          className="w-full pl-9 pr-10 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00c853] focus:border-[#00c853]"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />}
      </div>

      {showDropdown && (results?.length ?? 0) > 0 && (
        <div ref={dropdownRef} className="absolute top-full mt-1 w-full bg-card border border-border rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
          {(results ?? []).map((r: SearchResult, i: number) => (
            <button
              key={`${r?.symbol}-${i}`}
              onClick={() => handleSelect(r?.symbol)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary text-left transition-colors"
            >
              <div>
                <span className="font-mono font-semibold text-sm text-[#00c853]">{r?.symbol}</span>
                <span className="text-xs text-muted-foreground ml-2">{r?.name}</span>
              </div>
              <Plus className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

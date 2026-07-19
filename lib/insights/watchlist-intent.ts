/**
 * Detect whether the user explicitly asked to use / research their watchlist.
 * Default behavior is OFF — researching a new ticker must not scan the watchlist.
 */
const EXPLICIT_WATCHLIST_REQUEST: RegExp[] = [
  /\bgo\s+through\s+(my\s+)?watch\s*list\b/i,
  /\breview\s+(my\s+)?watch\s*list\b/i,
  /\banalyz(?:e|ing)\s+(my\s+)?watch\s*list\b/i,
  /\bcheck\s+(my\s+)?watch\s*list\b/i,
  /\blook\s+at\s+(my\s+)?watch\s*list\b/i,
  /\bscan\s+(my\s+)?watch\s*list\b/i,
  /\bfrom\s+my\s+watch\s*list\b/i,
  /\bin\s+my\s+watch\s*list\b/i,
  /\bon\s+my\s+watch\s*list\b/i,
  /\bmy\s+watch\s*lists?\b/i,
  /\bwatch\s*list\s+(stocks?|tickers?|names?|holdings?)\b/i,
  /\bmy\s+holdings?\b/i,
  /\bmy\s+portfolio\b/i,
  /\bstocks?\s+i\s+(own|hold|follow|watch)\b/i,
  /\btickers?\s+i\s+(own|hold|follow|watch)\b/i,
];

/** Mentions that clarify a ticker is NOT on the watchlist should not unlock watchlist research. */
const WATCHLIST_NEGATION: RegExp[] = [
  /\bnot\s+in\s+(my\s+)?watch\s*list\b/i,
  /\bisn'?t\s+in\s+(my\s+)?watch\s*list\b/i,
  /\bnot\s+on\s+(my\s+)?watch\s*list\b/i,
  /\bisn'?t\s+on\s+(my\s+)?watch\s*list\b/i,
  /\boutside\s+(of\s+)?(my\s+)?watch\s*list\b/i,
];

export function userRequestsWatchlist(...texts: Array<string | null | undefined>): boolean {
  return texts.some((text) => {
    if (!text?.trim()) return false;
    if (WATCHLIST_NEGATION.some((pattern) => pattern.test(text))) {
      // Still allow if they also make an explicit review request in the same message.
      const withoutNegation = text
        .replace(/\bnot\s+in\s+(my\s+)?watch\s*list\b/gi, ' ')
        .replace(/\bisn'?t\s+in\s+(my\s+)?watch\s*list\b/gi, ' ')
        .replace(/\bnot\s+on\s+(my\s+)?watch\s*list\b/gi, ' ')
        .replace(/\bisn'?t\s+on\s+(my\s+)?watch\s*list\b/gi, ' ')
        .replace(/\boutside\s+(of\s+)?(my\s+)?watch\s*list\b/gi, ' ');
      return EXPLICIT_WATCHLIST_REQUEST.some((pattern) => pattern.test(withoutNegation));
    }
    return EXPLICIT_WATCHLIST_REQUEST.some((pattern) => pattern.test(text));
  });
}

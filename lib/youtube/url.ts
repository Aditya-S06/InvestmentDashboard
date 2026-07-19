/** Extract an 11-char YouTube video id from a URL or bare id. */
export function parseYoutubeVideoId(urlOrId: string): string | null {
  const s = (urlOrId || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^#]*&)?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
  ];
  for (const pat of patterns) {
    const m = s.match(pat);
    if (m?.[1]) return m[1];
  }
  return null;
}

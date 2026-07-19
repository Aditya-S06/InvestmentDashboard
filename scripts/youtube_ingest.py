#!/usr/bin/env python3
"""YouTube channel monitoring + transcript summarization for financial research.

Stdout is always JSON. Logs go to stderr.
Env: YOUTUBE_API_KEY, OPENROUTER_API_KEY, YOUTUBE_CACHE_DIR,
     YOUTUBE_CHANNELS_FILE, YOUTUBE_POLL_SINCE_DAYS, YOUTUBE_RATE_LIMIT_PER_MIN

CLI:
  python scripts/youtube_ingest.py channel @CNBC 5
  python scripts/youtube_ingest.py channel @CNBC 5 2
  python scripts/youtube_ingest.py poll conf/youtube_channels.json
  python scripts/youtube_ingest.py video VIDEO_ID
  python scripts/youtube_ingest.py list @CNBC 10
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

_PROJECT_ROOT = os.path.dirname(_SCRIPT_DIR)

try:
    from youtube_cache import CHANNEL_TTL_SEC, VIDEO_LIST_TTL_SEC, cached_call
except ImportError:
    CHANNEL_TTL_SEC = 3600.0
    VIDEO_LIST_TTL_SEC = 300.0

    def cached_call(key, ttl_sec, fn):  # type: ignore
        return fn()


# ---------------------------------------------------------------------------
# Env / paths
# ---------------------------------------------------------------------------

def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _cache_dir() -> Path:
    raw = _env("YOUTUBE_CACHE_DIR") or os.path.join(_PROJECT_ROOT, "data")
    path = Path(raw)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _processed_path() -> Path:
    return _cache_dir() / "youtube_processed.json"


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


# ---------------------------------------------------------------------------
# Dedup store (JSON file of processed video_ids)
# ---------------------------------------------------------------------------

def load_processed_ids() -> set:
    path = _processed_path()
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return set(data)
        if isinstance(data, dict):
            return set(data.get("video_ids") or [])
    except Exception as e:
        _log(f"Failed to load processed ids: {e}")
    return set()


def mark_processed(video_id: str) -> None:
    path = _processed_path()
    ids = load_processed_ids()
    ids.add(video_id)
    path.write_text(
        json.dumps({"video_ids": sorted(ids), "updated_at": datetime.now(timezone.utc).isoformat()}, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Retries
# ---------------------------------------------------------------------------

def with_backoff(fn, *, max_retries: int = 3, base_delay: float = 1.0, label: str = "op"):
    """Call fn with exponential backoff on transient errors."""
    last_err: Optional[Exception] = None
    for attempt in range(max_retries):
        try:
            return fn()
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            retryable = any(
                token in msg
                for token in ("403", "429", "quota", "rate", "timeout", "temporarily", "503", "500")
            )
            if not retryable or attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt)
            _log(f"{label} failed (attempt {attempt + 1}/{max_retries}): {e}; retry in {delay:.1f}s")
            time.sleep(delay)
    raise last_err  # type: ignore[misc]


# ---------------------------------------------------------------------------
# YouTube Data API
# ---------------------------------------------------------------------------

def _youtube_service():
    api_key = _env("YOUTUBE_API_KEY")
    if not api_key:
        raise RuntimeError("YOUTUBE_API_KEY not configured")
    try:
        from googleapiclient.discovery import build
    except ImportError as e:
        raise RuntimeError("google-api-python-client not installed") from e
    return build("youtube", "v3", developerKey=api_key, cache_discovery=False)


def parse_video_id(url_or_id: str) -> str:
    """Extract an 11-char YouTube video id from a URL or bare id."""
    s = (url_or_id or "").strip()
    if not s:
        return ""
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    patterns = [
        r"(?:youtube\.com/watch\?(?:[^#]*&)?v=|youtu\.be/|youtube\.com/shorts/|youtube\.com/embed/|youtube\.com/live/)([A-Za-z0-9_-]{11})",
        r"[?&]v=([A-Za-z0-9_-]{11})",
    ]
    for pat in patterns:
        m = re.search(pat, s)
        if m:
            return m.group(1)
    return ""


def normalize_channel_handle(handle_or_id: str) -> str:
    """Normalize to @Handle or UC... id string."""
    s = (handle_or_id or "").strip()
    if not s:
        return s
    # Strip URL forms
    s = re.sub(r"^https?://(www\.)?youtube\.com/", "", s, flags=re.I)
    s = s.strip("/")
    if s.lower().startswith("channel/"):
        s = s.split("/", 1)[1]
    if s.lower().startswith("@"):
        return "@" + s[1:].split("/")[0]
    if s.startswith("UC") and len(s) >= 20:
        return s
    # bare handle without @
    if "/" not in s and " " not in s:
        return "@" + s.lstrip("@")
    return s


def resolve_channel_id(handle_or_id: str) -> Dict[str, str]:
    """Resolve @handle or UC id → {channel_id, handle, title}."""
    key = normalize_channel_handle(handle_or_id)
    cache_key = f"channel:{key.lower()}"

    def _fetch() -> Dict[str, str]:
        yt = _youtube_service()

        def _call():
            if key.startswith("UC"):
                resp = yt.channels().list(part="snippet,contentDetails", id=key).execute()
            else:
                handle = key.lstrip("@")
                resp = yt.channels().list(part="snippet,contentDetails", forHandle=handle).execute()
                if not resp.get("items"):
                    # Fallback: search
                    search = yt.search().list(part="snippet", q=key, type="channel", maxResults=1).execute()
                    items = search.get("items") or []
                    if not items:
                        raise RuntimeError(f"Channel not found: {key}")
                    cid = items[0]["snippet"]["channelId"]
                    resp = yt.channels().list(part="snippet,contentDetails", id=cid).execute()
            items = resp.get("items") or []
            if not items:
                raise RuntimeError(f"Channel not found: {key}")
            item = items[0]
            snippet = item.get("snippet") or {}
            custom = snippet.get("customUrl") or key
            if custom and not custom.startswith("@") and not custom.startswith("UC"):
                custom = "@" + custom
            return {
                "channel_id": item["id"],
                "handle": custom if custom.startswith("@") else key,
                "title": snippet.get("title") or key,
                "uploads_playlist": (item.get("contentDetails") or {}).get("relatedPlaylists", {}).get("uploads") or "",
            }

        return with_backoff(_call, label=f"resolve_channel({key})")

    return cached_call(cache_key, CHANNEL_TTL_SEC, _fetch)


def fetch_recent_videos(
    channel_id: str,
    *,
    limit: int = 5,
    since_days: Optional[int] = None,
    uploads_playlist: str = "",
) -> List[Dict[str, Any]]:
    """Fetch recent video metadata for a channel."""
    limit = max(1, min(int(limit or 5), 25))
    cache_key = f"videos:{channel_id}:{limit}:{since_days}"

    def _fetch() -> List[Dict[str, Any]]:
        yt = _youtube_service()
        cutoff: Optional[datetime] = None
        if since_days is not None and since_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=int(since_days))

        results: List[Dict[str, Any]] = []

        def _from_playlist():
            playlist_id = uploads_playlist
            if not playlist_id:
                ch = yt.channels().list(part="contentDetails", id=channel_id).execute()
                items = ch.get("items") or []
                if items:
                    playlist_id = (
                        items[0].get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads") or ""
                    )
            if not playlist_id:
                return []
            resp = (
                yt.playlistItems()
                .list(part="snippet,contentDetails", playlistId=playlist_id, maxResults=min(limit, 50))
                .execute()
            )
            out = []
            for item in resp.get("items") or []:
                sn = item.get("snippet") or {}
                vid = (item.get("contentDetails") or {}).get("videoId") or sn.get("resourceId", {}).get("videoId")
                if not vid:
                    continue
                published = sn.get("publishedAt") or (item.get("contentDetails") or {}).get("videoPublishedAt")
                out.append(
                    {
                        "video_id": vid,
                        "title": sn.get("title") or "",
                        "description": sn.get("description") or "",
                        "published_at": published or "",
                        "channel_id": channel_id,
                        "channel_title": sn.get("channelTitle") or "",
                        "url": f"https://www.youtube.com/watch?v={vid}",
                    }
                )
            return out

        def _from_search():
            kwargs: Dict[str, Any] = {
                "part": "snippet",
                "channelId": channel_id,
                "order": "date",
                "type": "video",
                "maxResults": min(limit, 25),
            }
            if cutoff is not None:
                kwargs["publishedAfter"] = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
            resp = yt.search().list(**kwargs).execute()
            out = []
            for item in resp.get("items") or []:
                sn = item.get("snippet") or {}
                vid = (item.get("id") or {}).get("videoId")
                if not vid:
                    continue
                out.append(
                    {
                        "video_id": vid,
                        "title": sn.get("title") or "",
                        "description": sn.get("description") or "",
                        "published_at": sn.get("publishedAt") or "",
                        "channel_id": channel_id,
                        "channel_title": sn.get("channelTitle") or "",
                        "url": f"https://www.youtube.com/watch?v={vid}",
                    }
                )
            return out

        def _call():
            try:
                items = _from_playlist()
            except Exception as e:
                _log(f"playlistItems failed, falling back to search: {e}")
                items = []
            if not items:
                items = _from_search()
            # Enrich descriptions via videos.list if truncated
            video_ids = [v["video_id"] for v in items[:limit]]
            if video_ids:
                detail = yt.videos().list(part="snippet", id=",".join(video_ids)).execute()
                by_id = {d["id"]: d.get("snippet") or {} for d in (detail.get("items") or [])}
                for v in items:
                    sn = by_id.get(v["video_id"])
                    if sn:
                        v["title"] = sn.get("title") or v["title"]
                        v["description"] = sn.get("description") or v["description"]
                        v["published_at"] = sn.get("publishedAt") or v["published_at"]
                        v["channel_title"] = sn.get("channelTitle") or v["channel_title"]
            return items

        items = with_backoff(_call, label=f"fetch_videos({channel_id})")
        filtered = []
        for v in items:
            if cutoff is not None and v.get("published_at"):
                try:
                    pub = datetime.fromisoformat(v["published_at"].replace("Z", "+00:00"))
                    if pub < cutoff:
                        continue
                except Exception:
                    pass
            filtered.append(v)
            if len(filtered) >= limit:
                break
        return filtered

    return cached_call(cache_key, VIDEO_LIST_TTL_SEC, _fetch)


def fetch_video_meta(video_id: str) -> Dict[str, Any]:
    """Fetch metadata for a single video id."""
    yt = _youtube_service()

    def _call():
        resp = yt.videos().list(part="snippet", id=video_id).execute()
        items = resp.get("items") or []
        if not items:
            raise RuntimeError(f"Video not found: {video_id}")
        sn = items[0].get("snippet") or {}
        return {
            "video_id": video_id,
            "title": sn.get("title") or "",
            "description": sn.get("description") or "",
            "published_at": sn.get("publishedAt") or "",
            "channel_id": sn.get("channelId") or "",
            "channel_title": sn.get("channelTitle") or "",
            "url": f"https://www.youtube.com/watch?v={video_id}",
        }

    return with_backoff(_call, label=f"fetch_video({video_id})")


# ---------------------------------------------------------------------------
# Transcript extraction
# ---------------------------------------------------------------------------

def extract_transcript_youtube_api(video_id: str) -> Optional[str]:
    """Primary: youtube-transcript-api."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        _log("youtube-transcript-api not installed")
        return None

    try:
        # Newer API (0.6+)
        if hasattr(YouTubeTranscriptApi, "get_transcript"):
            entries = YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "en-US", "en-GB"])
        else:
            api = YouTubeTranscriptApi()
            transcript_list = api.list(video_id)
            try:
                transcript = transcript_list.find_transcript(["en", "en-US", "en-GB"])
            except Exception:
                transcript = transcript_list.find_generated_transcript(["en"])
            entries = transcript.fetch()
        parts = []
        for entry in entries:
            if isinstance(entry, dict):
                parts.append(entry.get("text") or "")
            else:
                parts.append(getattr(entry, "text", "") or "")
        text = " ".join(p.strip() for p in parts if p and p.strip())
        return text or None
    except Exception as e:
        _log(f"youtube-transcript-api failed for {video_id}: {e}")
        return None


def extract_transcript_ytdlp(video_id: str) -> Optional[str]:
    """Fallback: yt-dlp auto-subs."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            outtmpl = os.path.join(tmp, "sub")
            cmd = [
                sys.executable,
                "-m",
                "yt_dlp",
                "--skip-download",
                "--write-auto-sub",
                "--sub-lang",
                "en",
                "--sub-format",
                "vtt/best",
                "-o",
                outtmpl,
                url,
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
            if proc.returncode != 0:
                _log(f"yt-dlp failed for {video_id}: {proc.stderr[:300]}")
                return None
            # Find .vtt / .srt
            for name in os.listdir(tmp):
                if name.endswith((".vtt", ".srt")):
                    raw = Path(tmp, name).read_text(encoding="utf-8", errors="ignore")
                    return _strip_vtt(raw)
    except FileNotFoundError:
        _log("yt-dlp not available")
    except Exception as e:
        _log(f"yt-dlp fallback failed for {video_id}: {e}")
    return None


def _strip_vtt(raw: str) -> str:
    """Strip VTT/SRT timing lines to plain text."""
    lines = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("WEBVTT") or line.startswith("NOTE"):
            continue
        if re.match(r"^\d+$", line):
            continue
        if "-->" in line:
            continue
        # Remove simple tags
        line = re.sub(r"<[^>]+>", "", line)
        lines.append(line)
    return " ".join(lines)


def extract_transcript(video_id: str) -> Tuple[str, str]:
    """Return (transcript_text, source). Empty string if unavailable."""
    text = extract_transcript_youtube_api(video_id)
    if text:
        return text, "youtube_transcript_api"
    text = extract_transcript_ytdlp(video_id)
    if text:
        return text, "yt-dlp"
    return "", "none"


# ---------------------------------------------------------------------------
# Summarization (pure helpers — unit-testable)
# ---------------------------------------------------------------------------

SUMMARY_SCHEMA_HINT = """{
  "key_thesis": "string — main investment thesis of the video",
  "signals": ["string — bullish/bearish claims with specificity"],
  "risks": ["string"],
  "timestamped_highlights": ["MM:SS - claim"],
  "stock_mentions": ["AAPL", "NVDA"],
  "macro_relevance": "string — ties to VIX, yields, Fed, etc.",
  "confidence": "high" | "medium" | "low"
}"""

TRANSCRIPT_MAX_CHARS = 8000


def build_summary_prompt(title: str, description: str, transcript: str, *, has_transcript: bool) -> str:
    """Build a token-efficient summarization prompt for quantitative research."""
    body = (transcript or "")[:TRANSCRIPT_MAX_CHARS]
    if not has_transcript:
        body = f"(No transcript available. Use title + description only.)\n\nDescription:\n{(description or '')[:1500]}"
    else:
        body = f"Transcript (truncated):\n{body}"

    return f"""You are a quantitative equity research assistant. Summarize this financial YouTube video for an automated trading dashboard.

Rules:
- Extract actionable claims only (tickers, levels, catalysts, macro links).
- Prefer specificity over fluff. Do not invent numbers not present in the source.
- stock_mentions: uppercase US equity tickers only (e.g. AAPL, NVDA). Omit ETFs unless explicitly actionable.
- confidence: "high" only if transcript is rich and claims are concrete; "low" if summarizing from title/description alone.
- Return ONLY valid JSON matching this schema (no markdown fences):
{SUMMARY_SCHEMA_HINT}

Title: {title}
{body}
"""


def parse_summary_json(raw: str) -> Dict[str, Any]:
    """Parse LLM JSON into the required summary schema with safe defaults."""
    text = (raw or "").strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    data: Dict[str, Any] = {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Try to extract first {...} block
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                data = json.loads(match.group(0))
            except json.JSONDecodeError:
                data = {}

    if not isinstance(data, dict):
        data = {}

    confidence = str(data.get("confidence") or "low").lower()
    if confidence not in ("high", "medium", "low"):
        confidence = "low"

    stock_mentions = data.get("stock_mentions") or []
    if not isinstance(stock_mentions, list):
        stock_mentions = []
    cleaned_tickers = []
    for t in stock_mentions:
        sym = re.sub(r"[^A-Za-z.]", "", str(t)).upper()
        if 1 <= len(sym) <= 5:
            cleaned_tickers.append(sym)

    def _str_list(val: Any) -> List[str]:
        if not isinstance(val, list):
            return []
        return [str(x).strip() for x in val if str(x).strip()]

    return {
        "key_thesis": str(data.get("key_thesis") or "Unable to extract a clear thesis.").strip(),
        "signals": _str_list(data.get("signals")),
        "risks": _str_list(data.get("risks")),
        "timestamped_highlights": _str_list(data.get("timestamped_highlights")),
        "stock_mentions": cleaned_tickers,
        "macro_relevance": str(data.get("macro_relevance") or "").strip(),
        "confidence": confidence,
    }


def summarize_with_openrouter(prompt: str) -> Dict[str, Any]:
    """Call OpenRouter chat completions; return parsed summary dict."""
    api_key = _env("OPENROUTER_API_KEY")
    if not api_key:
        return parse_summary_json(
            json.dumps(
                {
                    "key_thesis": "Summarization skipped — OPENROUTER_API_KEY not configured.",
                    "signals": [],
                    "risks": ["No LLM key available"],
                    "timestamped_highlights": [],
                    "stock_mentions": [],
                    "macro_relevance": "",
                    "confidence": "low",
                }
            )
        )

    try:
        import httpx
    except ImportError as e:
        raise RuntimeError("httpx not installed") from e

    primary = _env("YOUTUBE_SUMMARY_MODEL") or "deepseek/deepseek-chat"
    fallbacks = [
        primary,
        "deepseek/deepseek-chat",
        "openai/gpt-4o-mini",
        "google/gemini-2.0-flash-001",
    ]
    # de-dupe while preserving order
    models: List[str] = []
    for m in fallbacks:
        if m and m not in models:
            models.append(m)

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Aditya-S06/InvestmentDashboard",
        "X-Title": "Market Intel YouTube Ingest",
    }

    def _extract_content(body: Dict[str, Any]) -> str:
        choice = (body.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        content = message.get("content")
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, str):
                    parts.append(part)
                elif isinstance(part, dict):
                    parts.append(str(part.get("text") or part.get("content") or ""))
            content = "\n".join(p for p in parts if p)
        if not content:
            # Some reasoning models put text elsewhere
            content = (
                message.get("reasoning")
                or message.get("reasoning_content")
                or choice.get("text")
                or ""
            )
        return str(content or "").strip()

    last_err: Optional[Exception] = None
    for model in models:
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a financial research summarizer. "
                        "Respond with a single JSON object only (no markdown fences). "
                        "Always include key_thesis as a non-empty string."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "max_tokens": 1600,
        }

        def _call(current_model: str = model, current_payload: Dict[str, Any] = payload):
            with httpx.Client(timeout=90.0) as client:
                resp = client.post(url, headers=headers, json=current_payload)
                if resp.status_code >= 400:
                    raise RuntimeError(f"openrouter_http_{resp.status_code}: {resp.text[:300]}")
                body = resp.json()
                content = _extract_content(body)
                if not content:
                    raise RuntimeError(f"openrouter_empty_content model={current_model}")
                return content

        try:
            raw = with_backoff(_call, label=f"openrouter_summarize({model})", max_retries=2, base_delay=1.5)
            parsed = parse_summary_json(raw)
            thesis = (parsed.get("key_thesis") or "").strip()
            if thesis and thesis.lower() != "unable to extract a clear thesis.":
                return parsed
            _log(f"Weak thesis from {model}; trying next model if available")
            last_err = RuntimeError(f"weak_thesis from {model}")
        except Exception as e:
            last_err = e
            _log(f"OpenRouter model {model} failed: {e}")
            continue

    if last_err:
        raise last_err
    return parse_summary_json("{}")


def heuristic_summary_from_transcript(title: str, transcript: str) -> Dict[str, Any]:
    """Last-resort extractive summary when the LLM returns nothing usable."""
    text = re.sub(r"\s+", " ", (transcript or "")).strip()
    sentences = re.split(r"(?<=[.!?])\s+", text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 40][:4]
    thesis = " ".join(sentences)[:400] if sentences else f"Transcript captured for: {title}"[:300]

    tickers = re.findall(r"\b([A-Z]{2,5})\b", f"{title} {text[:3000]}")
    stop = {
        "A", "I", "THE", "AND", "OR", "FOR", "TO", "OF", "IN", "ON", "IS", "IT", "AT",
        "BY", "AS", "AN", "BE", "CEO", "CFO", "ETF", "IPO", "GDP", "CPI", "FED", "USA",
        "NEW", "HOW", "WHY", "WHAT", "WITH", "FROM", "THIS", "THAT", "LIVE", "NEWS",
        "STOCK", "STOCKS", "BUY", "SELL", "JUST", "WILL", "HAVE", "BEEN", "THEY",
    }
    mentions: List[str] = []
    for t in tickers:
        if t not in stop and t not in mentions:
            mentions.append(t)
        if len(mentions) >= 8:
            break

    signals = []
    for s in sentences[:3]:
        signals.append(s[:180])

    return {
        "key_thesis": thesis,
        "signals": signals,
        "risks": ["Heuristic summary — LLM did not return structured JSON; verify against source video"],
        "timestamped_highlights": [],
        "stock_mentions": mentions,
        "macro_relevance": "",
        "confidence": "low",
    }


def fallback_summary(title: str, description: str, reason: str) -> Dict[str, Any]:
    """Low-confidence summary from title/description when LLM or transcript fails."""
    tickers = re.findall(r"\b([A-Z]{1,5})\b", f"{title} {description}")
    stop = {
        "A", "I", "THE", "AND", "OR", "FOR", "TO", "OF", "IN", "ON", "IS", "IT", "AT",
        "BY", "AS", "AN", "BE", "CEO", "CFO", "ETF", "IPO", "GDP", "CPI", "FED", "USA",
        "NEW", "HOW", "WHY", "WHAT", "WITH", "FROM", "THIS", "THAT", "LIVE", "NEWS",
    }
    mentions = [t for t in tickers if t not in stop][:10]
    return {
        "key_thesis": f"Limited summary of: {title}"[:300],
        "signals": [],
        "risks": [reason],
        "timestamped_highlights": [],
        "stock_mentions": mentions,
        "macro_relevance": "",
        "confidence": "low",
    }


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def _build_video_record(
    video_meta: Dict[str, Any],
    *,
    channel_handle: str,
    transcript: str,
    source: str,
    summary: Dict[str, Any],
) -> Dict[str, Any]:
    video_id = video_meta.get("video_id") or ""
    description = video_meta.get("description") or ""
    return {
        "video_id": video_id,
        "title": video_meta.get("title") or "",
        "published_at": video_meta.get("published_at") or "",
        "url": video_meta.get("url") or f"https://www.youtube.com/watch?v={video_id}",
        "channel": channel_handle or video_meta.get("channel_title") or "",
        "channel_id": video_meta.get("channel_id") or "",
        "transcript_length": len(transcript or ""),
        "transcript_source": source,
        "summary": summary,
        "raw_transcript_snippet": (transcript or description or "")[:500],
    }


def summarize_from_transcript(
    video_meta: Dict[str, Any],
    transcript: str,
    *,
    channel_handle: str = "",
) -> Dict[str, Any]:
    """Summarize using a caller-supplied transcript (manual paste / failsafe)."""
    video_id = video_meta.get("video_id") or ""
    title = video_meta.get("title") or ""
    description = video_meta.get("description") or ""
    channel = channel_handle or video_meta.get("channel_title") or ""
    text = (transcript or "").strip()
    if not video_id:
        return {"error": "missing_video_id"}
    if len(text) < 40:
        return {"error": "transcript too short (need at least ~40 characters)", "video_id": video_id}

    try:
        prompt = build_summary_prompt(title, description, text, has_transcript=True)
        try:
            summary = summarize_with_openrouter(prompt)
        except Exception as e:
            _log(f"manual summarize failed for {video_id}: {e}")
            summary = heuristic_summary_from_transcript(title, text)
            summary["risks"] = [f"LLM summarization failed: {e}"] + list(summary.get("risks") or [])

        thesis = (summary.get("key_thesis") or "").strip().lower()
        if thesis in ("", "unable to extract a clear thesis."):
            _log(f"Replacing weak thesis with heuristic summary for {video_id}")
            summary = heuristic_summary_from_transcript(title, text)

        record = _build_video_record(
            video_meta,
            channel_handle=channel,
            transcript=text,
            source="manual",
            summary=summary,
        )
        mark_processed(video_id)
        return record
    except Exception as e:
        _log(f"summarize_from_transcript failed for {video_id}: {e}")
        summary = heuristic_summary_from_transcript(title, text)
        summary["risks"] = [str(e)] + list(summary.get("risks") or [])
        return {
            "video_id": video_id,
            "title": title,
            "error": str(e),
            "summary": summary,
            "transcript_length": len(text),
            "raw_transcript_snippet": text[:500],
            "channel": channel,
            "url": video_meta.get("url") or f"https://www.youtube.com/watch?v={video_id}",
            "published_at": video_meta.get("published_at") or "",
            "channel_id": video_meta.get("channel_id") or "",
        }


def process_video(
    video_meta: Dict[str, Any],
    *,
    channel_handle: str = "",
    skip_if_processed: bool = True,
    force: bool = False,
    manual_transcript: Optional[str] = None,
) -> Dict[str, Any]:
    """Orchestrate transcript → summary for one video. Never raises for soft failures."""
    video_id = video_meta.get("video_id") or ""
    if not video_id:
        return {"error": "missing_video_id", "video_meta": video_meta}

    if manual_transcript and manual_transcript.strip():
        return summarize_from_transcript(
            video_meta,
            manual_transcript,
            channel_handle=channel_handle,
        )

    if skip_if_processed and not force and video_id in load_processed_ids():
        return {
            "video_id": video_id,
            "skipped": True,
            "reason": "already_processed",
            "title": video_meta.get("title") or "",
            "url": video_meta.get("url") or f"https://www.youtube.com/watch?v={video_id}",
            "channel": channel_handle or video_meta.get("channel_title") or "",
        }

    title = video_meta.get("title") or ""
    description = video_meta.get("description") or ""
    published_at = video_meta.get("published_at") or ""
    url = video_meta.get("url") or f"https://www.youtube.com/watch?v={video_id}"
    channel = channel_handle or video_meta.get("channel_title") or ""

    try:
        transcript, source = extract_transcript(video_id)
        has_transcript = bool(transcript and len(transcript) > 40)

        if has_transcript:
            prompt = build_summary_prompt(title, description, transcript, has_transcript=True)
            try:
                summary = summarize_with_openrouter(prompt)
            except Exception as e:
                _log(f"summarize failed for {video_id}: {e}")
                summary = heuristic_summary_from_transcript(title, transcript)
                summary["risks"] = [f"LLM summarization failed: {e}"] + list(summary.get("risks") or [])
            thesis = (summary.get("key_thesis") or "").strip().lower()
            if thesis in ("", "unable to extract a clear thesis."):
                summary = heuristic_summary_from_transcript(title, transcript)
        else:
            prompt = build_summary_prompt(title, description, "", has_transcript=False)
            try:
                summary = summarize_with_openrouter(prompt)
                if "No transcript" not in " ".join(summary.get("risks") or []):
                    summary.setdefault("risks", []).append("Summary based on title/description only (no transcript)")
                summary["confidence"] = "low"
            except Exception as e:
                _log(f"title-only summarize failed for {video_id}: {e}")
                summary = fallback_summary(title, description, "No transcript; LLM unavailable")

        record = _build_video_record(
            video_meta,
            channel_handle=channel,
            transcript=transcript or "",
            source=source,
            summary=summary,
        )
        # preserve published fields already in helper
        record["published_at"] = published_at or record.get("published_at")
        record["url"] = url
        mark_processed(video_id)
        return record
    except Exception as e:
        _log(f"process_video failed for {video_id}: {e}")
        return {
            "video_id": video_id,
            "title": title,
            "published_at": published_at,
            "url": url,
            "channel": channel,
            "error": str(e),
            "summary": fallback_summary(title, description, str(e)),
            "transcript_length": 0,
            "raw_transcript_snippet": (description or "")[:500],
        }


def process_manual_summarize(
    video_ref: str,
    transcript_path: str,
    *,
    title: str = "",
    channel: str = "",
) -> Dict[str, Any]:
    """CLI helper: summarize using transcript file (+ optional metadata overrides)."""
    video_id = parse_video_id(video_ref) or video_ref.strip()
    if not video_id:
        return {"error": "invalid video id or url"}

    path = Path(transcript_path)
    if not path.exists():
        return {"error": f"transcript file not found: {transcript_path}", "video_id": video_id}
    try:
        transcript = path.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        return {"error": f"failed to read transcript: {e}", "video_id": video_id}

    meta: Dict[str, Any] = {
        "video_id": video_id,
        "title": title or "",
        "description": "",
        "published_at": "",
        "channel_id": "",
        "channel_title": channel or "",
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }
    # Enrich from YouTube API when available
    try:
        fetched = fetch_video_meta(video_id)
        meta.update({k: v for k, v in fetched.items() if v})
        if title:
            meta["title"] = title
        if channel:
            meta["channel_title"] = channel
    except Exception as e:
        _log(f"fetch_video_meta optional fail for manual summarize: {e}")
        if not meta["title"]:
            meta["title"] = title or f"YouTube video {video_id}"

    handle = channel or ""
    if not handle and meta.get("channel_id"):
        try:
            resolved = resolve_channel_id(meta["channel_id"])
            handle = resolved.get("handle") or meta.get("channel_title") or ""
        except Exception:
            handle = meta.get("channel_title") or ""
    elif not handle:
        handle = meta.get("channel_title") or "manual"

    return summarize_from_transcript(meta, transcript, channel_handle=handle)


def process_channel(
    handle_or_id: str,
    *,
    limit: int = 5,
    since_days: Optional[int] = None,
    skip_processed: bool = True,
) -> Dict[str, Any]:
    """Resolve channel, fetch recent videos, process each."""
    try:
        resolved = resolve_channel_id(handle_or_id)
    except Exception as e:
        return {"error": str(e), "channel": handle_or_id, "videos": []}

    handle = resolved.get("handle") or normalize_channel_handle(handle_or_id)
    try:
        videos = fetch_recent_videos(
            resolved["channel_id"],
            limit=limit,
            since_days=since_days,
            uploads_playlist=resolved.get("uploads_playlist") or "",
        )
    except Exception as e:
        return {
            "error": str(e),
            "channel": handle,
            "channel_id": resolved.get("channel_id"),
            "videos": [],
        }

    results = []
    for meta in videos:
        meta["channel_id"] = resolved.get("channel_id") or meta.get("channel_id")
        record = process_video(meta, channel_handle=handle, skip_if_processed=skip_processed)
        results.append(record)

    return {
        "channel": handle,
        "channel_id": resolved.get("channel_id"),
        "channel_title": resolved.get("title"),
        "count": len(results),
        "processed": sum(1 for r in results if not r.get("skipped") and not r.get("error")),
        "skipped": sum(1 for r in results if r.get("skipped")),
        "errors": sum(1 for r in results if r.get("error") and not r.get("skipped")),
        "videos": results,
    }


def process_poll(channels_file: str) -> Dict[str, Any]:
    """Batch over channels.json config."""
    path = Path(channels_file)
    if not path.is_absolute():
        path = Path(_PROJECT_ROOT) / path
    if not path.exists():
        return {"error": f"channels file not found: {path}", "channels": []}

    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return {"error": f"invalid channels file: {e}", "channels": []}

    channels = cfg.get("channels") if isinstance(cfg, dict) else cfg
    if not isinstance(channels, list):
        return {"error": "channels must be a list", "channels": []}

    limit = int(cfg.get("default_limit", 5)) if isinstance(cfg, dict) else 5
    since_days = cfg.get("since_days") if isinstance(cfg, dict) else None
    if since_days is None:
        since_raw = _env("YOUTUBE_POLL_SINCE_DAYS", "2")
        since_days = int(since_raw) if since_raw else 2

    batch = []
    for ch in channels:
        handle = str(ch).strip()
        if not handle:
            continue
        _log(f"Polling {handle} (limit={limit}, since_days={since_days})")
        try:
            result = process_channel(handle, limit=limit, since_days=since_days)
            batch.append(result)
        except Exception as e:
            _log(f"poll failed for {handle}: {e}")
            batch.append({"channel": handle, "error": str(e), "videos": []})

    return {
        "polled_at": datetime.now(timezone.utc).isoformat(),
        "channel_count": len(batch),
        "channels": batch,
    }


def list_channel_videos(handle_or_id: str, limit: int = 10) -> Dict[str, Any]:
    """Metadata only — no transcript/summarize."""
    try:
        resolved = resolve_channel_id(handle_or_id)
        videos = fetch_recent_videos(
            resolved["channel_id"],
            limit=limit,
            uploads_playlist=resolved.get("uploads_playlist") or "",
        )
        return {
            "channel": resolved.get("handle"),
            "channel_id": resolved.get("channel_id"),
            "videos": videos,
        }
    except Exception as e:
        return {"error": str(e), "channel": handle_or_id, "videos": []}


# ---------------------------------------------------------------------------
# CLI dispatch
# ---------------------------------------------------------------------------

def dispatch_cli(argv: List[str]) -> Dict[str, Any]:
    """Dispatch positional CLI args. Used by __main__ and market_data.py passthrough."""
    action = argv[0] if argv else "help"

    if action in ("help", "-h", "--help"):
        return {
            "ok": True,
            "usage": [
                "channel @CNBC [limit] [since_days]",
                "poll [channels.json]",
                "video VIDEO_ID_OR_URL",
                "summarize VIDEO_ID_OR_URL TRANSCRIPT_FILE [title] [channel]",
                "list @CNBC [limit]",
            ],
        }

    if action == "channel":
        handle = argv[1] if len(argv) > 1 else ""
        if not handle:
            return {"error": "channel handle required"}
        limit = int(argv[2]) if len(argv) > 2 and argv[2].isdigit() else 5
        since_days = int(argv[3]) if len(argv) > 3 and argv[3].isdigit() else None
        return process_channel(handle, limit=limit, since_days=since_days)

    if action == "poll":
        default_file = _env("YOUTUBE_CHANNELS_FILE") or "conf/youtube_channels.json"
        channels_file = argv[1] if len(argv) > 1 else default_file
        return process_poll(channels_file)

    if action == "video":
        raw = argv[1] if len(argv) > 1 else ""
        video_id = parse_video_id(raw) or raw.strip()
        if not video_id:
            return {"error": "video_id or url required"}
        try:
            meta = fetch_video_meta(video_id)
        except Exception as e:
            return {"error": str(e), "video_id": video_id}
        handle = ""
        if meta.get("channel_id"):
            try:
                resolved = resolve_channel_id(meta["channel_id"])
                handle = resolved.get("handle") or ""
            except Exception:
                handle = meta.get("channel_title") or ""
        return process_video(meta, channel_handle=handle, skip_if_processed=False, force=True)

    if action == "summarize":
        raw = argv[1] if len(argv) > 1 else ""
        transcript_path = argv[2] if len(argv) > 2 else ""
        title = argv[3] if len(argv) > 3 else ""
        channel = argv[4] if len(argv) > 4 else ""
        if not raw or not transcript_path:
            return {"error": "usage: summarize VIDEO_ID_OR_URL TRANSCRIPT_FILE [title] [channel]"}
        return process_manual_summarize(raw, transcript_path, title=title, channel=channel)

    if action == "list":
        handle = argv[1] if len(argv) > 1 else ""
        if not handle:
            return {"error": "channel handle required"}
        limit = int(argv[2]) if len(argv) > 2 and argv[2].isdigit() else 10
        return list_channel_videos(handle, limit=limit)

    return {"error": f"Unknown action: {action}"}


if __name__ == "__main__":
    try:
        result = dispatch_cli(sys.argv[1:])
    except Exception as e:
        result = {"error": str(e)}
    print(json.dumps(result))

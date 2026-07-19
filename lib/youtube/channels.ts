import 'server-only';

import fs from 'fs';
import path from 'path';

export interface YoutubeChannelsConfig {
  channels: string[];
  default_limit: number;
  since_days: number;
}

const DEFAULT_CONFIG: YoutubeChannelsConfig = {
  channels: ['@CNBC', '@BloombergTelevision', '@RealVision', '@KitcoNews'],
  default_limit: 5,
  since_days: 2,
};

export function channelsFilePath(): string {
  return (
    process.env.YOUTUBE_CHANNELS_FILE?.trim() ||
    path.join(process.cwd(), 'conf', 'youtube_channels.json')
  );
}

export function readChannelsConfig(): YoutubeChannelsConfig {
  const filePath = channelsFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_CONFIG, channels: [...DEFAULT_CONFIG.channels] };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const channels = Array.isArray(raw?.channels)
      ? raw.channels.map((c: unknown) => String(c).trim()).filter(Boolean)
      : [...DEFAULT_CONFIG.channels];
    return {
      channels,
      default_limit: Number(raw?.default_limit) > 0 ? Number(raw.default_limit) : DEFAULT_CONFIG.default_limit,
      since_days: Number(raw?.since_days) > 0 ? Number(raw.since_days) : DEFAULT_CONFIG.since_days,
    };
  } catch {
    return { ...DEFAULT_CONFIG, channels: [...DEFAULT_CONFIG.channels] };
  }
}

export function writeChannelsConfig(config: YoutubeChannelsConfig): YoutubeChannelsConfig {
  const filePath = channelsFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const normalized: YoutubeChannelsConfig = {
    channels: (config.channels || []).map((c) => {
      const s = String(c).trim();
      if (!s) return s;
      if (s.startsWith('UC') || s.startsWith('@')) return s;
      return `@${s}`;
    }).filter(Boolean),
    default_limit: Math.min(Math.max(Number(config.default_limit) || 5, 1), 25),
    since_days: Math.min(Math.max(Number(config.since_days) || 2, 1), 30),
  };
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

export function youtubeApiConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

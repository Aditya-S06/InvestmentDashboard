export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { requireUser } from '@/lib/auth/require-user';
import { serverError } from '@/lib/http/errors';
import {
  readChannelsConfig,
  writeChannelsConfig,
  youtubeApiConfigured,
  type YoutubeChannelsConfig,
} from '@/lib/youtube/channels';

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const config = readChannelsConfig();
    return NextResponse.json({
      ...config,
      youtubeApiConfigured: youtubeApiConfigured(),
      openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    });
  } catch (error) {
    return serverError('youtube/channels', error, 'Could not load channel config');
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  try {
    const body = await req.json();
    const next: YoutubeChannelsConfig = {
      channels: Array.isArray(body?.channels) ? body.channels : [],
      default_limit: Number(body?.default_limit) || 5,
      since_days: Number(body?.since_days) || 2,
    };
    if (next.channels.length === 0) {
      return NextResponse.json({ error: 'At least one channel is required' }, { status: 400 });
    }
    const saved = writeChannelsConfig(next);
    return NextResponse.json({
      ...saved,
      youtubeApiConfigured: youtubeApiConfigured(),
      openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    });
  } catch (error) {
    return serverError('youtube/channels/save', error, 'Could not save channel config');
  }
}

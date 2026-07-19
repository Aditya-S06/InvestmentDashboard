export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  readChannelsConfig,
  writeChannelsConfig,
  youtubeApiConfigured,
  type YoutubeChannelsConfig,
} from '@/lib/youtube/channels';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const config = readChannelsConfig();
    return NextResponse.json({
      ...config,
      youtubeApiConfigured: youtubeApiConfigured(),
      openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to save channels' }, { status: 500 });
  }
}

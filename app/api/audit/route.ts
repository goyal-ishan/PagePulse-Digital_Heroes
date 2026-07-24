import { NextRequest, NextResponse } from 'next/server';
import { parseHtml } from './parse';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // SSRF / URL validation check here...
    
    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const responseTimeMs = Date.now() - startTime;
    const html = await response.text();

    // Call pure parsing function
    const metrics = parseHtml(html);

    return NextResponse.json({
      url,
      status: response.status,
      responseTimeMs,
      ...metrics,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to analyze page' },
      { status: 500 }
    );
  }
}
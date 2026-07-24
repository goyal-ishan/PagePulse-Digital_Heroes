import * as cheerio from 'cheerio';

export interface AuditMetrics {
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  missingAltCount: number;
  wordCount: number;
}

export function parseHtml(html: string): AuditMetrics {
  const $ = cheerio.load(html);

  // Extract Title & Meta Description
  const titleText = $('title').text().trim();
  const title = titleText.length > 0 ? titleText : null;

  const metaDescText = $('meta[name="description"]').attr('content')?.trim();
  const metaDescription = metaDescText && metaDescText.length > 0 ? metaDescText : null;

  // Extract H1 Count
  const h1Count = $('h1').length;

  // Extract Images missing or empty alt tags (including whitespace-only)
  const missingAltCount = $('img').filter((_, img) => {
    const alt = $(img).attr('alt');
    return alt === undefined || alt.trim() === '';
  }).length;

  // Calculate Word Count from body text
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText ? bodyText.split(' ').length : 0;

  return {
    title,
    metaDescription,
    h1Count,
    missingAltCount,
    wordCount,
  };
}
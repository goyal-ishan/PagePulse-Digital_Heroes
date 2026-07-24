import { describe, it, expect } from 'vitest';
import { parseHtml } from './parse';

describe('Page Pulse - HTML Parser Tests', () => {

  // 1. HAPPY PATH
  it('should correctly parse a well-formed HTML document', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page Title</title>
          <meta name="description" content="This is a test meta description." />
        </head>
        <body>
          <h1>Heading 1</h1>
          <p>Here is some sample text for testing.</p>
          <img src="image1.jpg" alt="Valid alt text" />
          <img src="image2.jpg" />
        </body>
      </html>
    `;

    const result = parseHtml(html);

    expect(result.title).toBe('Test Page Title');
    expect(result.metaDescription).toBe('This is a test meta description.');
    expect(result.h1Count).toBe(1);
    expect(result.missingAltCount).toBe(1);
    expect(result.wordCount).toBe(9); // Includes "Heading 1" + paragraph text
  });

  // 2. FAILURE / EDGE CASE 1: Missing metadata tags
  it('should handle HTML missing head metadata tags gracefully', () => {
    const html = `
      <body>
        <p>Short text content with no title tag or meta description.</p>
      </body>
    `;

    const result = parseHtml(html);

    expect(result.title).toBeNull();
    expect(result.metaDescription).toBeNull();
    expect(result.h1Count).toBe(0);
    expect(result.missingAltCount).toBe(0);
  });

  // 3. FAILURE / EDGE CASE 2: Whitespace-only & missing alt attributes
  it('should catch missing, empty, and whitespace-only alt attributes on images', () => {
    const html = `
      <body>
        <img src="1.jpg" />
        <img src="2.jpg" alt="" />
        <img src="3.jpg" alt="   " />
        <img src="4.jpg" alt="Proper description" />
      </body>
    `;

    const result = parseHtml(html);

    expect(result.missingAltCount).toBe(3);
  });

  // 4. EDGE CASE 3: Truncated / Malformed HTML
  it('should process malformed HTML without throwing errors', () => {
    const html = `<div><h1>Truncated HTML<img src="broken.png" alt`;

    expect(() => parseHtml(html)).not.toThrow();
  });

});
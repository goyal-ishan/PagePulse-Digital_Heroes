import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import { isIP } from "node:net";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const FETCH_TIMEOUT_MS = 9_000; // hard timeout per outbound request
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB cap on response body we'll read
const MAX_REDIRECTS = 5; // bounded redirect following (defends against loops)
const USER_AGENT = "PagePulse-AuditBot/1.0 (+https://digitalheroesco.com)";

// ---------------------------------------------------------------------------
// SSRF protection helpers
//
// We can't just string-match the hostname the client sent, because a
// hostname like "evil.example.com" can resolve to 127.0.0.1 or an internal
// IP (DNS rebinding). So we resolve the hostname ourselves and inspect the
// actual IP(s) before ever handing the URL to fetch(). We also re-check on
// every hop of a redirect chain, since a 302 could point anywhere.
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // malformed -> fail closed
  const [a, b] = parts;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 address, e.g. ::ffff:127.0.0.1
    const v4 = lower.split(":").pop();
    if (v4 && isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

async function isHostnameBlocked(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();

  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower === "0.0.0.0" ||
    lower === "metadata.google.internal" // common cloud metadata alias
  ) {
    return true;
  }

  // If the hostname is already a literal IP, check it directly.
  const literalFamily = isIP(lower);
  if (literalFamily === 4) return isPrivateIPv4(lower);
  if (literalFamily === 6) return isPrivateIPv6(lower);

  // Otherwise resolve DNS and check every returned address.
  try {
    const records = await dns.lookup(lower, { all: true, verbatim: true });
    if (records.length === 0) return true; // no address -> can't safely proceed
    return records.some((r) =>
      r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address)
    );
  } catch {
    // DNS resolution failure: fail closed rather than let an ambiguous host through.
    return true;
  }
}

// ---------------------------------------------------------------------------
// Typed error used to carry an HTTP status + message back to the handler
// ---------------------------------------------------------------------------
class AuditError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Fetch with: SSRF guard, manual bounded redirect following, and timeout.
// ---------------------------------------------------------------------------
async function safeFetch(
  initialUrl: URL,
  signal: AbortSignal
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (await isHostnameBlocked(currentUrl.hostname)) {
      throw new AuditError(
        400,
        `Refusing to fetch "${currentUrl.hostname}": local, private, or otherwise disallowed network address.`
      );
    }

    let response: Response;
    try {
      response = await fetch(currentUrl.toString(), {
        signal,
        redirect: "manual", // we handle redirects ourselves so we can re-validate each hop
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err; // let caller map to 504
      throw new AuditError(
        502,
        `Could not reach "${currentUrl.hostname}". The host may be offline or refusing connections.`
      );
    }

    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    if (isRedirect) {
      const location = response.headers.get("location");
      if (!location) {
        // Redirect status with no Location header -- nothing we can follow.
        return { response, finalUrl: currentUrl };
      }
      if (hop === MAX_REDIRECTS) {
        throw new AuditError(400, `Too many redirects (>${MAX_REDIRECTS}) while fetching the URL.`);
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        throw new AuditError(400, "Received a malformed redirect Location header.");
      }
      if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
        throw new AuditError(400, "Redirect target uses an unsupported protocol.");
      }
      currentUrl = nextUrl;
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  // Unreachable in practice, but keeps TypeScript happy.
  throw new AuditError(400, "Too many redirects while fetching the URL.");
}

// ---------------------------------------------------------------------------
// Read a response body up to a byte cap, aborting the stream if it's exceeded.
// ---------------------------------------------------------------------------
async function readBodyWithCap(response: Response): Promise<string> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      throw new AuditError(
        413,
        `Response body (${(declared / (1024 * 1024)).toFixed(1)}MB) exceeds the ${
          MAX_BODY_BYTES / (1024 * 1024)
        }MB limit.`
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    // Some runtimes may not expose a streaming body; fall back to text() directly.
    return await response.text();
  }

  const decoder = new TextDecoder();
  let received = 0;
  let html = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new AuditError(
        413,
        `Response body exceeded the ${MAX_BODY_BYTES / (1024 * 1024)}MB limit while streaming.`
      );
    }
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode(); // flush

  return html;
}

// ---------------------------------------------------------------------------
// POST /api/audit
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // ---- 1. Parse & validate the JSON body -----------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const rawUrl = (body as { url?: unknown })?.url;
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'Request body must include a non-empty "url" string.' },
      { status: 400 }
    );
  }

  // ---- 2. Validate URL shape & protocol --------------------------------------
  let target: URL;
  try {
    target = new URL(rawUrl.trim());
  } catch {
    return NextResponse.json(
      { success: false, error: `"${rawUrl}" is not a valid URL.` },
      { status: 400 }
    );
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json(
      { success: false, error: `Unsupported protocol "${target.protocol}". Only http and https are allowed.` },
      { status: 400 }
    );
  }

  // ---- 3. Fetch with timeout, SSRF guard, redirect handling ------------------
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const startedAt = performance.now();

  let response: Response;
  let finalUrl: URL;
  try {
    const result = await safeFetch(target, controller.signal);
    response = result.response;
    finalUrl = result.finalUrl;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { success: false, error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s.` },
        { status: 504 }
      );
    }
    if (err instanceof AuditError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { success: false, error: "Unexpected error while fetching the target URL." },
      { status: 500 }
    );
  }

  const responseTimeMs = Math.round(performance.now() - startedAt);

  // ---- 4. Content-Type gate (before we ever touch the body) -----------------
  const contentType = response.headers.get("content-type") ?? "";
  const looksLikeHtml =
    contentType.includes("text/html") || contentType.includes("application/xhtml+xml");

  if (!looksLikeHtml) {
    clearTimeout(timeoutId);
    return NextResponse.json(
      {
        success: false,
        error: `Target returned Content-Type "${contentType || "unknown"}", not HTML. Refusing to parse.`,
      },
      { status: 415 }
    );
  }

  // ---- 5. Read body with a size cap ------------------------------------------
  let html: string;
  try {
    html = await readBodyWithCap(response);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof AuditError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { success: false, error: "Failed to read response body." },
      { status: 500 }
    );
  }
  clearTimeout(timeoutId);

  // ---- 6. Parse defensively with Cheerio -------------------------------------
  // Non-200 target responses (404, 500, etc.) are still parsed and reported --
  // we never throw just because the target itself errored.
  let title = "No title found";
  let metaDescription = "No meta description found";
  let h1Count = 0;
  let imagesMissingAlt = 0;
  let wordCount = 0;

  try {
    const $ = cheerio.load(html);

    title = $("title").first().text()?.trim() || "No title found";

    metaDescription =
      $('meta[name="description"]').first().attr("content")?.trim() || "No meta description found";

    h1Count = $("h1").length ?? 0;

    $("img").each((_, el) => {
      const alt = $(el).attr("alt");
      if (alt === undefined || alt.trim().length === 0) imagesMissingAlt++;
    });

    // Strip non-visible / non-content elements before computing word count.
    $("script, style, svg, noscript, template").remove();
    const visibleText = ($("body").text() || $.root().text() || "").replace(/\s+/g, " ").trim();
    wordCount = visibleText.length > 0 ? visibleText.split(" ").length : 0;
  } catch {
    // Malformed HTML that even Cheerio chokes on: fall back to the safe
    // defaults declared above rather than crashing the endpoint.
  }

  // ---- 7. Respond -------------------------------------------------------------
  return NextResponse.json(
    {
      success: true,
      requestedUrl: target.toString(),
      finalUrl: finalUrl.toString(),
      redirected: finalUrl.toString() !== target.toString(),
      httpStatus: response.status,
      responseTimeMs,
      title,
      metaDescription,
      h1Count,
      imagesMissingAlt,
      wordCount,
    },
    { status: 200 }
  );
}
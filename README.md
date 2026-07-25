# Page Pulse

Check a page's vitals in seconds — response time, HTTP status, SEO metadata, and basic accessibility signals for any public URL.

**Live demo:** https://page-pulse-digital-heroes-two.vercel.app
**Repo:** https://github.com/goyal-ishan/PagePulse-Digital_Heroes

Built for the Digital Heroes technical assessment.

---

## Tech stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Cheerio** for server-side HTML parsing
- **Standard CSS** — CSS Modules + a small globals sheet (no Tailwind)
- **Vitest** for unit tests

---

## Setup

### Prerequisites

- Node.js 18.17+ (required by Next.js 14)
- npm

### Install & run locally

```bash
git clone https://github.com/goyal-ishan/PagePulse-Digital_Heroes.git
cd PagePulse-Digital_Heroes
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

### Other scripts

```bash
npm run build   # production build (also type-checks the whole app)
npm run start   # run the production build locally
npm test        # run the Vitest suite for the parsing logic
```

### Deploying to Vercel

1. Push the repo to GitHub (already done — see link above).
2. Import the repo at [vercel.com/new](https://vercel.com/new).
3. No environment variables are required — the app has no external API keys or secrets.
4. Vercel auto-detects Next.js and deploys on every push to `main`.

---

## API contract

### `POST /api/audit`

Fetches a target URL, times the request, and returns structured audit metrics. This is the only endpoint in the app.

**Request**

```
Content-Type: application/json
```

```json
{ "url": "https://example.com" }
```

| Field | Type   | Required | Notes                                   |
|-------|--------|----------|------------------------------------------|
| `url` | string | yes      | Must be a valid `http://` or `https://` URL |

**Success response — `200 OK`**

```json
{
  "success": true,
  "requestedUrl": "https://example.com",
  "finalUrl": "https://example.com/",
  "redirected": false,
  "httpStatus": 200,
  "responseTimeMs": 184,
  "title": "Example Domain",
  "metaDescription": "No meta description found",
  "h1Count": 1,
  "imagesMissingAlt": 0,
  "wordCount": 28
}
```

| Field              | Type    | Description                                                                 |
|---------------------|---------|-------------------------------------------------------------------------------|
| `requestedUrl`      | string  | The URL exactly as submitted                                                  |
| `finalUrl`          | string  | The URL actually fetched, after following any redirects                      |
| `redirected`        | boolean | Whether `finalUrl` differs from `requestedUrl`                               |
| `httpStatus`        | number  | HTTP status code returned by the **target** site (e.g. `404`, `500`) — this is distinct from the status code of this API response, which is `200` as long as the audit itself completed |
| `responseTimeMs`    | number  | Round-trip fetch duration in milliseconds                                    |
| `title`             | string  | `<title>` text, or `"No title found"`                                        |
| `metaDescription`   | string  | `<meta name="description">` content, or `"No meta description found"`        |
| `h1Count`           | number  | Count of `<h1>` elements                                                     |
| `imagesMissingAlt`  | number  | Count of `<img>` elements with a missing, empty, or whitespace-only `alt`    |
| `wordCount`         | number  | Approximate visible word count, with `<script>`/`<style>`/`<svg>` stripped   |

**Error responses**

All errors share the same shape:

```json
{ "success": false, "error": "Human-readable message" }
```

| Status | Meaning                                                                 |
|--------|---------------------------------------------------------------------------|
| `400`  | Bad request — missing/invalid JSON, malformed URL, unsupported protocol, blocked (private/local) host, too many redirects |
| `413`  | Target response body exceeds the 5MB cap                                 |
| `415`  | Target response `Content-Type` is not HTML                               |
| `502`  | Target host unreachable (DNS failure, connection refused, offline)       |
| `504`  | Target took longer than 9 seconds to respond                             |
| `500`  | Unexpected server error                                                  |

**Note:** the target site returning a 404 or 500 is *not* an error from this API's point of view — that status is reported inside a normal `200` success payload via `httpStatus`, since the audit itself succeeded. This endpoint's own error codes (400/413/415/502/504/500) describe failures in *auditing*, not failures of the page being audited.

---

## Three design decisions

### 1. SSRF protection resolves DNS and checks the actual IP, not just the hostname string

A naive guard that blocks the literal strings `localhost` or `127.0.0.1` misses the common bypass: a hostname like `attacker-controlled.com` can be pointed at `169.254.169.254` (a cloud metadata endpoint) or any internal IP via DNS. Blocking on hostname text alone would let that straight through.

Instead, `isHostnameBlocked()` resolves the hostname with `dns.lookup()` and checks every returned address against private/loopback/link-local/CGNAT ranges — and does this again on **every hop of a redirect chain**, since a `302` can point anywhere regardless of where the original request went. If DNS resolution fails outright, the request is blocked rather than allowed through — failing closed is safer than failing open for anything that touches SSRF.

*Trade-off worth knowing:* there's a small window between resolving the hostname and the actual `fetch()` call re-resolving it internally (a DNS-rebinding TOCTOU gap). Fully closing that requires pinning the resolved IP and connecting to it directly, which means overriding Node's fetch dispatcher — out of scope for this assessment but worth flagging for anything handling untrusted URLs in production.

### 2. The Cheerio parsing logic lives in its own pure function, separate from the route handler

`app/api/audit/parse.ts` exports `parseHtml(html: string): ParsedAudit` with no dependency on `fetch`, `NextRequest`, timeouts, or the network at all. `route.ts` just calls it after it has the HTML in hand.

The alternative — parsing inline inside the `POST` handler — is what a first draft of this looked like, and it's harder to test well: exercising "what happens when `<title>` is missing" would otherwise require mocking a full HTTP response. Pulling it out means `parse.test.ts` can hand it a raw string and assert on the output directly, which is both faster to run and closer to testing the actual thing that can go wrong (malformed markup), rather than testing markup handling *and* HTTP plumbing at once.

### 3. Redirects are followed manually (`redirect: "manual"`) instead of letting `fetch` follow them automatically

Node's built-in `fetch` will happily follow redirects on its own, but that means the SSRF check only ever runs against the *first* URL — a target could redirect straight to an internal address and the SSRF guard would never see it. It would also make it impossible to enforce a specific hop limit or to report whether/where a redirect happened in the response payload.

`safeFetch()` instead sets `redirect: "manual"`, inspects each `3xx` response itself, re-validates the new `Location` against the same SSRF and protocol checks, and caps the chain at 5 hops before giving up with a `400`. It's more code than trusting the default behavior, but it means every hop gets the same scrutiny as the original request, and the final response can honestly report `redirected` and `finalUrl` instead of only ever showing the URL the user typed in.

---

## Project structure

```
app/
├── api/
│   └── audit/
│       ├── route.ts        # POST handler: validation, SSRF guard, fetch, response shaping
│       ├── parse.ts         # Pure HTML-parsing logic (Cheerio)
│       └── parse.test.ts    # Unit tests for parse.ts
├── page.tsx                 # Dashboard UI (form, results grid, error banner)
├── page.module.css          # Component styles
├── globals.css              # Design tokens / base styles
└── layout.tsx                # Root layout
```

# Page Pulse ⚡

Page Pulse is a lightweight, production-ready website audit application built with Next.js (App Router), TypeScript, and Cheerio. It fetches public web pages to analyze performance response times, fundamental SEO markers, and basic accessibility signals.

---

## 🚀 Setup Instructions

### Prerequisites
* **Node.js**: `v18.x` or higher
* **npm**: `v9.x` or higher

### Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/goyal-ishan/PagePulse-Digital_Heroes.git](https://github.com/goyal-ishan/PagePulse-Digital_Heroes.git)
   cd page-pulse
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Run the test suite:**
   ```bash
   npm test
   ```

---

## 📑 API Contract

### `POST /api/audit`

Analyzes a target URL and returns extracted SEO, performance, and accessibility metrics.

#### Request Body
```json
{
  "url": "[https://example.com](https://example.com)"
}
```

#### Successful Response (`200 OK`)
```json
{
  "url": "[https://example.com](https://example.com)",
  "status": 200,
  "responseTimeMs": 352,
  "h1Count": 1,
  "missingAltCount": 2,
  "wordCount": 420,
  "title": "Example Domain",
  "metaDescription": "Example Domain description text for search engines."
}
```

#### Error Response (`400 Bad Request` / `422 Unprocessable Content`)
```json
{
  "error": "Access to local or internal network IP addresses is restricted."
}
```

---

## 💡 3 Key Design Decisions & Rationale

### 1. Static Parsing via Cheerio over Headless Browsers
* **Decision:** Used Cheerio to parse static HTML directly on the server instead of booting up a heavy headless browser like Puppeteer or Playwright.
* **Reasoning:** Cheerio executes in milliseconds with minimal CPU and memory overhead. This delivers low-latency audit responses and keeps cloud hosting costs minimal while fulfilling all core parsing requirements.

### 2. SSRF (Server-Side Request Forgery) Defensive Validation
* **Decision:** Performed explicit URL host resolution using DNS lookup before executing outbound HTTP requests.
* **Reasoning:** Prevents malicious actors from using the server as a proxy to scan private internal networks (e.g., `localhost`, `127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`).

### 3. Strict Timeout Management via AbortController
* **Decision:** Enforced a hard 5-second timeout on all target page fetches using native `AbortController`.
* **Reasoning:** Guarantees that hanging, slow, or unresponsive external target servers will not tie up API routes or exhaust server resources.

---

## 🔗 Live Build & Submission Details

* **Live URL:** `https://your-app-name.vercel.app`
* **GitHub Repository:** `https://github.com/YOUR_GITHUB_USERNAME/page-pulse`

*Built for Digital Heroes Training Task — [digitalheroesco.com](https://digitalheroesco.com)*
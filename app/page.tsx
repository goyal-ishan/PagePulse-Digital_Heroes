"use client";

import { useState, FormEvent } from "react";
import styles from "./page.module.css";

type AuditResult = {
  success: true;
  requestedUrl: string;
  finalUrl: string;
  redirected: boolean;
  httpStatus: number;
  responseTimeMs: number;
  title: string;
  metaDescription: string;
  h1Count: number;
  imagesMissingAlt: number;
  wordCount: number;
};

type Status = "idle" | "loading" | "success" | "error";

/** Lightweight client-side check so obviously-bad input never reaches the network. */
function getUrlValidationError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter a URL to audit.";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That doesn't look like a valid URL (try including https://).";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http:// and https:// URLs are supported.";
  }
  return null;
}

function statusPillClass(httpStatus: number): string {
  if (httpStatus >= 200 && httpStatus < 300) return styles.statusGood;
  if (httpStatus >= 300 && httpStatus < 500) return styles.statusWarn;
  return styles.statusBad;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const validationError = getUrlValidationError(url);
    setFieldError(validationError);
    if (validationError) return;

    setStatus("loading");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      // Always try to read JSON, even on non-2xx, since the API returns
      // structured error payloads for 400/415/504/500.
      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        throw new Error("The server sent back a response we couldn't understand.");
      }

      if (!res.ok) {
        const message =
          typeof payload === "object" && payload && "error" in payload
            ? String((payload as { error: unknown }).error)
            : `Request failed with status ${res.status}.`;
        setStatus("error");
        setErrorMessage(message);
        return;
      }

      setResult(payload as AuditResult);
      setStatus("success");
    } catch (err) {
      // Covers network failures, offline state, unexpected exceptions -- the
      // UI never hangs in "loading" and never shows a blank white screen.
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong reaching the server."
      );
    }
  }

  const isLoading = status === "loading";

  return (
    <div className={styles.shell}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Page Pulse</p>
          <h1 className={styles.title}>Check a page&rsquo;s vitals in seconds</h1>
          <p className={styles.subtitle}>
            Enter any public URL. We&rsquo;ll fetch it, time it, and read out its SEO and
            accessibility signals.
          </p>

          <svg
            className={styles.pulseLine}
            viewBox="0 0 560 46"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              className={`${styles.pulsePath} ${isLoading ? styles.active : ""}`}
              d="M0,23 L140,23 L162,6 L184,40 L206,23 L230,23 L252,10 L274,36 L296,23 L560,23"
            />
          </svg>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.inputWrap}>
              <label htmlFor="url-input" className="sr-only" style={{ display: "none" }}>
                URL to audit
              </label>
              <input
                id="url-input"
                className={`${styles.input} ${fieldError ? styles.invalid : ""}`}
                type="text"
                inputMode="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                disabled={isLoading}
                aria-invalid={Boolean(fieldError)}
                aria-describedby="url-hint"
              />
              <span id="url-hint" className={styles.fieldHint}>
                {fieldError ?? ""}
              </span>
            </div>
            <button className={styles.submit} type="submit" disabled={isLoading}>
              {isLoading && <span className={styles.spinner} aria-hidden="true" />}
              {isLoading ? "Checking\u2026" : "Run audit"}
            </button>
          </form>
        </div>
      </header>

      {status === "error" && errorMessage && (
        <div className={styles.errorBanner} role="alert">
          <span className={styles.errorIcon}>!</span>
          <span>{errorMessage}</span>
        </div>
      )}

      <main className={styles.results}>
        {status === "success" && result && (
          <>
            <div className={styles.resultsMeta}>
              <span className={`${styles.statusPill} ${statusPillClass(result.httpStatus)}`}>
                HTTP {result.httpStatus}
              </span>
              <span>{result.finalUrl}</span>
              {result.redirected && <span>&middot; redirected from {result.requestedUrl}</span>}
            </div>

            <div className={styles.grid}>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Response time</span>
                <span className={styles.cardValue}>{result.responseTimeMs} ms</span>
              </div>

              <div className={styles.card}>
                <span className={styles.cardLabel}>H1 tags</span>
                <span className={styles.cardValue}>{result.h1Count}</span>
                {result.h1Count === 0 && <span className={styles.cardFlag}>No H1 found</span>}
                {result.h1Count > 1 && (
                  <span className={styles.cardFlag}>Multiple H1s may hurt SEO</span>
                )}
                {result.h1Count === 1 && <span className={styles.cardFlagOk}>Good</span>}
              </div>

              <div className={styles.card}>
                <span className={styles.cardLabel}>Images missing alt text</span>
                <span className={styles.cardValue}>{result.imagesMissingAlt}</span>
                {result.imagesMissingAlt === 0 ? (
                  <span className={styles.cardFlagOk}>All images labeled</span>
                ) : (
                  <span className={styles.cardFlag}>Accessibility risk</span>
                )}
              </div>

              <div className={styles.card}>
                <span className={styles.cardLabel}>Visible word count</span>
                <span className={styles.cardValue}>{result.wordCount.toLocaleString()}</span>
              </div>

              <div className={`${styles.card} ${styles.wideCard}`}>
                <span className={styles.cardLabel}>Page title</span>
                <span className={`${styles.cardValue} ${styles.small}`}>{result.title}</span>
              </div>

              <div className={`${styles.card} ${styles.wideCard}`}>
                <span className={styles.cardLabel}>Meta description</span>
                <span className={`${styles.cardValue} ${styles.small}`}>
                  {result.metaDescription}
                </span>
              </div>
            </div>
          </>
        )}

        {status === "idle" && (
          <div className={styles.emptyState}>Run an audit to see response, SEO, and image metrics here.</div>
        )}
      </main>

      <footer className={styles.footer}>
        Built for{" "}
        <a href="https://digitalheroesco.com" target="_blank" rel="noopener noreferrer">
          Digital Heroes Training Task
        </a>
      </footer>
    </div>
  );
}

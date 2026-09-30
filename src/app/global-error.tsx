"use client";

import { useEffect } from "react";

/**
 * The last resort: the root layout itself failed. It replaces the whole document, so it carries its
 * own markup and styling (the app's stylesheet may be what failed).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#faf4e8",
          color: "#291c15",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: 420 }}>
          <p style={{ fontSize: 28, fontWeight: 700, margin: "0 0 16px" }}>
            Pinched<span style={{ color: "#c44323" }}>.</span>
          </p>
          <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", color: "#6f6056" }}>
            Your plan and lists are safe. Give it another try.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#c44323",
              color: "#fdfaf4",
              border: 0,
              borderRadius: 999,
              padding: "12px 24px",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#6f6056", marginTop: 16 }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}

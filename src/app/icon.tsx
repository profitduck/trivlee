import { ImageResponse } from "next/og";

// Dynamic favicon — renders a coral square with a bold "T" wordmark, matching
// the Trivlee brand. Next.js converts this to /icon.png and serves it as the
// favicon. No fonts loaded — relies on system-ui at the edge.

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #E84F2C 0%, #C2391A 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 44,
          fontWeight: 900,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          letterSpacing: "-0.04em",
          borderRadius: 14,
        }}
      >
        T
      </div>
    ),
    size
  );
}

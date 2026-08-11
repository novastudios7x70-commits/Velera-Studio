import { ImageResponse } from "next/og";

// Generated in code from the same tokens as the rest of the app rather
// than a hand-exported static asset. Monochrome, matching Velora's
// "color in motion, not at rest" system — no ambient gradient wash.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0c0c0e",
          padding: 80,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 96,
            height: 96,
            borderRadius: 18,
            background: "#f0efec",
            fontSize: 48,
            fontWeight: 700,
            color: "#0a0a0b",
            marginBottom: 40,
          }}
        >
          V
        </div>
        <div
          style={{
            fontSize: 60,
            fontWeight: 700,
            color: "#f0efec",
            letterSpacing: "-0.02em",
            textAlign: "center",
            display: "flex",
          }}
        >
          Turn your videos into something worth sharing.
        </div>
        <div
          style={{
            fontSize: 28,
            color: "#8c8c90",
            marginTop: 20,
            textAlign: "center",
            display: "flex",
          }}
        >
          Velora finds the moments that matter — you direct the final result.
        </div>
      </div>
    ),
    { ...size },
  );
}

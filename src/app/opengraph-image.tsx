import { ImageResponse } from "next/og";

// No social share image existed at all — a pasted link would show a bare
// title with no card. Generated in code from the same tokens as the rest of
// the app rather than a hand-exported static asset.
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
          background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(168,85,247,0.35), transparent), #0b0714",
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
            borderRadius: 22,
            background: "linear-gradient(135deg, #A855F7, #D4AF37)",
            fontSize: 48,
            fontWeight: 700,
            color: "#ffffff",
            marginBottom: 40,
          }}
        >
          V
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            color: "#F5F1FA",
            letterSpacing: "-0.02em",
            textAlign: "center",
            display: "flex",
          }}
        >
          One upload. A viral empire.
        </div>
        <div
          style={{
            fontSize: 28,
            color: "#9C8FAE",
            marginTop: 20,
            textAlign: "center",
            display: "flex",
          }}
        >
          Platform-ready clips for TikTok, Shorts, Reels, Facebook &amp; Pinterest
        </div>
      </div>
    ),
    { ...size },
  );
}

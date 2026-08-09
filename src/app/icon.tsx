import { ImageResponse } from "next/og";

// The browser tab was still showing Next.js's stock default icon instead of
// the app's own gradient "V" mark (see Logo.tsx) — one of the concrete
// "looks like boilerplate" tells. Generated in code so it matches the exact
// gradient/weight of the header logo instead of a hand-exported asset that
// could drift from it.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #A855F7, #D4AF37)",
          borderRadius: 7,
          fontSize: 20,
          fontWeight: 700,
          color: "#ffffff",
        }}
      >
        V
      </div>
    ),
    { ...size },
  );
}

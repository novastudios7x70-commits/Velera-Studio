import { ImageResponse } from "next/og";

// Generated in code so it matches the header logo mark (see Logo.tsx)
// exactly instead of a hand-exported asset that could drift from it.
// Monochrome, matching Velora's "color in motion, not at rest" system.
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
          background: "#f0efec",
          borderRadius: 7,
          fontSize: 20,
          fontWeight: 700,
          color: "#0a0a0b",
        }}
      >
        V
      </div>
    ),
    { ...size },
  );
}

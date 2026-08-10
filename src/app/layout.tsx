import type { Metadata } from "next";
import { Outfit, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Velora Studio — One upload. A viral empire.",
  description:
    "Velora Studio turns one upload into platform-ready short-form clips for TikTok, YouTube Shorts, Instagram Reels, Facebook, and Pinterest.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body
        className="nova-root nova-scrollbar min-h-full flex flex-col relative"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(201,162,39,0.1), transparent), #0c0c0e",
        }}
      >
        <ToastProvider>
          <div className="relative z-10 flex-1 flex flex-col">
            <SiteHeader />
            {children}
            <Footer />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}

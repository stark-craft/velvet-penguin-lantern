import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const description = "A premium newsroom workspace for discovering, clustering, reviewing, and briefing high-value news intelligence.";
  const socialImage = new URL("/og.png", base).toString();
  return {
    metadataBase: base,
    title: "Signalroom — AI News Intelligence",
    description,
    openGraph: {
      title: "Signalroom — AI News Intelligence",
      description,
      type: "website",
      images: [{ url: socialImage, width: 1732, height: 908, alt: "Signalroom AI News Intelligence morning briefing" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Signalroom — AI News Intelligence",
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light" data-profile="default">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

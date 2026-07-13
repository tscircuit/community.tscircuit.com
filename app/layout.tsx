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
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "community.tscircuit.com";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const base = new URL(protocol + "://" + host);
  return {
    metadataBase: base,
    title: {
      default: "tscircuit Community Index",
      template: "%s",
    },
    description: "Search practical answers, experiments, and discoveries from the tscircuit Discord community.",
    openGraph: {
      title: "The tscircuit community’s circuit knowledge, searchable.",
      description: "A living index of Discord discussions, refreshed every 30 minutes.",
      type: "website",
      images: [{ url: new URL("/og.png", base).toString(), width: 1536, height: 1024 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "tscircuit Community Index",
      description: "Search answers and discoveries from the tscircuit Discord.",
      images: [new URL("/og.png", base).toString()],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={geistSans.variable + " " + geistMono.variable}>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Caveat, Plus_Jakarta_Sans } from "next/font/google";
import { AppProviders } from "@/components/providers/AppProviders";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-script",
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "goodly — Good food. Good neighbors. Always.",
  description:
    "Neighborhood food delivery platform connecting customers, restaurants, delivery partners, and operations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${caveat.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-[#FCF9F0] text-[#1E1F1C]">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

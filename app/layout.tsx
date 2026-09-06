import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenWorld Economy | World Explorer",
  description: "Explore a deterministic isometric world. Pan, zoom, and inspect terrain coordinates in the OpenWorld Economy spatial prototype.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}

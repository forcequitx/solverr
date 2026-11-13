import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MotionProvider } from "@/components/ui/motion-provider";
import { ThemeScript } from "@/components/ui/theme-script";
import { CHAINS } from "@/lib/chains/registry";
import { getEnv } from "@/lib/env";
import { pageMetadata } from "@/lib/metadata";
import { FONT_VARIABLES } from "./fonts";
import "./globals.css";

/** `metadataBase` makes the preview image and page links in shared-link cards absolute, on the public APP_URL. */
export const metadata: Metadata = {
  metadataBase: new URL(getEnv().APP_URL),
  ...pageMetadata(
    "Solverr",
    `Accept crypto from ${CHAINS.length} chains. Customers and AI agents pay with what they hold, and you receive the coin you choose in your own wallet.`,
  ),
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    /** The theme script may set data-theme on <html> before React hydrates. */
    <html lang="en" className={FONT_VARIABLES} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {/** First in <body>, not <head>: wallet extensions inject scripts into <head>, which would break hydration. It still runs before anything paints. */}
        <ThemeScript />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}

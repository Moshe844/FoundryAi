import type { Metadata } from "next";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/ui/theme";

export const metadata: Metadata = {
  title: "Foundry Workspace",
  description: "A premium engineering workspace shell.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Password managers, grammar tools, dark-mode helpers, and similar extensions can add root
    // attributes before React hydrates. Those attributes are outside Foundry's component tree and
    // React intentionally does not reconcile them. Limit suppression to the two document boundary
    // elements so genuine mismatches inside the application continue to surface.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint so a saved choice never flashes the default. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning className="min-h-screen bg-foundry-bg font-sans text-foundry-ink subpixel-antialiased">
        {children}
      </body>
    </html>
  );
}

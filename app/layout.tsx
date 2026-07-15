import type { Metadata } from "next";
import "./globals.css";

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
      <body suppressHydrationWarning className="min-h-screen bg-foundry-bg font-sans text-foundry-ink subpixel-antialiased">
        {children}
      </body>
    </html>
  );
}

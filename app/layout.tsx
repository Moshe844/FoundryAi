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
    <html lang="en">
      <body className="min-h-screen bg-foundry-bg font-sans text-foundry-ink subpixel-antialiased">
        {children}
      </body>
    </html>
  );
}

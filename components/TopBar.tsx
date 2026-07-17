import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export function TopBar() {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-overlay/10 bg-shade/70 px-4 py-3 backdrop-blur-2xl lg:px-6">
      <Link className="inline-flex min-w-0 items-center gap-3 text-inherit no-underline" href="/" aria-label="Foundry factory home">
        <span className="h-8 w-8 rounded-md border border-foundry-amber/40 bg-[linear-gradient(135deg,rgba(232,183,92,0.95),rgba(79,209,189,0.32))] shadow-[0_0_28px_rgba(232,183,92,0.22)]" />
        <span>
          <strong className="block text-[15px]">Foundry</strong>
          <small className="mt-0.5 block text-xs text-foundry-muted">AI Software Factory</small>
        </span>
      </Link>

      <div className="inline-flex items-center gap-3 lg:justify-self-end">
        <ThemeToggle />
        <div className="inline-flex items-center gap-2 text-xs font-bold text-foundry-muted" aria-label="Workspace status">
          <span className="h-2 w-2 rounded-full bg-foundry-teal shadow-[0_0_14px_rgb(var(--foundry-teal)/0.86)]" />
          <span className="hidden sm:inline">Factory online</span>
        </div>
      </div>
    </header>
  );
}

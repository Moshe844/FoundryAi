type StatusBarProps = {
  attachmentCount: number;
  statusText?: string;
};

export function StatusBar({ attachmentCount, statusText = "Ready" }: StatusBarProps) {
  return (
    <footer className="flex min-w-0 items-center gap-4 border-t border-overlay/10 bg-shade/70 px-4 py-2 text-[11px] font-bold text-foundry-muted backdrop-blur-2xl" aria-label="Status bar">
      <span className="min-w-0 truncate">Foundry / Workspace</span>
      <span className="min-w-0 truncate">{statusText}</span>
      <span className="min-w-0 truncate">Attachments: {attachmentCount}</span>
    </footer>
  );
}

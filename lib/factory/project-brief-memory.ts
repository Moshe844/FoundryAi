function normalized(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function acceptedProjectBriefMemory(brief: string, request: string, includeFollowUp: boolean) {
  const trimmed = request.trim();
  if (!trimmed) return brief;

  const additions: string[] = [];
  if (/^Resolved project decisions:/i.test(trimmed)) {
    const lines = trimmed.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const question = lines[index].match(/^\s*-\s+(.+?)\s*$/)?.[1]?.trim();
      const answer = lines[index + 1]?.match(/^\s*Answer:\s*(.+?)\s*$/i)?.[1]?.trim();
      if (question && answer) additions.push(`- Decision: ${question}\n  - Accepted answer: ${answer}`);
    }
  } else if (includeFollowUp) {
    additions.push(`- Accepted requirement: ${trimmed}`);
  }

  const unique = additions.filter((addition) => !normalized(brief).includes(normalized(addition)));
  if (!unique.length) return brief;
  const heading = "## Accepted project updates";
  const prefix = brief.trimEnd();
  return `${prefix}\n\n${prefix.includes(heading) ? "" : `${heading}\n\n`}${unique.join("\n")}\n`;
}

/** Extracts the exact optional instruction block from both current Markdown briefs and legacy line briefs. */
export function customInstructionsFromProjectBrief(brief: string) {
  const marker = /^## User-provided custom instructions\s*$/im.exec(brief);
  if (marker) {
    const remainder = brief.slice(marker.index + marker[0].length).replace(/^\r?\n/, "");
    const nextSection = remainder.search(/^##\s+/m);
    const section = (nextSection >= 0 ? remainder.slice(0, nextSection) : remainder).trim();
    if (section && !/^_?None provided\.?_?$/i.test(section)) return section;
  }
  const line = brief.match(/^Custom instructions:\s*(.+)$/im)?.[1]?.trim();
  return line && !/^(?:none|no additional instructions?)\.?$/i.test(line) ? line : "";
}

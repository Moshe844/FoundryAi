export type DeterministicSourceRepairInput = {
  sourcePath: string;
  content: string;
  diagnostic: string;
};

export type DeterministicSourceRepair = {
  content: string;
  reason: string;
  ruleId: string;
};

type DeterministicSourceRepairRule = (input: DeterministicSourceRepairInput) => DeterministicSourceRepair | undefined;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function diagnosticForSource(diagnostic: string, sourcePath: string, errorCode: string) {
  const fileName = sourcePath.split(/[\\/]/).at(-1);
  if (!fileName) return undefined;
  const sourcePattern = new RegExp(`${escapeRegExp(fileName)}\\((\\d+)\\s*,\\s*\\d+\\).*error\\s+${escapeRegExp(errorCode)}\\b`, "i");
  return diagnostic.split(/\r?\n/).find((line) => sourcePattern.test(line));
}

function diagnosticLineNumber(diagnostic: string, extensionPattern: string) {
  return Number(
    diagnostic.match(/\bLine\s+(\d+)\b/i)?.[1]
      ?? diagnostic.match(new RegExp(`${extensionPattern}\\((\\d+)\\s*,\\s*\\d+\\)`, "i"))?.[1],
  );
}

/**
 * WPF interprets an attribute value beginning with `{...}` as a markup extension. A generated-label
 * typo such as `Content="{ } Export JSON"` therefore becomes MC3074 even though ordinary visible
 * text was intended. This is deliberately narrow: the compiler must identify the unknown tag and
 * line, and that line must contain an empty-brace attribute whose first word is that exact tag.
 */
const repairWpfEmptyMarkupLabel: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  if (!/\.xaml$/i.test(sourcePath) || !/error\s+MC3074\b/i.test(diagnostic)) return undefined;
  const unknownTag = diagnostic.match(/The tag ['"]([^'"]+)['"] does not exist/i)?.[1];
  const lineNumber = diagnosticLineNumber(diagnostic, "\\.xaml");
  if (!unknownTag || !Number.isInteger(lineNumber) || lineNumber < 1) return undefined;

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const index = lineNumber - 1;
  const line = lines[index];
  if (line === undefined) return undefined;

  const attribute = /(\b[A-Za-z_][\w:.-]*\s*=\s*)(["'])\{\s*\}\s*([^"']*)\2/g;
  let changed = false;
  lines[index] = line.replace(attribute, (whole, prefix: string, quote: string, label: string) => {
    const firstWord = label.trim().match(/^([^\s]+)/)?.[1];
    if (!firstWord || firstWord.toLowerCase() !== unknownTag.toLowerCase()) return whole;
    changed = true;
    return `${prefix}${quote}${label.trimStart()}${quote}`;
  });
  if (!changed) return undefined;
  return {
    content: lines.join(newline),
    reason: `Removed an accidental empty XAML markup-extension prefix from the compiler-identified ${unknownTag} label on line ${lineNumber}.`,
    ruleId: "wpf-empty-markup-label",
  };
};

/** XML never treats backslash as a quote escape. When a compiler/parser identifies the exact line
 * as invalid XML, replace paired `\"...\"` inside that attribute with the XML `&quot;` entity. The
 * rule is source-format based (XAML/XML and related XML manifests), not tied to a project or label. */
const repairXmlBackslashEscapedQuotes: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  if (!/\.(?:xaml|xml|axml|csproj|fsproj|vbproj|props|targets)$/i.test(sourcePath)) return undefined;
  if (!/(?:error\s+MC3000|XML is not valid|XML parse|not well-formed)/i.test(diagnostic)) return undefined;
  const extension = sourcePath.match(/(\.[A-Za-z0-9]+)$/)?.[1]?.replace(".", "\\.") ?? "\\.xml";
  const lineNumber = diagnosticLineNumber(diagnostic, extension);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return undefined;

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const index = lineNumber - 1;
  const line = lines[index];
  if (line === undefined || !/[^\r\n]*\\"[^\r\n]*\\"/.test(line)) return undefined;
  const repairedLine = line.replace(/\\"/g, "&quot;");
  if (repairedLine === line) return undefined;
  lines[index] = repairedLine;
  return {
    content: lines.join(newline),
    reason: `Replaced invalid backslash-escaped XML quotes with &quot; on compiler-identified line ${lineNumber}.`,
    ruleId: "xml-backslash-escaped-quotes",
  };
};

/** A WPF project can intentionally use the Windows Forms folder/file dialogs, but the SDK does not
 * reference that desktop framework unless UseWindowsForms is enabled. Apply this only when the C#
 * compiler names the missing System.Windows.Forms namespace and the manifest is already a WPF app. */
const repairDotnetWindowsFormsInterop: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  if (!/\.csproj$/i.test(sourcePath)) return undefined;
  const missingWindowsFormsReference = /error\s+CS0234\b[^\r\n]*['"]Forms['"][^\r\n]*['"]System\.Windows['"]/i.test(diagnostic);
  const wpfFormsAmbiguity = /error\s+CS0104\b[^\r\n]*ambiguous reference between ['"]System\.Windows\.Forms\.[^'"]+['"] and ['"]System\.Windows(?:\.[^'"]+)?['"]/i.test(diagnostic)
    || /error\s+CS0104\b[^\r\n]*ambiguous reference between ['"]System\.Windows(?:\.[^'"]+)?['"] and ['"]System\.Windows\.Forms\.[^'"]+['"]/i.test(diagnostic);
  const wpfDrawingAmbiguity = /error\s+CS0104\b[^\r\n]*ambiguous reference between ['"]System\.Drawing\.[^'"]+['"] and ['"]System\.Windows\.Media\.[^'"]+['"]/i.test(diagnostic)
    || /error\s+CS0104\b[^\r\n]*ambiguous reference between ['"]System\.Windows\.Media\.[^'"]+['"] and ['"]System\.Drawing\.[^'"]+['"]/i.test(diagnostic);
  if (!missingWindowsFormsReference && !wpfFormsAmbiguity && !wpfDrawingAmbiguity) return undefined;
  if (!/<UseWPF>\s*true\s*<\/UseWPF>/i.test(content)) return undefined;

  let repaired = content;
  if (missingWindowsFormsReference && !/<UseWindowsForms>\s*true\s*<\/UseWindowsForms>/i.test(repaired)) {
    repaired = repaired.replace(
      /(<UseWPF>\s*true\s*<\/UseWPF>)/i,
      "$1\n    <UseWindowsForms>true</UseWindowsForms>",
    );
  }
  const namespacesToRemove = ["System.Windows.Forms", "System.Drawing"]
    .filter((namespace) => !new RegExp(`<Using\\s+Remove=["']${escapeRegExp(namespace)}["']\\s*/?>`, "i").test(repaired));
  if (namespacesToRemove.length) {
    const usingItems = namespacesToRemove.map((namespace) => `    <Using Remove="${namespace}" />`).join("\n");
    repaired = repaired.replace(/\s*<\/Project>\s*$/i, `\n  <ItemGroup>\n${usingItems}\n  </ItemGroup>\n</Project>`);
  }
  if (repaired === content) return undefined;
  return {
    content: repaired,
    reason: "Configured WPF/Windows Forms interoperability while removing conflicting WinForms and Drawing implicit namespaces identified by the compiler.",
    ruleId: "dotnet-enable-windows-forms",
  };
};

/** CS0176 identifies a static member that generated code called through an instance. The compiler
 * supplies both the declaring type/member and the exact source line, so the receiver can be
 * qualified without a model call or any project-specific symbol knowledge. */
const repairCsharpStaticMemberQualification: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  if (!/\.cs$/i.test(sourcePath)) return undefined;
  const sourceDiagnostic = diagnosticForSource(diagnostic, sourcePath, "CS0176");
  if (!sourceDiagnostic) return undefined;
  const lineNumber = Number(sourceDiagnostic.match(/\((\d+)\s*,\s*\d+\)/)?.[1]);
  const member = sourceDiagnostic.match(/Member ['"](.+)\.([A-Za-z_]\w*)\([^'"]*\)['"]/i);
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || !member) return undefined;

  const declaringType = member[1];
  const memberName = member[2];
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const index = lineNumber - 1;
  const line = lines[index];
  if (line === undefined) return undefined;

  const callPattern = new RegExp(`\\b(?:this\\.)?[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*\\.${escapeRegExp(memberName)}\\s*\\(`, "g");
  const matches = Array.from(line.matchAll(callPattern));
  if (matches.length !== 1) return undefined;
  const repairedLine = line.replace(callPattern, `${declaringType}.${memberName}(`);
  if (repairedLine === line) return undefined;
  lines[index] = repairedLine;
  return {
    content: lines.join(newline),
    reason: `Qualified compiler-identified static member ${declaringType}.${memberName} with its declaring type on line ${lineNumber}.`,
    ruleId: "csharp-static-member-qualification",
  };
};

/** CS7064 is emitted when a .NET manifest declares an application icon that is not on disk. The
 * manifest value and compiler path provide a complete deterministic contract: remove the invalid
 * optional metadata and its matching copy item rather than inventing a binary asset. */
const repairDotnetMissingApplicationIcon: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  if (!/\.csproj$/i.test(sourcePath) || !/error\s+CS7064\b/i.test(diagnostic)) return undefined;
  const missingPath = diagnostic.match(/Error opening icon file\s+(.+?)\s+--/i)?.[1]?.trim().replace(/\\/g, "/").toLowerCase();
  const declaredIcon = content.match(/<ApplicationIcon>\s*([^<]+?)\s*<\/ApplicationIcon>/i)?.[1]?.trim();
  if (!missingPath || !declaredIcon) return undefined;
  const normalizedDeclaration = declaredIcon.replace(/\\/g, "/").toLowerCase();
  if (missingPath !== normalizedDeclaration && !missingPath.endsWith(`/${normalizedDeclaration}`)) return undefined;

  let repaired = content.replace(/^\s*<ApplicationIcon>\s*[^<]+?\s*<\/ApplicationIcon>\s*\r?\n/im, "");
  const copiedIcon = new RegExp(`\\s*<None\\s+Update=["']${escapeRegExp(declaredIcon)}["']\\s*>[\\s\\S]*?<\\/None>\\s*`, "i");
  repaired = repaired.replace(copiedIcon, "\n");
  repaired = repaired.replace(/\s*<ItemGroup>\s*<\/ItemGroup>\s*/gi, "\n");
  if (repaired === content) return undefined;
  return {
    content: repaired,
    reason: `Removed compiler-identified missing application icon metadata for ${declaredIcon}.`,
    ruleId: "dotnet-remove-missing-application-icon",
  };
};

// Add only compiler-proven, semantics-preserving repairs here. This registry makes recovery
// extensible across ecosystems without filling the runtime with project-specific branches.
const RULES: DeterministicSourceRepairRule[] = [
  repairWpfEmptyMarkupLabel,
  repairXmlBackslashEscapedQuotes,
  repairDotnetWindowsFormsInterop,
  repairCsharpStaticMemberQualification,
  repairDotnetMissingApplicationIcon,
];

export function deterministicCompilerSourceRepair(input: DeterministicSourceRepairInput) {
  for (const rule of RULES) {
    const repair = rule(input);
    if (repair && repair.content !== input.content) return repair;
  }
  return undefined;
}

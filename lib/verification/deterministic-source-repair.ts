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

/** TS2783 proves an object property is overwritten by a later spread in the same literal. Removing
 * the earlier redundant shorthand preserves the JavaScript runtime value exactly while making the
 * compiler contract explicit; no domain knowledge or model judgment is required. */
const repairTypescriptOverwrittenProperty: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  if (!/\.[cm]?[jt]sx?$/i.test(sourcePath)) return undefined;
  const fileName = sourcePath.split(/[\\/]/).at(-1);
  if (!fileName) return undefined;
  const sourceLine = diagnostic.split(/\r?\n/).find((line) => line.includes(fileName) && /error\s+TS2783\b/i.test(line));
  const property = sourceLine?.match(/error\s+TS2783:\s+['"]([A-Za-z_$][\w$]*)['"]\s+is specified more than once/i)?.[1];
  const lineNumber = Number(sourceLine?.match(/\((\d+)\s*,\s*\d+\)/)?.[1] ?? sourceLine?.match(/:(\d+):\d+/)?.[1]);
  if (!property || !Number.isInteger(lineNumber) || lineNumber < 1) return undefined;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const index = lineNumber - 1;
  const line = lines[index];
  if (line === undefined) return undefined;
  const redundant = new RegExp(`\\{\\s*${escapeRegExp(property)}\\s*,\\s*(\\.\\.\\.[A-Za-z_$][\\w$]*)\\s*\\}`);
  const repairedLine = line.replace(redundant, "{ $1 }");
  if (repairedLine === line) return undefined;
  lines[index] = repairedLine;
  return {
    content: lines.join(newline),
    reason: `Removed compiler-proven redundant ${property} shorthand before a later object spread on line ${lineNumber}; the spread already supplied the runtime value.`,
    ruleId: "typescript-overwritten-property",
  };
};

/** Next.js 15 changed dynamic route-handler params from an object to a Promise. Its generated route
 * contract reports this unambiguously through ParamCheck<RouteContext>. Update only async API route
 * handlers that still use the old destructured shape, and await each params access in place. */
const repairNextAsyncRouteParams: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  const normalizedPath = sourcePath.replace(/\\/g, "/");
  const routeHandler = /(?:^|\/)app\/api\/.+\/route\.[cm]?[jt]sx?$/i.test(normalizedPath);
  const dynamicPage = /(?:^|\/)app\/.+\/\[[^/]+\]\/page\.[cm]?[jt]sx?$/i.test(normalizedPath);
  if (!routeHandler && !dynamicPage) return undefined;
  if (!/ParamCheck<RouteContext>|PageProps|__param_type__\.params[\s\S]{0,240}Promise<any>|params[\s\S]{0,160}missing the following properties from type ['"]Promise/i.test(diagnostic)) return undefined;
  const oldShape = /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*(\{[^{}]+\})\s*\}/g;
  if (!oldShape.test(content)) return undefined;
  let withAsyncShape = content.replace(oldShape, "{ params }: { params: Promise<$1> }");
  if (dynamicPage) withAsyncShape = withAsyncShape.replace(/\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/, "export default async function $1(");
  const repaired = withAsyncShape.replace(/\bparams\.([A-Za-z_$][\w$]*)/g, "(await params).$1");
  if (repaired === content) return undefined;
  return {
    content: repaired,
    reason: "Updated compiler-identified Next.js dynamic params to the async route/page contract and awaited each access.",
    ruleId: "next-async-route-params",
  };
};

/** Next.js 15 applies the same Promise contract to page searchParams. Generated type output names
 * PageProps rather than the app source, so the runtime maps that contract back here. */
const repairNextAsyncSearchParams: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  const normalizedPath = sourcePath.replace(/\\/g, "/");
  if (!/(?:^|\/)app\/.+\/page\.[cm]?[jt]sx?$/i.test(normalizedPath)) return undefined;
  const asyncSearchParamsDiagnostic = /(?:PageProps[\s\S]{0,500}searchParams|searchParams[\s\S]{0,500}PageProps)[\s\S]{0,400}(?:Promise<any>|missing the following properties from type ['"]Promise)/i.test(diagnostic);
  if (!asyncSearchParamsDiagnostic) return undefined;
  const oldShape = /\{\s*searchParams\s*\}\s*:\s*\{\s*searchParams\s*:\s*(\{[^{}]+\})\s*\}/g;
  if (!oldShape.test(content)) return undefined;
  let repaired = content.replace(oldShape, "{ searchParams }: { searchParams: Promise<$1> }");
  repaired = repaired.replace(/\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/, "export default async function $1(");
  repaired = repaired.replace(/\bsearchParams\.([A-Za-z_$][\w$]*)/g, "(await searchParams).$1");
  if (repaired === content) return undefined;
  return {
    content: repaired,
    reason: "Updated compiler-identified Next.js page searchParams to the asynchronous PageProps contract and awaited each access.",
    ruleId: "next-async-search-params",
  };
};

/** Prisma rejects Record<string, unknown> for JSON columns because unknown can contain values that
 * are not serializable. When the compiler names InputJsonValue and the source has exactly one such
 * accumulator, tighten it to Prisma.InputJsonObject without changing its runtime value. */
const repairPrismaJsonObjectType: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  if (!/\.[cm]?[jt]sx?$/i.test(sourcePath) || !/Record<string,\s*unknown>[\s\S]{0,260}(?:InputJsonValue|NullableJsonNullValueInput)/i.test(diagnostic)) return undefined;
  const declarations = Array.from(content.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*:\s*Record<string,\s*unknown>\s*=\s*\{/g));
  if (declarations.length !== 1) return undefined;
  const variable = declarations[0][1];
  let repaired = content.replace(
    new RegExp(`\\bconst\\s+${escapeRegExp(variable)}\\s*:\\s*Record<string,\\s*unknown>`),
    `const ${variable}: Record<string, Prisma.InputJsonValue | null>`,
  );
  if (!/\bPrisma\b[\s\S]*?from\s+['"]@prisma\/client['"]/m.test(repaired)) {
    repaired = `import type { Prisma } from '@prisma/client'\n${repaired}`;
  }
  if (repaired === content) return undefined;
  return {
    content: repaired,
    reason: `Tightened compiler-identified JSON accumulator ${variable} to mutable Prisma input values, including JSON null entries, so every assigned value satisfies the generated contract.`,
    ruleId: "prisma-json-input-object",
  };
};

/** Next.js 15 request helpers return Promises. When the compiler proves `.get` was called on the
 * Promise and the containing source already uses async functions, await the helper at assignment. */
const repairNextAsyncRequestStore: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  if (!/\.[cm]?[jt]sx?$/i.test(sourcePath) || !/Property ['"]get['"] does not exist on type ['"]Promise<Readonly(?:RequestCookies|Headers)>['"]/i.test(diagnostic)) return undefined;
  if (!/from\s+['"]next\/headers['"]/i.test(content)) return undefined;
  const repaired = content.replace(/(=\s*)(?!await\s+)(cookies|headers)\(\)/g, "$1await $2()");
  if (repaired === content) return undefined;
  return {
    content: repaired,
    reason: "Awaited compiler-identified Next.js request stores before using their synchronous-looking accessors.",
    ruleId: "next-async-request-store",
  };
};

/**
 * lucide-react removed its brand/social icons (Github, Twitter, Facebook, Linkedin, Youtube, etc.) for
 * trademark reasons, but models still import them — producing "'Github' is not exported from
 * 'lucide-react'" at build AND "has no exported member 'Github'" at typecheck, which the model's own
 * repair loop kept failing to resolve. The compiler names the exact missing icon(s); aliasing each to
 * `Circle` (a foundational lucide export that has always existed) resolves the import AND every
 * `<Github/>` usage in one edit, with no JSX surgery. The app builds and renders a neutral placeholder
 * icon; a later pass or the user can choose a nicer one. Deliberately scoped to lucide-react.
 */
const repairLucideRemovedIcon: DeterministicSourceRepairRule = ({ content, diagnostic }) => {
  if (!/lucide-react/.test(diagnostic)) return undefined;
  if (!/from\s+['"]lucide-react['"]/.test(content)) return undefined;
  const missing = new Set<string>();
  for (const match of diagnostic.matchAll(/['"]([A-Z][A-Za-z0-9]*)['"]\s+is not exported from/g)) missing.add(match[1]);
  for (const match of diagnostic.matchAll(/has no exported member\s+['"]([A-Z][A-Za-z0-9]*)['"]/g)) missing.add(match[1]);
  if (!missing.size) return undefined;

  const importPattern = /import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g;
  const fixed: string[] = [];
  const repaired = content.replace(importPattern, (whole, names: string) => {
    const rewritten = names
      .split(",")
      .map((token) => {
        const trimmed = token.trim();
        if (!trimmed) return token;
        // A named import is either `Github` or `Github as Foo`; the SOURCE name is what's missing.
        const source = trimmed.split(/\s+as\s+/)[0].trim();
        if (!missing.has(source)) return token;
        fixed.push(source);
        const alias = /\s+as\s+/.test(trimmed) ? trimmed.replace(/^[^\s]+/, "Circle") : `Circle as ${source}`;
        return ` ${alias}`;
      })
      .join(",");
    return whole.replace(names, rewritten);
  });
  if (repaired === content || !fixed.length) return undefined;
  return {
    content: repaired,
    reason: `Aliased ${fixed.length} lucide-react icon(s) that no longer exist (${fixed.join(", ")}) to the stable Circle icon, so the import and every usage compile and render a neutral placeholder.`,
    ruleId: "lucide-removed-icon-alias",
  };
};

/**
 * TypeScript's "Did you mean 'Y'?" property suggestion is a high-confidence, compiler-authored fix for
 * a misremembered member name — e.g. `info.message` on a nodemailer SentMessageInfo, where the compiler
 * itself says "Did you mean 'messageId'?". The model's repair loop kept re-emitting the same wrong
 * name; the compiler already knows the right one. Scoped to the exact diagnosed line and the exact
 * property access, and only when that access is unambiguous on the line, so it renames the member
 * without touching unrelated code.
 */
const repairDidYouMeanProperty: DeterministicSourceRepairRule = ({ sourcePath, content, diagnostic }) => {
  if (!/\.[cm]?[jt]sx?$/i.test(sourcePath)) return undefined;
  const suggestion = diagnostic.match(/Property ['"]([A-Za-z_$][\w$]*)['"] does not exist on type[^.]*\.\s*Did you mean ['"]([A-Za-z_$][\w$]*)['"]/i);
  if (!suggestion) return undefined;
  const [, wrong, right] = suggestion;
  if (wrong === right) return undefined;
  // Next.js/webpack report `file.ts:LINE:COL`; tsc reports `file.ts(LINE,COL)`. Accept both.
  const lineNumber = Number(
    diagnostic.match(/\.[cm]?[jt]sx?:(\d+):\d+/i)?.[1]
      ?? diagnostic.match(/\.[cm]?[jt]sx?\((\d+)\s*,\s*\d+\)/i)?.[1]
      ?? diagnostic.match(/\bLine\s+(\d+)\b/i)?.[1],
  );
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return undefined;

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const line = lines[lineNumber - 1];
  if (line === undefined) return undefined;
  // Only the property-access form `obj.wrong` — the `.wrong` preceded by an identifier, `)`, or `]` —
  // and only when it occurs exactly once on the line, so the rename is unambiguous.
  const accessPattern = new RegExp(`(?<=[\\w$)\\]])\\.${escapeRegExp(wrong)}\\b`, "g");
  const occurrences = line.match(accessPattern);
  if (!occurrences || occurrences.length !== 1) return undefined;
  lines[lineNumber - 1] = line.replace(accessPattern, `.${right}`);
  const repaired = lines.join(newline);
  if (repaired === content) return undefined;
  return {
    content: repaired,
    reason: `Applied the compiler's own suggestion on line ${lineNumber}: renamed the misremembered member .${wrong} to .${right}.`,
    ruleId: "did-you-mean-property",
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
  repairTypescriptOverwrittenProperty,
  repairNextAsyncRouteParams,
  repairNextAsyncSearchParams,
  repairPrismaJsonObjectType,
  repairNextAsyncRequestStore,
  repairLucideRemovedIcon,
  repairDidYouMeanProperty,
];

export function deterministicCompilerSourceRepair(input: DeterministicSourceRepairInput) {
  for (const rule of RULES) {
    const repair = rule(input);
    if (repair && repair.content !== input.content) return repair;
  }
  return undefined;
}

import type { OutcomeType } from "@/lib/mission-engine";

type VisualArtifactType = "dashboard" | "login" | "signup" | "diagram" | "landing" | "shopping" | "form" | "interface";
type LayoutVariant = "balanced" | "split" | "dense" | "focus";
type VisualStyleVariant = "classic" | "editorial" | "compact" | "splitFeature";

type DashboardCopy = {
  subject: string;
  navTitle: string;
  nav: string[];
  search: string;
  kpis: string[][];
  tableTitle: string;
  alertTableTitle: string;
  columns: string[];
  rows: string[][];
  alerts: string[];
};

type VisualFormSpec = {
  heading: string;
  heroTitle: string;
  fields: string[];
  action: string;
  secondary: string;
  footer: string;
};

export type VisualSpec = {
  artifactType: VisualArtifactType;
  purpose: string;
  title: string;
  sections: string[];
  components: string[];
  labels: string[];
  form?: VisualFormSpec;
  style: string;
  layout: LayoutVariant;
  visualStyleVariant: VisualStyleVariant;
  visualVariantIndex: number;
  revisionNotes: string;
};

export type VisualArtifact = {
  id: string;
  artifactId: string;
  missionId: string;
  title: string;
  kind: "sketch" | "mockup" | "wireframe" | "diagram";
  format: "svg";
  svg: string;
  prompt: string;
  sourcePrompt: string;
  revisionNotes: string;
  parentArtifactId?: string;
  version: number;
  variant: "desktop" | "mobile" | "dark";
  spec: VisualSpec;
  createdAt: string;
};

type VisualOptions = {
  previous?: VisualArtifact;
  outcome: OutcomeType;
  missionId?: string;
  objective?: string;
  revisionNotes?: string;
};

export function createVisualArtifact(prompt: string, options: VisualOptions): VisualArtifact {
  const createdAt = new Date().toISOString();
  const previous = options.previous;
  const version = (previous?.version ?? 0) + 1;
  const variant = resolveVariant(prompt, previous);
  const kind = resolveKind(prompt, options.outcome);
  const designPrompt = mergeVisualPrompt(prompt, options.objective, previous);
  const spec = createVisualSpec(designPrompt, prompt, kind, version, previous);
  const svg = renderVisualSpec(spec, kind, variant, version);
  const artifactId = previous?.artifactId ?? `visual-${Date.now()}-${Math.round(Math.random() * 10000)}`;

  return {
    id: `${artifactId}-v${version}`,
    artifactId,
    missionId: options.missionId ?? previous?.missionId ?? "",
    title: spec.title,
    kind,
    format: "svg",
    svg,
    prompt: designPrompt,
    sourcePrompt: prompt,
    revisionNotes: options.revisionNotes ?? spec.revisionNotes,
    parentArtifactId: previous?.id,
    version,
    variant,
    spec,
    createdAt,
  };
}

export function isVisualOutcome(outcome: OutcomeType) {
  return outcome === "sketch" || outcome === "mockup" || outcome === "diagram";
}

export function isExplicitVisualArtifactRequest(message: string) {
  if (isTextVisualFormatRequest(message)) return false;

  const text = message.toLowerCase();
  if (/\b(diagram|flowchart|architecture diagram|er diagram|entity relationship|system flow)\b/i.test(text)) return true;
  if (/\b(generate|create|make|produce)\b.*\b(image|picture|visual|preview|mockup|wireframe)\b/i.test(text)) return true;
  if (/\b(image|picture|visual|preview)\b.*\b(for|of)\b.*\b(page|screen|ui|form|dashboard|website|site|app|layout)\b/i.test(text)) return true;
  if (hasVisualIntent(message, ["draw", "sketch", "wireframe", "mockup", "visualize", "image", "picture", "preview"])) return true;
  if (/\bdesign\b/i.test(text) && /\b(page|screen|ui|ux|interface|layout|mockup|wireframe|dashboard|website|site|landing|form|visual)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function isTextVisualFormatRequest(message: string) {
  const text = message.toLowerCase();

  return /\b(ascii|ascii art|text only|plain text|monospace|terminal drawing|character drawing|using characters|using text)\b/i.test(text);
}

export function shouldReviseExistingVisual(message: string) {
  const text = message.toLowerCase();
  if (/\b(regenerate|customize|make|change|add|remove|update|revise|redo|rework|export|download)\b/i.test(text)) {
    return true;
  }
  if (/\b(mobile version|dark theme|darker version|cleaner version|new variant|different variant)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function isVisualFollowUp(message: string) {
  return (
    hasVisualIntent(message) ||
    /\b(ugly|better|cleaner|polished|form|fields?|dashboard|table|chart|kpi|alert|search|filter|make it|change|add|remove|darker|dark|mobile|regenerate|variant|colors?|pricing|cards?|layout|theme|export)\b/i.test(
      message,
    )
  );
}

function mergeVisualPrompt(prompt: string, objective?: string, previous?: VisualArtifact) {
  if (!previous) return prompt;
  return [objective, previous.spec.purpose, previous.spec.components.join(", "), prompt].filter(Boolean).join("\nRevision request: ");
}

function createVisualSpec(fullPrompt: string, sourcePrompt: string, kind: VisualArtifact["kind"], version: number, previous?: VisualArtifact): VisualSpec {
  const text = fullPrompt.toLowerCase();
  const revisionText = sourcePrompt.toLowerCase();
  const previousSpec = previous?.spec;
  const artifactType = resolveArtifactType(text, kind, previousSpec?.artifactType);
  const layout = resolveLayout(revisionText, version, previousSpec?.layout);
  const style = resolveStyle(text, revisionText, previousSpec?.style);
  const visualVariantIndex = resolveVisualVariantIndex(revisionText, version, previousSpec?.visualVariantIndex);
  const visualStyleVariant = resolveVisualStyleVariant(revisionText, visualVariantIndex);
  const base = specForType(artifactType, text);
  const sameArtifactFamily = previousSpec?.artifactType === artifactType;
  const revised = previousSpec && sameArtifactFamily && isRevisionRequest(revisionText) ? mergeSpec(previousSpec, base, revisionText) : base;

  return {
    ...revised,
    artifactType,
    title: titleForSpec(artifactType, text, kind),
    layout,
    style,
    visualStyleVariant,
    visualVariantIndex,
    revisionNotes: previous ? sourcePrompt : "Initial visual artifact",
  };
}

function resolveArtifactType(text: string, kind: VisualArtifact["kind"], previous?: VisualArtifactType): VisualArtifactType {
  if (kind === "diagram" || /\b(diagram|flowchart|architecture|er diagram|entity relationship|system flow)\b/i.test(text)) return "diagram";
  if (/\b(inventory|stock|warehouse|dashboard|admin|analytics|kpi|table|metrics)\b/i.test(text)) return "dashboard";
  if (/\b(sign-?in|signin|login|log in)\b/i.test(text)) return "login";
  if (isSpecificFormRequest(text)) return "form";
  if (/\b(signup|sign up|registration|create account|join)\b/i.test(text)) return "signup";
  if (/\b(shop|shopping|store|ecommerce|commerce|catalog|product|products|cart|checkout|collection|retail)\b/i.test(text)) return "shopping";
  if (/\b(landing|hero|marketing|homepage)\b/i.test(text)) return "landing";
  if (/\b(form|fields?|input)\b/i.test(text)) return "form";
  return previous ?? "interface";
}

function isSpecificFormRequest(text: string) {
  const normalized = normalizeCompoundFormWords(text);
  return /\b(payment|checkout|billing|card|invoice|contact|support|shipping|address|application|feedback|survey|intake|order)\s+(form|screen|page|flow|ui)\b/i.test(
    normalized,
  );
}

function normalizeCompoundFormWords(text: string) {
  return text
    .replace(/\b(payment|checkout|billing|contact|support|shipping|address|application|feedback|survey|intake|order)form\b/gi, "$1 form")
    .replace(/\b(card)form\b/gi, "$1 form");
}

function visualSubject(text: string, artifactType: VisualArtifactType) {
  const normalized = normalizeCompoundFormWords(text).toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const typeWords = {
    dashboard: "dashboard",
    shopping: "(?:shopping page|shop page|store page|product page|catalog page|ecommerce page|website|site|store|shop|catalog)",
    landing: "(?:landing page|homepage|hero page)",
    form: "form",
    login: "(?:login page|sign in page|signin page)",
    signup: "(?:signup page|sign up page|registration page)",
    diagram: "diagram",
    interface: "(?:interface|screen|page|layout)",
  }[artifactType];
  const before = normalized.match(new RegExp(`\\b([a-z][a-z0-9-]*(?:\\s+[a-z][a-z0-9-]*){0,3})\\s+${typeWords}\\b`, "i"))?.[1];
  const after = normalized.match(new RegExp(`\\b${typeWords}\\s+(?:for|about|of)\\s+([a-z][a-z0-9-]*(?:\\s+[a-z][a-z0-9-]*){0,3})\\b`, "i"))?.[1];
  const candidate = (after || before || extractVisualConcept(normalized) || artifactType)
    .replace(/\b(can|you|please|draw|sketch|sktch|sektch|create|make|design|nice|clean|modern|simple|professional|premium|page|website|site|app)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return toTitle(candidate || artifactType);
}

function extractVisualConcept(text: string) {
  const words = text
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !visualConceptStopWords.has(word))
    .filter((word) => !/^(draw|sketch|sktch|sektch|wireframe|mockup|design|visualize|layout|create|make|show|generate|nice|clean|modern|simple|professional|premium)$/i.test(word));

  if (!words.length) return "";

  const anchors = words.filter((word) => !/^(page|screen|interface|website|site|app|application|view|ui|ux)$/i.test(word));
  return (anchors.length ? anchors : words).slice(0, 4).join(" ");
}

const visualConceptStopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "be",
  "can",
  "for",
  "from",
  "i",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "that",
  "the",
  "this",
  "to",
  "want",
  "with",
  "you",
]);

function dashboardSubject(text: string) {
  const beforeDashboard = text.match(/\b(?:nice|clean|modern|simple|professional|premium)?\s*([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2})\s+dashboard\b/i)?.[1];
  const afterFor = text.match(/\bdashboard\s+(?:for|about|of)\s+([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2})\b/i)?.[1];
  const candidate = (beforeDashboard || afterFor || "operations")
    .replace(/\b(can|you|sketch|draw|create|make|design|nice|clean|modern|simple|professional|premium|admin|analytics|kpi)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return toTitle(candidate || "operations");
}

function shoppingCopy(subject: string) {
  const product = productNounFromSubject(subject);
  const lower = product.toLowerCase();

  return {
    title: `${subject} Shopping Page`,
    purpose: `Help shoppers browse, filter, compare, and buy ${subject.toLowerCase()}.`,
    nav: ["New arrivals", "Best sellers", "Collections", "Sale"],
    filters: [`${product} type`, "Size", "Color", "Price", "Brand"],
    hero: `Find your next ${lower}`,
    search: `Search ${subject.toLowerCase()}...`,
    products: [
      [`${product} One`, "$89", "Sizes 7-12"],
      [`${product} Runner`, "$124", "4 colors"],
      [`${product} Classic`, "$76", "Best seller"],
      [`${product} Trail`, "$132", "New"],
    ],
  };
}

type FormCopy = {
  title: string;
  heading: string;
  heroTitle: string;
  purpose: string;
  fields: string[];
  action: string;
  secondary: string;
  footer: string;
  sections: string[];
  components: string[];
  style: string;
};

function formCopyFromText(text: string, type: VisualArtifactType): FormCopy {
  const normalized = normalizeCompoundFormWords(text).toLowerCase();

  if (type === "login") {
    return {
      title: "Login Page Sketch",
      heading: "Sign in",
      heroTitle: "Welcome back",
      purpose: "Let an existing user sign in quickly and recover access if needed.",
      fields: ["Email address", "Password"],
      action: "Sign in",
      secondary: "Forgot password?",
      footer: "Need an account? Create one",
      sections: ["Brand/header", "Sign-in form", "Recovery link", "Account creation link"],
      components: ["Email field", "Password field", "Sign in button", "Forgot password link", "Create account link"],
      style: "focused secure",
    };
  }

  if (type === "signup") {
    const subject = visualSubject(text, type);
    return {
      title: `${subject === "Signup" ? "" : `${subject} `}Signup Page Sketch`.trim(),
      heading: "Sign up",
      heroTitle: "Create your account",
      purpose: "Help a new user create an account with low friction.",
      fields: ["Full name", "Email address", "Password", "Choose plan"],
      action: "Create account",
      secondary: "Start membership",
      footer: "Already have an account? Sign in",
      sections: ["Value statement", "Signup form", "Plan selection", "Account action"],
      components: ["Name field", "Email field", "Password field", "Plan selector", "Create account button"],
      style: "welcoming conversion-focused",
    };
  }

  if (/\b(payment|checkout|billing|card|invoice|pay)\b/i.test(normalized)) {
    const action = inferFormActionLabel(normalized, "Pay now");
    return {
      title: "Payment Form Sketch",
      heading: "Payment details",
      heroTitle: "Secure checkout",
      purpose: "Collect payment details clearly and guide the user through a secure payment action.",
      fields: ["Cardholder name", "Card number", "Expiration", "CVV", "Billing ZIP"],
      action,
      secondary: "Secure payment",
      footer: "Encrypted payment details",
      sections: ["Payment summary", "Card details", "Billing verification", "Payment action"],
      components: ["Amount summary", "Cardholder field", "Card number field", "Expiration field", "CVV field", "Billing ZIP field", `${action} button`],
      style: "secure transaction",
    };
  }

  if (/\b(contact|support|message|lead)\b/i.test(normalized)) {
    return {
      title: "Contact Form Sketch",
      heading: "Contact us",
      heroTitle: "Send a message",
      purpose: "Collect a clear message and contact details so the team can respond.",
      fields: ["Full name", "Email address", "Subject", "Message"],
      action: "Send message",
      secondary: "Response within one business day",
      footer: "We will never share your contact details",
      sections: ["Contact details", "Message body", "Submit action"],
      components: ["Name field", "Email field", "Subject field", "Message field", "Send button"],
      style: "approachable service",
    };
  }

  if (/\b(shipping|address|delivery)\b/i.test(normalized)) {
    return {
      title: "Address Form Sketch",
      heading: "Shipping address",
      heroTitle: "Delivery details",
      purpose: "Capture shipping information with a simple address flow.",
      fields: ["Full name", "Street address", "City", "State", "ZIP code"],
      action: "Save address",
      secondary: "Use as default address",
      footer: "Review delivery details before continuing",
      sections: ["Recipient", "Address fields", "Delivery action"],
      components: ["Name field", "Street field", "City field", "State field", "ZIP field", "Save address button"],
      style: "clear utility",
    };
  }

  const subject = visualSubject(normalized, "form");
  return {
    title: `${subject === "Form" ? "Form" : subject} Sketch`,
    heading: subject === "Form" ? "Form details" : subject,
    heroTitle: `${subject === "Form" ? "Submit" : subject} flow`,
    purpose: `Collect the required ${subject.toLowerCase()} information with a clear, focused form.`,
    fields: ["Name", "Email", "Details"],
    action: "Submit",
    secondary: "Review before submitting",
    footer: "Required fields are kept clear",
    sections: ["Form heading", "Input fields", "Supporting note", "Submit action"],
    components: ["Name field", "Email field", "Details field", "Submit button"],
    style: "clean professional",
  };
}

function inferFormActionLabel(text: string, fallback: string) {
  const normalized = normalizeLooseText(text);
  const verb = normalized.match(/\b(process|submit|send|save|confirm|complete|continue|start|create|pay)\b/)?.[1];
  const target =
    normalized.match(/\b(?:process|submit|send|save|confirm|complete|continue|start|create|pay)\s+(?:a|an|the)?\s*([a-z][a-z0-9-]*)\b/)?.[1] ??
    normalized.match(/\b(sale|sales|order|invoice|checkout|payment|registration|request|message|application)\b/)?.[1];

  if (!verb) return fallback;

  const normalizedTarget = target ? singularize(target) : "";
  if (verb === "pay" && normalizedTarget) return `Pay ${normalizedTarget}`;
  if (verb === "continue") return normalizedTarget ? `Continue to ${normalizedTarget}` : "Continue";
  if (verb === "complete") return normalizedTarget ? `Complete ${normalizedTarget}` : "Complete";
  if (verb === "create") return normalizedTarget ? `Create ${normalizedTarget}` : "Create";

  return normalizedTarget ? `${toTitle(verb)} ${normalizedTarget}` : toTitle(verb);
}

function formCopyFromSpec(spec: VisualSpec): FormCopy {
  if (spec.form) {
    return {
      title: spec.title || "Form Sketch",
      heading: spec.form.heading,
      heroTitle: spec.form.heroTitle,
      purpose: spec.purpose,
      fields: spec.form.fields,
      action: spec.form.action,
      secondary: spec.form.secondary,
      footer: spec.form.footer,
      sections: spec.sections,
      components: spec.components,
      style: spec.style,
    };
  }

  if (spec.artifactType === "login") return formCopyFromText(spec.title, "login");
  if (spec.artifactType === "signup") return formCopyFromText(spec.title, "signup");

  const action = spec.labels.find((label) => /\b(pay|process|submit|send|save|continue|create|sign in|sign up)\b/i.test(label)) ?? "Submit";
  const title = spec.title || "Form Sketch";
  const heading = spec.labels[0] && !/\b(pay|process|submit|send|save)\b/i.test(spec.labels[0]) ? spec.labels[0] : title.replace(/\s+Sketch$/i, "");
  const reserved = new Set([heading, action]);
  const fields = spec.labels
    .slice(1)
    .filter((label) => !reserved.has(label))
    .filter((label) => !/\b(?:secure|review|forgot|default|response|membership|encrypted|never|required|delivery)\b/i.test(label))
    .filter((label) =>
      /\b(name|email|password|card|number|expiration|cvv|zip|postal|address|street|city|state|province|subject|message|details|plan|phone|amount|date|country|company|note|notes|reference|description|invoice)\b/i.test(
        label,
      ),
    );

  return {
    title,
    heading,
    heroTitle: title.replace(/\s+Sketch$/i, ""),
    purpose: spec.purpose,
    fields: fields.length ? fields : ["Name", "Email", "Details"],
    action,
    secondary: spec.labels.find((label) => label !== action && /\b(?:secure|review|forgot|default|response|membership)\b/i.test(label)) ?? "Review before submitting",
    footer: spec.labels.find((label) => /\b(?:account|encrypted|never|required|delivery)\b/i.test(label)) ?? "Complete the required details",
    sections: spec.sections,
    components: spec.components,
    style: spec.style,
  };
}

function formSpecFromCopy(copy: FormCopy): VisualFormSpec {
  return {
    heading: copy.heading,
    heroTitle: copy.heroTitle,
    fields: copy.fields,
    action: copy.action,
    secondary: copy.secondary,
    footer: copy.footer,
  };
}

function productNounFromSubject(subject: string) {
  const words = subject
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^(store|shop|shopping|page|website|site|ecommerce|commerce|catalog|market|marketplace)$/i.test(word));
  const product = words.at(-1) ?? "Product";

  return singularize(product);
}

function dashboardLabels(subject: string) {
  return [subject, "Total", "Active", "Alerts", `Search ${subject.toLowerCase()}`, "Status", "Last updated"];
}

function dashboardCopy(spec: VisualSpec): DashboardCopy {
  const subject = spec.labels[0] || spec.title.replace(/\s+Dashboard$/i, "");
  const subjectLower = subject.toLowerCase();
  const singular = singularize(subject);

  return {
    subject,
    navTitle: subject,
    nav: ["Overview", `${singular} list`, "Activity", "Settings", "Reports"],
    search: `Search ${subjectLower}...`,
    kpis: [
      [`Total ${singular.toLowerCase()}s`, "1,248"],
      ["Active", "86"],
      ["Needs review", "14"],
      ["This week", "+12%"],
    ],
    tableTitle: `${subject} overview`,
    alertTableTitle: `${subject} alerts`,
    columns: ["ID", singular, "Status"],
    rows: [
      [`${initials(subject)}-1042`, `Primary ${singular.toLowerCase()}`, "Live", "OK"],
      [`${initials(subject)}-2201`, `Queued ${singular.toLowerCase()}`, "Review", "Watch"],
      [`${initials(subject)}-3318`, `Priority ${singular.toLowerCase()}`, "Blocked", "Alert"],
      [`${initials(subject)}-4420`, `New ${singular.toLowerCase()}`, "Draft", "New"],
    ],
    alerts: [`Priority ${singular.toLowerCase()} needs review`, `${subject} activity increased`, "Status changed recently"],
  };
}

function singularize(value: string) {
  const word = value.split(/\s+/).at(-1) ?? value;
  return word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word;
}

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 3) || "A"
  );
}

function specForType(type: VisualArtifactType, text: string): VisualSpec {
  if (type === "dashboard") {
    const subject = dashboardSubject(text);
    const labels = dashboardLabels(subject);
    return {
      artifactType: type,
      purpose: `Monitor ${subject.toLowerCase()} performance, activity, alerts, and operational health.`,
      title: `${subject} Dashboard`,
      sections: ["Sidebar", "KPI summary", "Search and filters", "Primary table", "Alerts", "Activity or chart panel"],
      components: ["Sidebar navigation", "KPI cards", "Search bar", "Filter chips", `${subject} table`, "Alerts panel", "Trend chart"],
      labels,
      style: "calm professional",
      layout: "dense",
      visualStyleVariant: "classic",
      visualVariantIndex: 0,
      revisionNotes: "Initial dashboard visual artifact",
    };
  }

  if (type === "shopping") {
    const subject = visualSubject(text, type);
    const copy = shoppingCopy(subject);

    return {
      artifactType: type,
      purpose: copy.purpose,
      title: copy.title,
      sections: ["Store header", "Hero/featured collection", "Search and sort", "Filter sidebar", "Product grid", "Cart action"],
      components: ["Store navigation", "Search bar", "Sort control", "Filter sidebar", "Product cards", "Image placeholders", "Price labels", "Size/color chips", "Cart button"],
      labels: [subject, copy.hero, copy.search, ...copy.filters, "Add to cart", "Checkout"],
      style: "retail polished",
      layout: "split",
      visualStyleVariant: "classic",
      visualVariantIndex: 0,
      revisionNotes: "Initial shopping visual artifact",
    };
  }

  if (type === "login") {
    const copy = formCopyFromText(text, type);
    return {
      artifactType: type,
      purpose: copy.purpose,
      title: copy.title,
      sections: copy.sections,
      components: copy.components,
      labels: [copy.heading, ...copy.fields, copy.secondary, copy.action, copy.footer],
      form: formSpecFromCopy(copy),
      style: copy.style,
      layout: "focus",
      visualStyleVariant: "classic",
      visualVariantIndex: 0,
      revisionNotes: "Initial login visual artifact",
    };
  }

  if (type === "signup") {
    const copy = formCopyFromText(text, type);
    return {
      artifactType: type,
      purpose: copy.purpose,
      title: copy.title,
      sections: copy.sections,
      components: copy.components,
      labels: [copy.heading, ...copy.fields, copy.secondary, copy.action, copy.footer],
      form: formSpecFromCopy(copy),
      style: copy.style,
      layout: "split",
      visualStyleVariant: "classic",
      visualVariantIndex: 0,
      revisionNotes: "Initial signup visual artifact",
    };
  }

  if (type === "form") {
    const copy = formCopyFromText(text, type);
    return {
      artifactType: type,
      purpose: copy.purpose,
      title: copy.title,
      sections: copy.sections,
      components: copy.components,
      labels: [copy.heading, ...copy.fields, copy.secondary, copy.action, copy.footer],
      form: formSpecFromCopy(copy),
      style: copy.style,
      layout: "focus",
      visualStyleVariant: "classic",
      visualVariantIndex: 0,
      revisionNotes: "Initial form visual artifact",
    };
  }

  if (type === "diagram") {
    return {
      artifactType: type,
      purpose: "Show the system or process flow clearly.",
      title: "Architecture Diagram",
      sections: ["Flow nodes", "Directional relationships", "Boundary context"],
      components: ["Client", "API", "Service", "Database", "External system"],
      labels: extractFlowLabels(text),
      style: "technical clean",
      layout: "balanced",
      visualStyleVariant: "classic",
      visualVariantIndex: 0,
      revisionNotes: "Initial diagram visual artifact",
    };
  }

  if (type === "landing") {
    return {
      artifactType: type,
      purpose: "Introduce the offer and guide users to the primary call to action.",
      title: "Landing Page Concept",
      sections: ["Hero", "Benefits", "Social proof", "Primary action"],
      components: ["Headline", "Supporting copy", "CTA button", "Feature cards", "Preview panel"],
      labels: ["Launch faster", "See features", "Get started", "Trusted workflow"],
      style: "premium editorial",
      layout: "split",
      visualStyleVariant: "classic",
      visualVariantIndex: 0,
      revisionNotes: "Initial landing visual artifact",
    };
  }

  const subject = visualSubject(text, type);
  return {
    artifactType: type,
    purpose: `Lay out a ${subject.toLowerCase()} experience clearly.`,
    title: `${subject} Sketch`,
    sections: [`${subject} opening area`, `${subject} primary content`, `${subject} supporting details`, `${subject} action area`],
    components: [`${subject} header`, `${subject} featured content`, `${subject} detail cards`, `${subject} primary action`],
    labels: [subject, `${subject} overview`, "Key details", "Continue"],
    style: "clean professional",
    layout: "balanced",
    visualStyleVariant: "classic",
    visualVariantIndex: 0,
    revisionNotes: "Initial interface visual artifact",
  };
}

function mergeSpec(previous: VisualSpec, incoming: VisualSpec, revisionText: string): VisualSpec {
  const components = new Set(previous.components);
  const labels = new Set(previous.labels);
  const sections = new Set(previous.sections);
  const normalizedRevision = normalizeLooseText(revisionText);
  const currentForm = previous.form ?? (previous.artifactType === "form" || previous.artifactType === "login" || previous.artifactType === "signup" ? formSpecFromCopy(formCopyFromSpec(previous)) : undefined);
  const requestedFields = requestedFormFieldsFromRevision(normalizedRevision);
  const nextForm = currentForm
    ? {
        ...currentForm,
        fields: mergeUniqueFields(
          currentForm.fields,
          [
            ...(mentionsMoreFields(normalizedRevision) ? fieldsForAdditionalFormInputs(previous) : []),
            ...requestedFields,
          ],
        ),
        action: inferUpdatedActionLabel(normalizedRevision, currentForm.action),
      }
    : undefined;

  if (/\b(low stock|low-stock|reorder)\b/i.test(revisionText)) {
    components.add("Low-stock table");
    components.add("Reorder alert panel");
    labels.add("Low-stock items");
    labels.add("Reorder now");
    sections.add("Low-stock review");
  }
  if (/\b(search|filter)\b/i.test(revisionText)) {
    components.add("Search bar");
    components.add("Filter controls");
  }
  if (/\b(chart|graph|trend)\b/i.test(revisionText)) {
    components.add("Trend chart");
    labels.add("Stock trend");
  }
  if (/\b(email)\b/i.test(revisionText)) labels.add("Email address");
  if (/\b(password)\b/i.test(revisionText)) labels.add("Password");
  if (/\b(forgot)\b/i.test(revisionText)) labels.add("Forgot password?");
  if (/\b(plan|pricing)\b/i.test(revisionText)) components.add("Plan selector");
  if (/\b(filter|sidebar)\b/i.test(revisionText)) {
    components.add("Filter sidebar");
    sections.add("Filter sidebar");
  }
  if (/\b(product|card|cards|bigger|larger)\b/i.test(revisionText)) {
    components.add("Large product cards");
    labels.add("Featured product");
  }
  if (previous.artifactType === "form" && mentionsMoreFields(normalizedRevision)) {
    fieldsForAdditionalFormInputs(previous).forEach((field) => {
      labels.add(field);
      components.add(`${field} field`);
    });
    sections.add("Additional details");
  }
  if (previous.artifactType === "form") {
    requestedFields.forEach((field) => {
      labels.add(field);
      components.add(`${field} field`);
    });
    if (requestedFields.length > 0) {
      sections.add("Requested fields");
    }
  }
  nextForm?.fields.forEach((field) => {
    labels.add(field);
    components.add(`${field} field`);
  });
  if (nextForm) {
    labels.add(nextForm.heading);
    labels.add(nextForm.secondary);
    labels.add(nextForm.action);
    labels.add(nextForm.footer);
  }
  Array.from(revisionText.matchAll(/\badd\s+(?:a|an|the)?\s*([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,3})/gi)).forEach((match) => {
    const value = toTitle(match[1].trim());
    if (value && !/\b(few|more|field|fields|also|center|wording|button)\b/i.test(value)) {
      components.add(value);
      labels.add(value);
    }
  });

  return {
    ...previous,
    purpose: incoming.purpose || previous.purpose,
    sections: Array.from(sections),
    components: Array.from(components),
    labels: Array.from(labels),
    form: nextForm,
  };
}

function mergeUniqueFields(existing: string[], incoming: string[]) {
  const fields = new Map<string, string>();

  [...existing, ...incoming]
    .map((field) => field.trim())
    .filter(Boolean)
    .forEach((field) => fields.set(normalizeFieldKey(field), field));

  return Array.from(fields.values());
}

function normalizeFieldKey(field: string) {
  return field.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inferUpdatedActionLabel(text: string, current: string) {
  const inferred = inferFormActionLabel(text, "");
  return inferred || current;
}

function normalizeLooseText(text: string) {
  return text
    .toLowerCase()
    .replace(/\bafew\b/g, "a few")
    .replace(/\bmoe\b/g, "more")
    .replace(/\baldo\b/g, "also")
    .replace(/\bcnetere\b/g, "center")
    .replace(/\bcreata\b/g, "create")
    .replace(/\bfileds\b/g, "fields")
    .replace(/\bfiledls\b/g, "fields")
    .replace(/\bfilds\b/g, "fields")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentionsMoreFields(text: string) {
  const words = text.split(/\s+/).filter(Boolean);
  const hasFieldWord = words.some((word) => word === "field" || word === "fields" || editDistance(word, "field") <= 2 || editDistance(word, "fields") <= 2);
  const hasMoreWord = words.some((word) => word === "more" || word === "additional" || word === "extra" || word === "few" || editDistance(word, "more") <= 1);

  return hasFieldWord && hasMoreWord;
}

function fieldsForAdditionalFormInputs(spec: VisualSpec) {
  const text = `${spec.title} ${spec.purpose} ${spec.labels.join(" ")}`.toLowerCase();

  if (/\b(payment|checkout|billing|card|invoice|pay)\b/.test(text)) {
    return ["Amount", "Invoice number", "Customer email", "Phone number"];
  }
  if (/\b(contact|support|message|lead)\b/.test(text)) {
    return ["Phone number", "Company", "Priority", "Preferred contact time"];
  }
  if (/\b(shipping|address|delivery)\b/.test(text)) {
    return ["Apartment or suite", "Country", "Delivery notes", "Phone number"];
  }

  return ["Phone number", "Reference", "Date", "Notes"];
}

function requestedFormFieldsFromRevision(text: string) {
  const fields = new Set<string>();
  const requestedText = text
    .replace(/\b(customize|version|theme|layout|colors|device|size|notes|fields|field|add|include|create|make|also|more|few|some|with|and|etc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const fieldGroups: Array<[string[], string[]]> = [
    [["address", "billing address", "shipping address"], ["Street address", "City", "State", "ZIP code"]],
    [["street"], ["Street address"]],
    [["city"], ["City"]],
    [["state", "province"], ["State"]],
    [["zip", "postal"], ["ZIP code"]],
    [["country"], ["Country"]],
    [["phone", "mobile"], ["Phone number"]],
    [["email"], ["Email address"]],
    [["name"], ["Full name"]],
    [["company", "business"], ["Company"]],
    [["amount", "total"], ["Amount"]],
    [["invoice"], ["Invoice number"]],
    [["reference"], ["Reference"]],
    [["date"], ["Date"]],
    [["notes", "note", "memo"], ["Notes"]],
  ];

  fieldGroups.forEach(([triggers, values]) => {
    if (triggers.some((trigger) => requestedText.includes(trigger))) {
      values.forEach((value) => fields.add(value));
    }
  });

  requestedText
    .split(/\s*(?:,|\/|\+|\band\b)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2 && part.length < 32)
    .filter((part) => !/\b(button|wording|center|green|blue|dark|light|theme|layout|desktop|mobile)\b/.test(part))
    .forEach((part) => {
      if (fieldGroups.some(([triggers]) => triggers.some((trigger) => part.includes(trigger)))) return;
      fields.add(toTitle(part));
    });

  return Array.from(fields);
}

function isRevisionRequest(text: string) {
  return /\b(regenerate|customize|make|change|add|remove|cleaner|darker|dark|mobile|layout|theme|fields?|table|chart|form|ugly|better)\b/i.test(text);
}

function resolveLayout(text: string, version: number, previous?: LayoutVariant): LayoutVariant {
  if (/\b(dense|table|admin)\b/i.test(text)) return "dense";
  if (/\b(split|side by side|hero)\b/i.test(text)) return "split";
  if (/\b(center|focused|simple)\b/i.test(text)) return "focus";
  if (/\b(regenerate|variant)\b/i.test(text)) return rotateLayout(previous ?? "balanced", version);
  return previous ?? (version % 2 === 0 ? "split" : "balanced");
}

function rotateLayout(current: LayoutVariant, version: number): LayoutVariant {
  const layouts: LayoutVariant[] = ["balanced", "split", "dense", "focus"];
  const index = layouts.indexOf(current);
  return layouts[(index + version) % layouts.length];
}

function resolveStyle(text: string, revisionText: string, previous?: string) {
  if (/\b(dark|darker)\b/i.test(revisionText)) return "dark premium";
  if (/\b(clean|cleaner|minimal)\b/i.test(revisionText)) return "minimal clean";
  if (/\bgreen\b/i.test(revisionText)) return "green controls";
  if (/\bblue\b/i.test(revisionText)) return "blue controls";
  if (/\bteal\b/i.test(revisionText)) return "teal controls";
  if (/\bamber|yellow|gold\b/i.test(revisionText)) return "amber controls";
  if (/\bcolor|colors?\b/i.test(revisionText)) return "custom color direction";
  if (/\b(enterprise|admin|professional)\b/i.test(text)) return "enterprise professional";
  return previous ?? "calm professional";
}

function resolveVisualVariantIndex(revisionText: string, version: number, previous?: number) {
  if (typeof previous === "number" && /\b(regenerate|variant|another|different|new version)\b/i.test(revisionText)) {
    return (previous + 1) % 20;
  }

  if (typeof previous === "number") return previous;
  return (version - 1) % 20;
}

function resolveVisualStyleVariant(revisionText: string, visualVariantIndex: number): VisualStyleVariant {
  if (/\b(compact|dense|small)\b/i.test(revisionText)) return "compact";
  if (/\b(editorial|hero|featured|marketing)\b/i.test(revisionText)) return "editorial";
  if (/\b(split|side by side|sidebar)\b/i.test(revisionText)) return "splitFeature";

  const variants: VisualStyleVariant[] = ["classic", "editorial", "compact", "splitFeature"];
  return variants[visualVariantIndex % variants.length];
}

function titleForSpec(type: VisualArtifactType, text: string, kind: VisualArtifact["kind"]) {
  if (type === "dashboard") return `${dashboardSubject(text)} Dashboard`;
  if (type === "login") return kind === "mockup" ? "Sign-In Form Mockup" : "Login Page Sketch";
  if (type === "signup") {
    const subject = visualSubject(text, type);
    return `${subject === "Signup" ? "" : `${subject} `}Signup Page Sketch`.trim();
  }
  if (type === "diagram") return /\b(flowchart)\b/i.test(text) ? "Flowchart Diagram" : "Architecture Diagram";
  if (type === "landing") return "Landing Page Concept";
  if (type === "shopping") return `${visualSubject(text, type)} Shopping Page`;
  if (type === "form") return formCopyFromText(text, type).title;
  return `${visualSubject(text, type)} Sketch`;
}

function resolveVariant(prompt: string, previous?: VisualArtifact): VisualArtifact["variant"] {
  if (/\b(mobile|phone|small screen)\b/i.test(prompt)) return "mobile";
  if (/\b(dark|darker|dark theme)\b/i.test(prompt)) return "dark";
  return previous?.variant ?? "desktop";
}

function resolveKind(prompt: string, outcome: OutcomeType): VisualArtifact["kind"] {
  if (outcome === "diagram" || /\b(diagram|flowchart|architecture|er diagram|entity relationship|system flow)\b/i.test(prompt)) return "diagram";
  if (/\b(wireframe|sketch)\b/i.test(prompt)) return "wireframe";
  if (outcome === "mockup" || /\b(mockup|mock-up|visual design|landing page concept)\b/i.test(prompt)) return "mockup";
  return "sketch";
}

function renderVisualSpec(spec: VisualSpec, kind: VisualArtifact["kind"], variant: VisualArtifact["variant"], version: number) {
  if (spec.artifactType === "diagram" || kind === "diagram") return renderDiagramSvg(spec, variant, version);
  if (spec.artifactType === "dashboard") return renderDashboardSvg(spec, variant);
  if (spec.artifactType === "shopping") return renderShoppingSvg(spec, variant);
  if (spec.artifactType === "login" || spec.artifactType === "signup" || spec.artifactType === "form") return renderFormSvg(spec, variant);
  return renderInterfaceSvg(spec, variant);
}

function palette(variant: VisualArtifact["variant"], style = "") {
  const dark = variant === "dark";
  const accent = style.includes("green")
    ? "#32b86b"
    : style.includes("blue")
      ? "#4d8df7"
      : style.includes("teal")
        ? "#4fd1bd"
        : style.includes("amber")
          ? "#c8993a"
          : dark
            ? "#4fd1bd"
            : "#c8993a";

  return {
    dark,
    bg: dark ? "#101415" : "#f4f1ea",
    panel: dark ? "#171d1f" : "#ffffff",
    panelAlt: dark ? "#111719" : "#f7f7f2",
    ink: dark ? "#f4f0e8" : "#1f2423",
    muted: dark ? "#9ba7a3" : "#68716d",
    accent,
    blue: dark ? "#8fb7ff" : "#2f6f83",
    border: dark ? "#2b3838" : "#ded8cc",
  };
}

function renderDashboardSvg(spec: VisualSpec, variant: VisualArtifact["variant"]) {
  const p = palette(variant, spec.style);
  const styleVariant = spec.visualStyleVariant;
  const variantIndex = spec.visualVariantIndex % 20;
  const dense = spec.layout === "dense" || styleVariant === "classic";
  const hasLowStock = spec.components.some((component) => /low.stock|reorder|alert/i.test(component));
  const copy = dashboardCopy(spec);
  const width = variant === "mobile" ? 430 : 960;
  const height = variant === "mobile" ? 760 : 620;

  if (variant === "mobile") {
    return svgFrame(width, height, p.bg, `
      <rect x="36" y="28" width="358" height="704" rx="32" fill="${p.panel}" stroke="${p.border}" />
      <text x="64" y="78" fill="${p.ink}" font-size="24" font-weight="900">${escapeXml(spec.title)}</text>
      <rect x="64" y="104" width="302" height="44" rx="14" fill="${p.panelAlt}" />
      <text x="84" y="132" fill="${p.muted}" font-size="13">${escapeXml(copy.search)}</text>
      ${renderKpiCards(64, 174, 302, p, true, copy, variantIndex)}
      ${renderMiniChart(64, 348, 302, 116, p, variantIndex)}
      ${renderDataTable(64, 494, 302, 164, p, hasLowStock, copy)}
    `);
  }

  if (styleVariant === "editorial") {
    return svgFrame(width, height, p.bg, `
      <rect x="40" y="36" width="880" height="548" rx="28" fill="${p.panel}" stroke="${p.border}" />
      <text x="76" y="92" fill="${p.ink}" font-size="30" font-weight="900">${escapeXml(spec.title)}</text>
      <text x="78" y="124" fill="${p.muted}" font-size="14">${escapeXml(copy.search)}</text>
      ${renderKpiCards(76, 164, 808, p, false, copy, variantIndex)}
      ${renderMiniChart(76, 290, 516, 230, p, variantIndex)}
      ${renderAlertPanel(616, 290, 268, 230, p, copy)}
    `);
  }

  if (styleVariant === "compact") {
    return svgFrame(width, height, p.bg, `
      <rect x="40" y="36" width="880" height="548" rx="28" fill="${p.panel}" stroke="${p.border}" />
      <text x="72" y="86" fill="${p.ink}" font-size="25" font-weight="900">${escapeXml(spec.title)}</text>
      <rect x="548" y="56" width="220" height="40" rx="14" fill="${p.panelAlt}" />
      <text x="570" y="82" fill="${p.muted}" font-size="13">${escapeXml(copy.search)}</text>
      <rect x="786" y="56" width="96" height="40" rx="14" fill="${p.accent}" />
      <text x="812" y="82" fill="${p.dark ? "#09201d" : "#181410"}" font-size="13" font-weight="900">Filter</text>
      ${renderDataTable(72, 130, 520, 386, p, hasLowStock, copy)}
      ${renderKpiCards(616, 130, 266, p, true, copy, variantIndex)}
      ${renderAlertPanel(616, 318, 266, 198, p, copy)}
    `);
  }

  return svgFrame(width, height, p.bg, `
    <rect x="40" y="36" width="880" height="548" rx="28" fill="${p.panel}" stroke="${p.border}" />
    <rect x="64" y="64" width="164" height="492" rx="22" fill="${p.panelAlt}" />
    <text x="88" y="108" fill="${p.ink}" font-size="22" font-weight="900">${escapeXml(copy.navTitle)}</text>
    ${copy.nav.map((label, index) => `<rect x="84" y="${142 + index * 48}" width="118" height="32" rx="10" fill="${index === 0 ? p.accent : "transparent"}" opacity="${index === 0 ? "0.95" : "1"}" /><text x="98" y="${163 + index * 48}" fill="${index === 0 ? (p.dark ? "#09201d" : "#181410") : p.muted}" font-size="13" font-weight="800">${escapeXml(label)}</text>`).join("")}
    <text x="260" y="90" fill="${p.ink}" font-size="26" font-weight="900">${escapeXml(spec.title)}</text>
    <rect x="260" y="112" width="390" height="42" rx="14" fill="${p.panelAlt}" />
    <text x="282" y="139" fill="${p.muted}" font-size="13">${escapeXml(copy.search)}</text>
    <rect x="668" y="112" width="104" height="42" rx="14" fill="${p.panelAlt}" /><text x="696" y="139" fill="${p.muted}" font-size="13">Filter</text>
    <rect x="786" y="112" width="98" height="42" rx="14" fill="${p.accent}" /><text x="812" y="139" fill="${p.dark ? "#09201d" : "#181410"}" font-size="13" font-weight="900">Export</text>
    ${renderKpiCards(260, 184, 624, p, false, copy, variantIndex)}
    ${dense ? renderDataTable(260, 308, 402, 218, p, hasLowStock, copy) + renderAlertPanel(684, 308, 200, 218, p, copy) : renderMiniChart(260, 308, 624, 218, p, variantIndex)}
  `);
}

function renderKpiCards(x: number, y: number, width: number, p: ReturnType<typeof palette>, mobile: boolean, copy: DashboardCopy, variantIndex = 0) {
  const cards = copy.kpis;
  const gap = mobile ? 10 + (variantIndex % 2) * 2 : 12 + (variantIndex % 3) * 4;
  const columns = mobile ? 2 : variantIndex % 5 === 0 ? 2 : 4;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  return cards
    .map((card, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const left = x + col * (cardWidth + gap);
      const top = y + row * (variantIndex % 5 === 0 && !mobile ? 72 : 78);
      return `<rect x="${left}" y="${top}" width="${cardWidth}" height="62" rx="16" fill="${p.panelAlt}" stroke="${p.border}" />
        <text x="${left + 16}" y="${top + 25}" fill="${p.muted}" font-size="12" font-weight="800">${card[0]}</text>
        <text x="${left + 16}" y="${top + 48}" fill="${p.ink}" font-size="20" font-weight="900">${card[1]}</text>`;
    })
    .join("");
}

function renderDataTable(x: number, y: number, width: number, height: number, p: ReturnType<typeof palette>, lowStock: boolean, copy: DashboardCopy) {
  const rows = copy.rows;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="20" fill="${p.panelAlt}" stroke="${p.border}" />
    <text x="${x + 18}" y="${y + 30}" fill="${p.ink}" font-size="15" font-weight="900">${escapeXml(lowStock ? copy.alertTableTitle : copy.tableTitle)}</text>
    <text x="${x + 18}" y="${y + 58}" fill="${p.muted}" font-size="11" font-weight="800">${escapeXml(copy.columns[0])}</text>
    <text x="${x + 112}" y="${y + 58}" fill="${p.muted}" font-size="11" font-weight="800">${escapeXml(copy.columns[1])}</text>
    <text x="${x + width - 110}" y="${y + 58}" fill="${p.muted}" font-size="11" font-weight="800">${escapeXml(copy.columns[2])}</text>
    ${rows
      .map((row, index) => {
        const top = y + 78 + index * 32;
        const warn = /low|reorder/i.test(row[3]);
        return `<rect x="${x + 14}" y="${top - 20}" width="${width - 28}" height="28" rx="8" fill="${warn ? (p.dark ? "#2a2112" : "#fff2d2") : "transparent"}" />
          <text x="${x + 18}" y="${top}" fill="${p.ink}" font-size="12" font-weight="700">${row[0]}</text>
          <text x="${x + 112}" y="${top}" fill="${p.muted}" font-size="12">${row[1]}</text>
          <text x="${x + width - 110}" y="${top}" fill="${warn ? p.accent : p.ink}" font-size="12" font-weight="900">${row[2]}</text>
          <text x="${x + width - 62}" y="${top}" fill="${warn ? p.accent : p.muted}" font-size="12" font-weight="800">${row[3]}</text>`;
      })
      .join("")}`;
}

function renderAlertPanel(x: number, y: number, width: number, height: number, p: ReturnType<typeof palette>, copy: DashboardCopy) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="20" fill="${p.panelAlt}" stroke="${p.border}" />
    <text x="${x + 18}" y="${y + 30}" fill="${p.ink}" font-size="15" font-weight="900">Alerts</text>
    ${copy.alerts.map((label, index) => `<rect x="${x + 16}" y="${y + 54 + index * 48}" width="${width - 32}" height="34" rx="10" fill="${p.dark ? "#1f2424" : "#ffffff"}" /><circle cx="${x + 32}" cy="${y + 75 + index * 48}" r="5" fill="${index === 1 ? p.accent : p.blue}" /><text x="${x + 44}" y="${y + 79 + index * 48}" fill="${p.muted}" font-size="11">${escapeXml(label)}</text>`).join("")}
  `;
}

function renderMiniChart(x: number, y: number, width: number, height: number, p: ReturnType<typeof palette>, variantIndex = 0) {
  const wave = variantIndex % 4;
  const path =
    wave === 0
      ? `M ${x + 28} ${y + height - 42} C ${x + 120} ${y + 70}, ${x + 180} ${y + height - 86}, ${x + 260} ${y + 92} S ${x + width - 140} ${y + height - 104}, ${x + width - 42} ${y + 72}`
      : wave === 1
        ? `M ${x + 28} ${y + height - 60} L ${x + 110} ${y + 86} L ${x + 210} ${y + 116} L ${x + 320} ${y + 70} L ${x + width - 42} ${y + 96}`
        : wave === 2
          ? `M ${x + 28} ${y + height - 58} C ${x + 150} ${y + height - 112}, ${x + 220} ${y + 52}, ${x + 340} ${y + 88} S ${x + width - 160} ${y + 128}, ${x + width - 42} ${y + 54}`
          : `M ${x + 28} ${y + 74} C ${x + 130} ${y + 130}, ${x + 210} ${y + 82}, ${x + 316} ${y + 136} S ${x + width - 148} ${y + height - 96}, ${x + width - 42} ${y + height - 64}`;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="20" fill="${p.panelAlt}" stroke="${p.border}" />
    <text x="${x + 18}" y="${y + 32}" fill="${p.ink}" font-size="15" font-weight="900">Activity trend</text>
    <path d="${path}" fill="none" stroke="${p.accent}" stroke-width="${variantIndex % 2 === 0 ? 4 : 6}" />
    <rect x="${x + 28}" y="${y + height - 36}" width="${width - 56}" height="1" fill="${p.border}" />
  `;
}

function renderShoppingSvg(spec: VisualSpec, variant: VisualArtifact["variant"]) {
  const p = palette(variant, spec.style);
  const subject = spec.labels[0] || spec.title.replace(/\s+Shopping Page$/i, "");
  const copy = shoppingCopy(subject);
  const variantIndex = spec.visualVariantIndex % 20;
  const largeCards = spec.components.some((component) => /large product cards/i.test(component)) || variantIndex % 3 === 1;
  const styleVariant = spec.visualStyleVariant;
  const leftFilters = spec.components.some((component) => /filter sidebar/i.test(component)) || styleVariant === "classic" || styleVariant === "splitFeature";
  const width = variant === "mobile" ? 430 : 960;
  const height = variant === "mobile" ? 760 : 640;

  if (variant === "mobile") {
    return svgFrame(width, height, p.bg, `
      <rect x="30" y="28" width="370" height="704" rx="32" fill="${p.panel}" stroke="${p.border}" />
      <text x="58" y="76" fill="${p.ink}" font-size="24" font-weight="900">${escapeXml(subject)}</text>
      <rect x="300" y="52" width="68" height="34" rx="14" fill="${p.accent}" />
      <text x="318" y="74" fill="${p.dark ? "#09201d" : "#181410"}" font-size="12" font-weight="900">Cart</text>
      <rect x="58" y="112" width="312" height="108" rx="24" fill="${p.dark ? "#13201f" : "#fbf3df"}" />
      <text x="82" y="156" fill="${p.ink}" font-size="25" font-weight="900">${escapeXml(copy.hero)}</text>
      <text x="82" y="184" fill="${p.muted}" font-size="13">${escapeXml(copy.nav[0])} / ${escapeXml(copy.nav[1])}</text>
      <rect x="58" y="242" width="312" height="42" rx="14" fill="${p.panelAlt}" />
      <text x="78" y="269" fill="${p.muted}" font-size="13">${escapeXml(copy.search)}</text>
      <rect x="58" y="304" width="146" height="34" rx="12" fill="${p.panelAlt}" stroke="${p.border}" />
      <text x="78" y="326" fill="${p.muted}" font-size="12" font-weight="800">${escapeXml(copy.filters[0])}</text>
      <rect x="218" y="304" width="152" height="34" rx="12" fill="${p.panelAlt}" stroke="${p.border}" />
      <text x="238" y="326" fill="${p.muted}" font-size="12" font-weight="800">Sort by price</text>
      ${renderProductCards(58, 364, 312, p, copy.products, true, largeCards, variantIndex)}
    `);
  }

  if (styleVariant === "editorial") {
    return svgFrame(width, height, p.bg, `
      <rect x="42" y="36" width="876" height="568" rx="30" fill="${p.panel}" stroke="${p.border}" />
      <text x="78" y="84" fill="${p.ink}" font-size="26" font-weight="900">${escapeXml(subject)}</text>
      <text x="616" y="82" fill="${p.muted}" font-size="13" font-weight="800">${escapeXml(copy.nav.join("  /  "))}</text>
      <rect x="78" y="116" width="474" height="392" rx="34" fill="${p.dark ? "#13201f" : "#fbf3df"}" />
      <text x="120" y="188" fill="${p.ink}" font-size="42" font-weight="900">${escapeXml(copy.hero)}</text>
      <text x="122" y="230" fill="${p.muted}" font-size="15">${escapeXml(copy.purpose)}</text>
      <path d="M 146 408 C 238 328, 354 398, 482 314" fill="none" stroke="${p.accent}" stroke-width="16" stroke-linecap="round" />
      <rect x="122" y="454" width="154" height="46" rx="16" fill="${p.accent}" />
      <text x="158" y="483" fill="${p.dark ? "#09201d" : "#181410"}" font-size="13" font-weight="900">Shop collection</text>
      <rect x="584" y="116" width="298" height="54" rx="18" fill="${p.panelAlt}" />
      <text x="608" y="150" fill="${p.muted}" font-size="13">${escapeXml(copy.search)}</text>
      ${renderProductCards(584, 200, 298, p, copy.products, false, true, variantIndex)}
    `);
  }

  if (styleVariant === "compact") {
    return svgFrame(width, height, p.bg, `
      <rect x="42" y="36" width="876" height="568" rx="30" fill="${p.panel}" stroke="${p.border}" />
      <text x="78" y="84" fill="${p.ink}" font-size="25" font-weight="900">${escapeXml(subject)}</text>
      <rect x="470" y="56" width="280" height="38" rx="14" fill="${p.panelAlt}" />
      <text x="494" y="80" fill="${p.muted}" font-size="13">${escapeXml(copy.search)}</text>
      <rect x="770" y="56" width="92" height="38" rx="14" fill="${p.accent}" />
      <text x="796" y="80" fill="${p.dark ? "#09201d" : "#181410"}" font-size="13" font-weight="900">Cart</text>
      <rect x="78" y="124" width="804" height="54" rx="18" fill="${p.panelAlt}" stroke="${p.border}" />
      ${copy.filters.map((label, index) => `<rect x="${102 + index * 128}" y="138" width="102" height="26" rx="11" fill="${index === 0 ? p.accent : p.dark ? "#0d1213" : "#ffffff"}" /><text x="${118 + index * 128}" y="156" fill="${index === 0 ? (p.dark ? "#09201d" : "#181410") : p.muted}" font-size="12" font-weight="800">${escapeXml(label)}</text>`).join("")}
      ${renderProductCards(78, 212, 804, p, copy.products, false, false, variantIndex)}
    `);
  }

  const filterWidth = leftFilters ? 170 : 0;
  const productX = 78 + filterWidth + (leftFilters ? 24 : 0);
  const productWidth = 804 - filterWidth - (leftFilters ? 24 : 0);
  const heroY = variantIndex % 2 === 0 ? 90 : 102;
  const gridY = variantIndex % 2 === 0 ? 316 : 330;

  return svgFrame(width, height, p.bg, `
    <rect x="42" y="36" width="876" height="568" rx="30" fill="${p.panel}" stroke="${p.border}" />
    <text x="78" y="84" fill="${p.ink}" font-size="27" font-weight="900">${escapeXml(subject)}</text>
    ${copy.nav.map((label, index) => `<text x="${350 + index * 112}" y="82" fill="${index === 0 ? p.ink : p.muted}" font-size="13" font-weight="800">${escapeXml(label)}</text>`).join("")}
    <rect x="800" y="56" width="78" height="38" rx="15" fill="${p.accent}" />
    <text x="821" y="80" fill="${p.dark ? "#09201d" : "#181410"}" font-size="13" font-weight="900">Cart</text>

    <rect x="78" y="${heroY}" width="804" height="${variantIndex % 2 === 0 ? 158 : 138}" rx="28" fill="${p.dark ? "#13201f" : "#fbf3df"}" />
    <text x="112" y="${heroY + 56}" fill="${p.ink}" font-size="${variantIndex % 2 === 0 ? 36 : 31}" font-weight="900">${escapeXml(copy.hero)}</text>
    <text x="112" y="${heroY + 90}" fill="${p.muted}" font-size="14">${escapeXml(copy.purpose)}</text>
    <rect x="666" y="${heroY + 44}" width="158" height="50" rx="17" fill="${p.accent}" />
    <text x="704" y="${heroY + 76}" fill="${p.dark ? "#09201d" : "#181410"}" font-size="14" font-weight="900">Shop now</text>

    <rect x="78" y="${variantIndex % 2 === 0 ? 270 : 262}" width="520" height="42" rx="14" fill="${p.panelAlt}" />
    <text x="102" y="${variantIndex % 2 === 0 ? 297 : 289}" fill="${p.muted}" font-size="13">${escapeXml(copy.search)}</text>
    <rect x="618" y="${variantIndex % 2 === 0 ? 270 : 262}" width="116" height="42" rx="14" fill="${p.panelAlt}" stroke="${p.border}" />
    <text x="648" y="${variantIndex % 2 === 0 ? 297 : 289}" fill="${p.muted}" font-size="13" font-weight="800">Filter</text>
    <rect x="752" y="${variantIndex % 2 === 0 ? 270 : 262}" width="130" height="42" rx="14" fill="${p.panelAlt}" stroke="${p.border}" />
    <text x="778" y="${variantIndex % 2 === 0 ? 297 : 289}" fill="${p.muted}" font-size="13" font-weight="800">Sort: popular</text>

    ${
      leftFilters
        ? `<rect x="78" y="${gridY}" width="170" height="238" rx="22" fill="${p.panelAlt}" stroke="${p.border}" />
          <text x="100" y="${gridY + 34}" fill="${p.ink}" font-size="15" font-weight="900">Filters</text>
          ${copy.filters.map((label, index) => `<rect x="100" y="${gridY + 56 + index * 34}" width="104" height="22" rx="9" fill="${index === 0 ? p.accent : "transparent"}" opacity="${index === 0 ? "0.95" : "1"}" /><text x="112" y="${gridY + 72 + index * 34}" fill="${index === 0 ? (p.dark ? "#09201d" : "#181410") : p.muted}" font-size="12" font-weight="800">${escapeXml(label)}</text>`).join("")}`
        : ""
    }
    ${renderProductCards(productX, gridY, productWidth, p, copy.products, false, largeCards, variantIndex)}
  `);
}

function renderProductCards(
  x: number,
  y: number,
  width: number,
  p: ReturnType<typeof palette>,
  products: string[][],
  mobile: boolean,
  largeCards: boolean,
  variantIndex = 0,
) {
  const columns = mobile ? 2 : largeCards ? 2 : variantIndex % 5 === 2 ? 3 : 4;
  const gap = mobile ? 10 + (variantIndex % 2) * 2 : 12 + (variantIndex % 4) * 3;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = mobile ? 152 : largeCards ? 218 + (variantIndex % 3) * 8 : 220 + (variantIndex % 4) * 14;

  return products
    .slice(0, mobile ? 4 : columns * 2)
    .map((product, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const left = x + col * (cardWidth + gap);
      const top = y + row * (cardHeight + gap);
      const imageHeight = mobile ? 58 : largeCards ? 84 + (variantIndex % 3) * 12 : 82 + (variantIndex % 5) * 7;
      const imageFill = variantIndex % 2 === 0 ? (p.dark ? "#1f2929" : "#f4ead7") : p.panel;
      const shoePath =
        variantIndex % 4 === 0
          ? `M ${left + 34} ${top + imageHeight - 4} C ${left + 74} ${top + imageHeight - 30}, ${left + 108} ${top + imageHeight - 8}, ${left + cardWidth - 38} ${top + imageHeight - 24}`
          : variantIndex % 4 === 1
            ? `M ${left + 30} ${top + 44} C ${left + 82} ${top + 24}, ${left + 132} ${top + 54}, ${left + cardWidth - 34} ${top + 34}`
            : variantIndex % 4 === 2
              ? `M ${left + 30} ${top + imageHeight - 18} L ${left + cardWidth - 48} ${top + 38}`
              : `M ${left + 34} ${top + imageHeight - 28} C ${left + 92} ${top + imageHeight - 62}, ${left + 134} ${top + imageHeight - 4}, ${left + cardWidth - 34} ${top + imageHeight - 42}`;

      return `<rect x="${left}" y="${top}" width="${cardWidth}" height="${cardHeight}" rx="20" fill="${p.panelAlt}" stroke="${p.border}" />
        <rect x="${left + 14}" y="${top + 14}" width="${cardWidth - 28}" height="${imageHeight}" rx="${variantIndex % 3 === 0 ? 16 : 8}" fill="${imageFill}" />
        <path d="${shoePath}" fill="none" stroke="${p.accent}" stroke-width="${variantIndex % 3 === 2 ? 4 : 6}" stroke-linecap="round" />
        <text x="${left + 16}" y="${top + imageHeight + 44}" fill="${p.ink}" font-size="${mobile ? 12 : 14}" font-weight="900">${escapeXml(product[0])}</text>
        <text x="${left + 16}" y="${top + imageHeight + 68}" fill="${p.muted}" font-size="12">${escapeXml(product[2])}</text>
        <text x="${left + 16}" y="${top + imageHeight + 94}" fill="${p.ink}" font-size="16" font-weight="900">${escapeXml(product[1])}</text>
        <rect x="${left + cardWidth - 86}" y="${top + imageHeight + 72}" width="66" height="32" rx="12" fill="${p.accent}" />
        <text x="${left + cardWidth - 70}" y="${top + imageHeight + 93}" fill="${p.dark ? "#09201d" : "#181410"}" font-size="11" font-weight="900">Add</text>`;
    })
    .join("");
}

function renderFormSvg(spec: VisualSpec, variant: VisualArtifact["variant"]) {
  const p = palette(variant, spec.style);
  const copy = formCopyFromSpec(spec);
  const width = variant === "mobile" ? 430 : 920;
  const height = variant === "mobile" ? 760 : 620;
  const styleVariant = spec.visualStyleVariant;
  const variantIndex = spec.visualVariantIndex % 20;
  const centered = variant === "mobile" || styleVariant === "compact" || styleVariant === "classic";
  const reversed = styleVariant === "splitFeature";
  const formMode = variantIndex % 5;
  const cardW = variant === "mobile" ? 322 : formMode === 2 ? 560 : formMode === 3 ? 420 : styleVariant === "compact" ? 340 + (variantIndex % 4) * 18 : 300 + (variantIndex % 3) * 16;
  const cardX =
    variant === "mobile"
      ? 54
      : formMode === 2
        ? 180
        : formMode === 3
          ? 250
          : centered
            ? 280 + (variantIndex % 3) * 18
            : reversed
              ? 96
              : 506;
  const cardY = variant === "mobile" ? 92 : formMode === 2 ? 76 : 86 + (variantIndex % 4) * 8;
  const fieldGap = formMode === 2 ? 54 : variantIndex % 2 === 0 ? 58 : 52;
  const fieldH = formMode === 2 ? 40 : variantIndex % 2 === 0 ? 44 : 40;
  const visibleFields = copy.fields.slice(0, variant === "mobile" ? 8 : 10);
  const fieldColumns = formMode === 2 && visibleFields.length > 3 && variant !== "mobile" ? 2 : 1;
  const fieldRows = Math.ceil(visibleFields.length / fieldColumns);
  const fieldW = fieldColumns === 2 ? (cardW - 82) / 2 : cardW - 68;
  const gridButtonY = cardY + 92 + fieldRows * fieldGap + 18;
  const resolvedButtonY = fieldColumns === 2 ? gridButtonY : cardY + 92 + visibleFields.length * fieldGap + 12;
  const resolvedFooterY = resolvedButtonY + 82;
  const cardH = Math.max(variant === "mobile" ? 430 : 360, resolvedFooterY - cardY + 34);
  const heroX = reversed ? 500 : 80;
  const hero =
    variant === "mobile" || styleVariant === "classic" || styleVariant === "compact"
      ? ""
      : `<rect x="${heroX}" y="96" width="348" height="428" rx="30" fill="${p.dark ? "#13201f" : "#fbf3df"}" />
    <text x="${heroX + 38}" y="182" fill="${p.ink}" font-size="38" font-weight="900">${escapeXml(copy.heroTitle)}</text>
    <text x="${heroX + 38}" y="224" fill="${p.muted}" font-size="15">${escapeXml(copy.purpose)}</text>
    <rect x="${heroX + 38}" y="306" width="212" height="58" rx="18" fill="${p.accent}" opacity="0.9" />
    <rect x="${heroX + 38}" y="394" width="248" height="14" rx="7" fill="${p.dark ? "#223132" : "#fff7e6"}" />
    <rect x="${heroX + 38}" y="424" width="188" height="14" rx="7" fill="${p.dark ? "#223132" : "#fff7e6"}" />`;

  return svgFrame(width, height, p.bg, `
    <rect x="${variant === "mobile" ? 32 : 52}" y="${variant === "mobile" ? 32 : 46}" width="${variant === "mobile" ? 366 : 816}" height="${variant === "mobile" ? 696 : 528}" rx="32" fill="${p.panel}" stroke="${p.border}" />
    ${
      styleVariant === "editorial" && variant !== "mobile"
        ? `<text x="92" y="122" fill="${p.ink}" font-size="36" font-weight="900">${escapeXml(copy.heroTitle)}</text>
          <text x="94" y="158" fill="${p.muted}" font-size="15">${escapeXml(copy.purpose)}</text>
          <rect x="92" y="200" width="210" height="258" rx="30" fill="${p.dark ? "#13201f" : "#fbf3df"}" />
          <path d="M 126 360 C 176 298, 226 376, 272 300" fill="none" stroke="${p.accent}" stroke-width="12" stroke-linecap="round" />`
        : ""
    }
    ${hero}
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${variantIndex % 2 === 0 ? (centered ? 34 : 28) : 18}" fill="${p.panelAlt}" stroke="${p.border}" />
    <text x="${cardX + 34}" y="${cardY + 54}" fill="${p.ink}" font-size="27" font-weight="900">${escapeXml(copy.heading)}</text>
    <text x="${cardX + 36}" y="${cardY + 78}" fill="${p.muted}" font-size="12" font-weight="800">${escapeXml(copy.secondary)}</text>
    ${visibleFields
      .map((label, index) => {
        const col = index % fieldColumns;
        const row = Math.floor(index / fieldColumns);
        const left = cardX + 34 + col * (fieldW + 14);
        const top = cardY + 98 + row * fieldGap;
        return `<rect x="${left}" y="${top}" width="${fieldW}" height="${fieldH}" rx="${variantIndex % 3 === 0 ? 15 : 9}" fill="${p.dark ? "#0d1213" : "#ffffff"}" stroke="${p.border}" /><text x="${left + 18}" y="${top + Math.round(fieldH * 0.62)}" fill="${p.muted}" font-size="13" font-weight="700">${escapeXml(label)}</text>`;
      })
      .join("")}
    <rect x="${cardX + 34}" y="${resolvedButtonY}" width="${cardW - 68}" height="54" rx="17" fill="${p.accent}" />
    <text x="${cardX + cardW / 2}" y="${resolvedButtonY + 34}" text-anchor="middle" fill="${p.dark ? "#09201d" : "#181410"}" font-size="16" font-weight="900">${escapeXml(copy.action)}</text>
    <text x="${cardX + cardW / 2}" y="${resolvedFooterY}" text-anchor="middle" fill="${p.muted}" font-size="12" font-weight="700">${escapeXml(copy.footer)}</text>
  `);
}

function renderInterfaceSvg(spec: VisualSpec, variant: VisualArtifact["variant"]) {
  const p = palette(variant, spec.style);
  const subject = sanitizeGenericLabel(spec.labels[0] || spec.title.replace(/\s+Sketch$/i, ""), "Custom Visual");
  const components = meaningfulComponents(spec, subject);
  const label = sanitizeGenericLabel(spec.labels[1] || `${subject} overview`, `${subject} overview`);
  const variantIndex = spec.visualVariantIndex % 20;

  if (spec.visualStyleVariant === "editorial") {
    return svgFrame(920, 620, p.bg, `
      <rect x="54" y="46" width="812" height="528" rx="30" fill="${p.panel}" stroke="${p.border}" />
      <rect x="88" y="94" width="430" height="360" rx="32" fill="${p.dark ? "#13201f" : "#fbf3df"}" />
      <text x="128" y="174" fill="${p.ink}" font-size="38" font-weight="900">${escapeXml(subject)}</text>
      <text x="130" y="214" fill="${p.muted}" font-size="15">${escapeXml(label)}</text>
      <path d="M 132 360 C 206 288, 316 374, 456 292" fill="none" stroke="${p.accent}" stroke-width="14" stroke-linecap="round" />
      ${components.map((component, index) => `<rect x="${variantIndex % 2 === 0 ? 560 : 536}" y="${126 + index * (variantIndex % 2 === 0 ? 82 : 72)}" width="${variantIndex % 2 === 0 ? 240 : 284}" height="${variantIndex % 2 === 0 ? 58 : 48}" rx="${variantIndex % 3 === 0 ? 18 : 10}" fill="${p.panelAlt}" stroke="${p.border}" /><text x="${variantIndex % 2 === 0 ? 584 : 560}" y="${162 + index * (variantIndex % 2 === 0 ? 82 : 72)}" fill="${p.muted}" font-size="13" font-weight="800">${escapeXml(component)}</text>`).join("")}
      <rect x="88" y="482" width="180" height="48" rx="15" fill="${p.accent}" /><text x="132" y="512" fill="${p.dark ? "#09201d" : "#181410"}" font-size="15" font-weight="900">Continue</text>
    `);
  }

  if (spec.visualStyleVariant === "compact") {
    return svgFrame(920, 620, p.bg, `
      <rect x="54" y="46" width="812" height="528" rx="30" fill="${p.panel}" stroke="${p.border}" />
      <text x="88" y="96" fill="${p.ink}" font-size="26" font-weight="900">${escapeXml(subject)}</text>
      <rect x="574" y="70" width="250" height="40" rx="14" fill="${p.panelAlt}" />
      <text x="596" y="96" fill="${p.muted}" font-size="13">Search ${escapeXml(subject.toLowerCase())}</text>
      ${components.map((component, index) => `<rect x="${88 + (variantIndex % 4) * 8}" y="${146 + index * (variantIndex % 2 === 0 ? 74 : 64)}" width="${736 - (variantIndex % 4) * 16}" height="${variantIndex % 2 === 0 ? 54 : 46}" rx="${variantIndex % 3 === 0 ? 18 : 8}" fill="${p.panelAlt}" stroke="${p.border}" /><text x="${116 + (variantIndex % 4) * 8}" y="${180 + index * (variantIndex % 2 === 0 ? 74 : 64)}" fill="${p.ink}" font-size="14" font-weight="900">${escapeXml(component)}</text><rect x="${680 - (variantIndex % 4) * 8}" y="${160 + index * (variantIndex % 2 === 0 ? 74 : 64)}" width="104" height="26" rx="10" fill="${index === 0 ? p.accent : p.dark ? "#0d1213" : "#ffffff"}" />`).join("")}
    `);
  }

  return svgFrame(920, 620, p.bg, `
    <rect x="54" y="46" width="812" height="528" rx="30" fill="${p.panel}" stroke="${p.border}" />
    <text x="88" y="102" fill="${p.ink}" font-size="28" font-weight="900">${escapeXml(subject)}</text>
    <text x="88" y="132" fill="${p.muted}" font-size="14">${escapeXml(label)}</text>
    <rect x="88" y="174" width="${variantIndex % 2 === 0 ? 520 : 340}" height="${variantIndex % 5 === 0 ? 246 : 292}" rx="${variantIndex % 3 === 0 ? 24 : 12}" fill="${p.panelAlt}" />
    <rect x="${variantIndex % 2 === 0 ? 636 : 456}" y="174" width="${variantIndex % 2 === 0 ? 184 : 330}" height="${variantIndex % 3 === 1 ? 168 : 136}" rx="${variantIndex % 3 === 0 ? 22 : 10}" fill="${p.dark ? "#13201f" : "#fbf3df"}" />
    <rect x="${variantIndex % 2 === 0 ? 636 : 456}" y="${variantIndex % 3 === 1 ? 364 : 330}" width="${variantIndex % 2 === 0 ? 184 : 330}" height="${variantIndex % 3 === 1 ? 102 : 136}" rx="${variantIndex % 3 === 0 ? 22 : 10}" fill="${p.panelAlt}" stroke="${p.border}" />
    ${components.map((component, index) => `<rect x="124" y="${220 + index * (variantIndex % 2 === 0 ? 52 : 44)}" width="${variantIndex % 2 === 0 ? 250 : 204}" height="${variantIndex % 2 === 0 ? 34 : 28}" rx="10" fill="${p.dark ? "#0d1213" : "#ffffff"}" /><text x="142" y="${242 + index * (variantIndex % 2 === 0 ? 52 : 44)}" fill="${p.muted}" font-size="13" font-weight="800">${escapeXml(component)}</text>`).join("")}
    <rect x="88" y="500" width="180" height="48" rx="15" fill="${p.accent}" /><text x="132" y="530" fill="${p.dark ? "#09201d" : "#181410"}" font-size="15" font-weight="900">Continue</text>
  `);
}

function meaningfulComponents(spec: VisualSpec, subject: string) {
  const generic = /^(navigation|content panel|control group|primary action|interface header|interface main panel|supporting detail panel)$/i;
  const components = spec.components.map((component) => sanitizeGenericLabel(component, "")).filter((component) => component && !generic.test(component));

  return (components.length >= 4
    ? components
    : [`${subject} header`, `${subject} featured area`, `${subject} details`, `${subject} action`]
  ).slice(0, 4);
}

function sanitizeGenericLabel(value: string, fallback: string) {
  const trimmed = value.trim();
  if (!trimmed || /^(interface|interface sketch|navigation|content panel|control group)$/i.test(trimmed)) return fallback;
  return trimmed;
}

function renderDiagramSvg(spec: VisualSpec, variant: VisualArtifact["variant"], version: number) {
  const p = palette(variant, spec.style);
  const labels = (spec.labels.length >= 3 ? spec.labels : ["Client", "API", "Service", "Database"]).slice(0, 5);

  return svgFrame(920, 560, p.bg, `
    <rect x="54" y="46" width="812" height="468" rx="30" fill="${p.panel}" stroke="${p.border}" />
    <text x="88" y="96" fill="${p.ink}" font-size="26" font-weight="900">${escapeXml(spec.title)}</text>
    <text x="88" y="122" fill="${p.muted}" font-size="13">${escapeXml(spec.purpose)}</text>
    ${labels
      .map((label, index) => {
        const x = version % 2 === 0 ? 118 + index * 150 : 96 + index * 168;
        const y = version % 2 === 0 ? 250 : index % 2 === 0 ? 210 : 318;
        const nextX = version % 2 === 0 ? 118 + (index + 1) * 150 : 96 + (index + 1) * 168;
        const nextY = version % 2 === 0 ? 250 : (index + 1) % 2 === 0 ? 210 : 318;
        return `
          <rect x="${x}" y="${y}" width="124" height="72" rx="18" fill="${p.panelAlt}" stroke="${index === 0 ? p.accent : p.border}" />
          <text x="${x + 18}" y="${y + 42}" fill="${p.ink}" font-size="14" font-weight="800">${escapeXml(label)}</text>
          ${index < labels.length - 1 ? `<path d="M ${x + 124} ${y + 36} C ${x + 148} ${y + 36}, ${nextX - 24} ${nextY + 36}, ${nextX} ${nextY + 36}" fill="none" stroke="${p.accent}" stroke-width="3" marker-end="url(#arrow)" />` : ""}
        `;
      })
      .join("")}
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${p.accent}" /></marker></defs>
  `);
}

function extractFlowLabels(prompt: string) {
  const words = prompt
    .replace(/[^a-z0-9\s>,-]/gi, " ")
    .split(/\s*(?:>|,|then|to)\s*/i)
    .map((part) =>
      part
        .split(/\s+/)
        .filter((word) => word.length > 2 && !/^(create|diagram|architecture|flow|for|this|that|with|from)$/i.test(word))
        .slice(0, 2)
        .map(toTitle)
        .join(" "),
    )
    .filter(Boolean);

  return (words.length >= 3 ? words : ["Client", "API", "Service", "Database"]).slice(0, 5);
}

function hasVisualIntent(message: string, visualWords = ["draw", "sketch", "wireframe", "mockup", "design", "visualize", "layout", "image", "picture", "preview"]) {
  const tokens = message
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return tokens.some((token) => visualWords.includes(token));
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let col = 1; col <= b.length; col += 1) {
      current[col] =
        a[row - 1] === b[col - 1]
          ? previous[col - 1]
          : Math.min(previous[col - 1] + 1, previous[col] + 1, current[col - 1] + 1);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function svgFrame(width: number, height: number, bg: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
    <rect width="${width}" height="${height}" fill="${bg}" />
    ${body}
  </svg>`;
}

function toTitle(value: string) {
  const known: Record<string, string> = {
    api: "API",
    csv: "CSV",
    dns: "DNS",
    ip: "IP",
    json: "JSON",
    ui: "UI",
    url: "URL",
    xml: "XML",
  };

  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => known[word.toLowerCase()] ?? `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

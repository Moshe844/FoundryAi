import type { DynamicTaskAssessment, ExecutionDepth, ModelTier, TaskProfile } from "./types";

export type TaskContext = {
  message: string;
  activeMission?: string;
  parentMission?: string;
  recentFollowUps?: string[];
  likelyFiles?: string[];
  projectFileCount?: number;
  estimatedSubsystems?: number;
  crossLayer?: boolean;
  projectWide?: boolean;
  failureHistory?: number;
  requestedDepth?: ExecutionDepth;
  dynamicAssessment?: DynamicTaskAssessment;
};

export function profileTask(input: TaskContext): TaskProfile {
  const text = activeTaskScope(input.message).toLowerCase();
  const priorContext = [input.activeMission, input.parentMission, ...(input.recentFollowUps ?? [])].filter(Boolean).join(" ").toLowerCase();
  const riskText = stripNegatedRiskClaims(text)
    .replace(/\bauth-database-api\b/g, "")
    .replace(/\b(?:no|without|does(?:n't| not) (?:need|use|have)|do not (?:need|use|have))\s+(?:a\s+)?(?:backend|database|authentication|auth|payments?|security|login|accounts?|framework|integrations?)\b/g, "");
  const failureHistory = input.failureHistory ?? 0;
  if (input.dynamicAssessment) return profileFromDynamicAssessment(input, input.dynamicAssessment, failureHistory);
  const style = /\b(color|colour|blue|green|spacing|css|copy|typo|spelling|darker|lighter|rename|config value)\b/.test(text);
  const locate = /\b(where is|find|locate|defined)\b/.test(text);
  const ordinaryQuestion = /^(?:how\s+(?:do|can|should|would)\s+i\b|how\s+to\b|what\b|why\b|when\b|where\b|which\b|who\b|can\s+you\s+explain\b|could\s+you\s+explain\b|is\s+(?:it|this|that|there)\b|are\s+(?:there|these|those)\b|do\s+i\b|does\s+(?:it|this|that)\b)/.test(text.trim());
  const cheapOperation = style || locate || ordinaryQuestion || /\b(search|index|read|format|prettify|summari[sz]e|spellcheck|list files|what is|what does|simple question|explain this)\b/.test(text);
  const concurrency = /\b(concurr\w*|race condition|intermittent|los(?:e|es|t) transactions?|deadlock)\b/.test(text);
  const sensitive = /\b(auth\w*|payment|security|data loss|transactions?)\b/.test(riskText);
  const migration = /\b(migrat\w*|redesign\w*|whole design system|multi-service|shared infrastructure|winforms|wpf)\b/.test(text);
  const crossLayer = input.crossLayer ?? /\b(frontend.*api.*database|frontend.*backend|cross-layer|multi-service)\b/.test(text);
  const projectCreation = /\b(?:create|build|make|scaffold|generate)\b[\s\S]{0,100}\b(?:project|website|site|application|app|portfolio|api|backend|service|endpoint|game)\b/.test(text);
  const staticCreationShape = projectCreation && /\b(?:html|css|vanilla\s+(?:java\s*script|javascript|js)|static|portfolio|landing page)\b/.test(text);
  const complexCreation = projectCreation && /\b(?:unclear rendering bugs?|complex animation systems?|difficult accessibility problems?|extensive multi-page architecture|advanced performance issues?|complex third-party integrations?)\b/.test(riskText);
  const standardBuild = projectCreation || /\b(add|build|implement|fix|validation|settings page|feature|endpoint|form)\b/.test(text);
  const projectWide = input.projectWide ?? /\b(project-wide|whole|entire|organization-wide|all services)\b/.test(text);
  const estimatedFiles = input.likelyFiles?.length ?? (projectCreation ? (staticCreationShape ? 3 : 6) : cheapOperation ? 1 : projectWide || migration ? 12 : standardBuild ? 3 : 1);
  const estimatedSubsystems = input.estimatedSubsystems ?? (crossLayer ? 3 : migration ? 2 : 1);
  const simpleProjectCreation = projectCreation && !complexCreation && !concurrency && !sensitive && !migration && !crossLayer && !projectWide && failureHistory === 0 && estimatedFiles <= 8 && estimatedSubsystems <= 2;
  const simpleBoundedWork = !projectCreation && (standardBuild || cheapOperation) && !concurrency && !sensitive && !migration && !crossLayer && !projectWide && failureHistory === 0 && estimatedFiles <= 3 && estimatedSubsystems === 1;
  const risk = clamp((sensitive ? 0.45 : 0.08) + (concurrency ? 0.35 : 0) + failureHistory * 0.12);
  const difficulty = clamp((cheapOperation ? 0.12 : standardBuild ? 0.48 : 0.32) + (migration ? 0.3 : 0) + (concurrency ? 0.3 : 0));
  const ambiguity = clamp((/^\s*(fix this|fix it|do it|make it work)\s*[.!]?$/i.test(input.message) ? 0.55 : 0.14) - (priorContext ? 0.25 : 0));
  let tier: ModelTier = "builder";
  const reasons: string[] = [];
  if (complexCreation) { tier = "architect"; reasons.push("project creation includes genuinely difficult rendering, accessibility, architecture, performance, or integration work"); }
  else if (simpleProjectCreation) { tier = "fast"; reasons.push("clear low-risk project creation with a bounded file set and no difficult engineering signals"); }
  else if (simpleBoundedWork) { tier = "fast"; reasons.push("clear low-risk work with a small working set and one affected subsystem"); }
  else if (concurrency || sensitive || crossLayer || failureHistory >= 1) { tier = "architect"; reasons.push("material risk, cross-layer reasoning, or failure evidence"); }
  if (migration && (projectWide || estimatedSubsystems > 1)) { tier = sensitive || failureHistory >= 2 ? "super-reasoning" : "enterprise-architect"; reasons.push("broad migration or subsystem redesign"); }
  if (failureHistory >= 2 && sensitive) { tier = "super-reasoning"; reasons.push("critical sensitive failure after repeated attempts"); }
  if (!reasons.length) reasons.push("ordinary implementation scope with clear requirements");
  return {
    intent: locate || (cheapOperation && !standardBuild) ? "inspect" : standardBuild ? "change" : "explain",
    taskType: projectCreation ? "project_creation" : style ? "localized-edit" : cheapOperation ? "inspection" : migration ? "migration" : concurrency ? "debugging" : "implementation",
    requestedOutcome: input.message,
    scope: { estimatedFiles, estimatedSubsystems, crossLayer, projectWide },
    projectScale: clamp((input.projectFileCount ?? 0) / 100_000),
    taskLocality: clamp(1 - estimatedFiles / 20),
    difficulty,
    ambiguity,
    risk,
    blastRadius: clamp(projectWide ? 0.9 : estimatedFiles / 12),
    contextNeed: clamp(estimatedFiles / 10),
    reasoningNeed: clamp(Math.max(difficulty, risk)),
    toolUseNeed: standardBuild ? 0.7 : 0.35,
    visualNeed: /\b(image|screenshot|visual)\b/.test(text) ? 0.8 : 0,
    verificationNeed: input.requestedDepth === "production" ? 1 : sensitive ? 0.9 : standardBuild ? 0.65 : 0.3,
    reversibility: style ? 0.95 : migration ? 0.25 : 0.7,
    failureHistory,
    recommendedIntelligenceTier: tier,
    recommendedExecutionDepth: input.requestedDepth ?? "standard",
    confidence: ambiguity > 0.5 && !input.activeMission ? 0.55 : 0.88,
    reasons,
    missionComplexity: simpleProjectCreation || simpleBoundedWork ? 2 : projectWide || migration ? 5 : complexCreation || crossLayer || sensitive ? 4 : standardBuild ? 3 : 2,
    repositoryComplexity: (input.projectFileCount ?? 0) < 100 ? 1 : (input.projectFileCount ?? 0) < 1000 ? 2 : (input.projectFileCount ?? 0) < 10000 ? 3 : (input.projectFileCount ?? 0) < 50000 ? 4 : 5,
    expectedFiles: estimatedFiles,
    effectiveIntelligence: tier,
  };
}

function profileFromDynamicAssessment(input: TaskContext, assessment: DynamicTaskAssessment, failureHistory: number): TaskProfile {
  const activeText = activeTaskScope(input.message).toLowerCase();
  const explicitStaticSite = /\b(?:static\s+(?:html|website|site)|html\s*\+\s*css\s*\+\s*(?:javascript|js)|vanilla\s+(?:javascript|js)|static html)\b/.test(activeText)
    && !/\b(?:backend|database|authentication|auth|login|accounts?|payments?|api|server|external integration|third-party integration)\b/.test(stripNegatedRiskClaims(activeText));

  if (explicitStaticSite && failureHistory === 0) {
    const estimatedFiles = Math.max(3, Math.min(8, Math.round(assessment.estimatedFiles || 3)));
    return {
      intent: assessment.taskType,
      taskType: assessment.taskType,
      requestedOutcome: input.message,
      scope: { estimatedFiles, estimatedSubsystems: 1, crossLayer: false, projectWide: false },
      projectScale: clamp((input.projectFileCount ?? 0) / 100_000),
      taskLocality: clamp(1 - estimatedFiles / 20),
      difficulty: Math.min(0.5, clamp(assessment.difficulty)),
      ambiguity: Math.min(0.45, clamp(assessment.uncertainty)),
      risk: Math.min(0.2, clamp(assessment.risk)),
      blastRadius: clamp(estimatedFiles / 20),
      contextNeed: Math.min(0.5, clamp(assessment.contextRequired)),
      reasoningNeed: Math.min(0.5, clamp(Math.max(assessment.difficulty, assessment.uncertainty))),
      toolUseNeed: 0.7,
      visualNeed: assessment.visualOutcome ? 1 : 0,
      verificationNeed: 0.65,
      reversibility: 0.9,
      failureHistory,
      recommendedIntelligenceTier: estimatedFiles <= 5 ? "fast" : "builder",
      recommendedExecutionDepth: input.requestedDepth ?? "standard",
      confidence: Math.max(0.9, clamp(assessment.confidence)),
      reasons: ["explicit static HTML/CSS/JavaScript site with no backend or external services", `bounded static assessment: ${estimatedFiles} likely files, 1 subsystem`],
      missionComplexity: 2,
      repositoryComplexity: 1,
      expectedFiles: estimatedFiles,
      effectiveIntelligence: estimatedFiles <= 5 ? "fast" : "builder",
    };
  }

  const estimatedFiles = Math.max(1, Math.min(100, Math.round(assessment.estimatedFiles)));
  const estimatedSubsystems = Math.max(1, Math.min(10, Math.round(assessment.estimatedSubsystems)));
  const projectWide = assessment.affectedScope === "project-wide";
  const crossLayer = assessment.affectedScope === "multi-subsystem" || estimatedSubsystems >= 3;
  const difficulty = clamp(assessment.difficulty);
  const ambiguity = clamp(assessment.uncertainty);
  const risk = clamp(assessment.risk + failureHistory * 0.12);
  let tier: ModelTier;
  const reasons = [...assessment.reasons];

  const critical = assessment.independentReviewNeeded && difficulty >= 0.85 && risk >= 0.8 && ambiguity >= 0.65 && (estimatedSubsystems >= 4 || failureHistory >= 2);
  const broadMigration = assessment.migration && (projectWide || estimatedFiles >= 15 || estimatedSubsystems >= 3);
  const boundedFacts = !assessment.securityOrPayment && !assessment.migration && !crossLayer && !projectWide && estimatedFiles <= 12 && estimatedSubsystems <= 2;
  const architectureRisk = assessment.securityOrPayment
    || crossLayer
    || risk >= 0.7
    || ((difficulty >= 0.82 || ambiguity >= 0.8) && (estimatedFiles >= 15 || estimatedSubsystems >= 3 || projectWide));
  const clearlyCheap = boundedFacts && failureHistory === 0 && estimatedFiles <= 3 && difficulty <= 0.5 && ambiguity <= 0.55 && risk <= 0.3;
  const boundedBuild = boundedFacts && difficulty <= 0.75 && risk <= 0.5;

  if (critical) tier = "super-reasoning";
  else if (broadMigration) tier = "enterprise-architect";
  else if (architectureRisk) tier = "architect";
  else if (clearlyCheap || (assessment.repetitive && estimatedFiles <= 12)) tier = "fast";
  else if (boundedBuild) tier = assessment.projectCreation && estimatedFiles <= 3 ? "fast" : "builder";
  else tier = "builder";

  if (boundedFacts && (tier === "architect" || tier === "enterprise-architect" || tier === "super-reasoning")) {
    tier = "builder";
    reasons.push("deterministic scope sanity check capped a bounded, non-sensitive, single-layer task at Builder");
  }
  reasons.push(`dynamic assessment: ${assessment.affectedScope}, ${estimatedFiles} likely files, ${estimatedSubsystems} subsystems`);
  return {
    intent: assessment.taskType,
    taskType: assessment.taskType,
    requestedOutcome: input.message,
    scope: { estimatedFiles, estimatedSubsystems, crossLayer, projectWide },
    projectScale: clamp((input.projectFileCount ?? 0) / 100_000),
    taskLocality: clamp(1 - estimatedFiles / 20),
    difficulty,
    ambiguity,
    risk,
    blastRadius: clamp(projectWide ? 0.95 : Math.max(estimatedFiles / 20, estimatedSubsystems / 6)),
    contextNeed: clamp(assessment.contextRequired),
    reasoningNeed: clamp(Math.max(difficulty, risk, ambiguity)),
    toolUseNeed: assessment.taskType === "explain" ? 0.3 : 0.7,
    visualNeed: assessment.visualOutcome ? 1 : 0,
    verificationNeed: assessment.securityOrPayment ? 1 : assessment.taskType === "edit" || assessment.taskType === "build" || assessment.taskType === "debug" ? 0.7 : 0.35,
    reversibility: assessment.migration ? 0.2 : assessment.repetitive ? 0.9 : 0.65,
    failureHistory,
    recommendedIntelligenceTier: tier,
    recommendedExecutionDepth: input.requestedDepth ?? "standard",
    confidence: clamp(assessment.confidence),
    reasons,
    missionComplexity: tier === "fast" ? 2 : tier === "builder" ? 3 : tier === "architect" ? 4 : 5,
    repositoryComplexity: (input.projectFileCount ?? 0) < 100 ? 1 : (input.projectFileCount ?? 0) < 1000 ? 2 : (input.projectFileCount ?? 0) < 10000 ? 3 : (input.projectFileCount ?? 0) < 50000 ? 4 : 5,
    expectedFiles: estimatedFiles,
    effectiveIntelligence: tier,
  };
}

function stripNegatedRiskClaims(text: string) {
  return text.replace(
    /\b(?:no|without|does(?:n't| not) (?:need|use|have)|do not (?:need|use|have))\b(?:(?!\b(?:but|however|although|requires?|including|with)\b)[^.!?\n]){0,160}/g,
    (clause) => clause.replace(/\b(?:backend|database|authentication|auth|payments?|security|login|accounts?|framework|(?:external\s+)?integrations?)\b/g, ""),
  );
}

function activeTaskScope(text: string) {
  return text
    .replace(/^Alternative stacks:.*$/gim, "")
    .replace(/^Anticipated future capabilities \(not building now[^\n]*$/gim, "")
    .replace(/^Confidence map:.*$/gim, "");
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }

export type GeneratedRecoveryDecision = {
  isFoundryGeneratedProject: boolean;
  hasPreModelBrowserEvidence: boolean;
  isUndo: boolean;
  hasRunnableEntry: boolean;
  isControlContinuation: boolean;
  hasOpenPlanItems: boolean;
  commandOnly: boolean;
  deletesProject: boolean;
};

/** Recovery exists to continue unfinished work, never to convert an old green checklist into proof
 * for a new change. A runnable project with no open plan items goes through normal implementation
 * unless an independently fingerprinted retry was already returned before this policy is reached. */
export function shouldResumeIncompleteGeneratedProject(input: GeneratedRecoveryDecision) {
  return input.isFoundryGeneratedProject
    && !input.hasPreModelBrowserEvidence
    && !input.isUndo
    && (!input.hasRunnableEntry || (input.isControlContinuation && input.hasOpenPlanItems))
    && !input.commandOnly
    && !input.deletesProject;
}

export function buildOnlyRecoveryCanComplete(input: {
  buildPassed: boolean;
  hasRunnableEntry: boolean;
  hasPreModelBrowserEvidence: boolean;
  hasOpenPlanItems: boolean;
  mutatingOutcomeRequired: boolean;
}) {
  return input.buildPassed
    && input.hasRunnableEntry
    && !input.hasPreModelBrowserEvidence
    && !input.hasOpenPlanItems
    && !input.mutatingOutcomeRequired;
}

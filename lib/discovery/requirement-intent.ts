/** Architecture-changing requirements must come from the user's words, not from a UI noun. */
export function isPresentationOnlyAuthSurface(text: string): boolean {
  const value = text.toLowerCase();
  const namesAuthSurface = /\b(?:login|log in|sign[- ]?in|sign[- ]?up|register|registration)\b/.test(value);
  const namesUiSurface = /\b(?:page|screen|form|ui|design|mockup|prototype)\b/.test(value);
  if (!namesAuthSurface || !namesUiSurface) return false;
  return !/\b(?:auth(?:entication|enticate)?|verify credentials?|password hash(?:ing)?|sessions?|http[- ]?only|cookies?|protected routes?|access control|oauth|mfa|account creation|create accounts?|user registration|password reset|forgot password|backend|server|api|database|persist(?:ence|ent)?|shared across|multi[- ]user|real users?)\b/.test(value);
}

export function requiresFunctionalAuthentication(text: string): boolean {
  const value = text.toLowerCase();
  if (isPresentationOnlyAuthSurface(value)) return false;
  return /\b(?:auth(?:entication|enticate)?|login|log in|sign[- ]?in|sign[- ]?up|password|sessions?|user accounts?|member accounts?|oauth|mfa|password reset|protected routes?|access control)\b/.test(value);
}

export function requiresServerCapability(text: string): boolean {
  const value = text.toLowerCase();
  return requiresFunctionalAuthentication(value)
    || /\b(?:backend|server|api|webhook|database|postgres|mysql|sqlite|mongodb|persist(?:ence|ent)?|shared data|multi[- ]user|payments?|checkout|billing|subscriptions?|real[- ]time|websocket|file uploads?|background jobs?|worker|queue)\b/.test(value);
}

export function isSmallClientOnlyWebRequest(text: string): boolean {
  const value = text.toLowerCase();
  const namesWebSurface = /\b(?:page|screen|form|website|site|landing|portfolio|brochure|calculator|timer|quiz|gallery|menu|resume|coming soon)\b/.test(value);
  const explicitlyLarge = /\b(?:production[- ]ready|enterprise|multi[- ]tenant|platform|marketplace|saas|portal|management system)\b/.test(value);
  return namesWebSurface && !explicitlyLarge && !requiresServerCapability(value);
}

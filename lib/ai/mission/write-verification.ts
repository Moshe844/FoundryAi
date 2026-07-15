export function assessWriteVerification(before: string, expected: string, actual: string, existedBefore: boolean) {
  const contentChanged = existedBefore ? before !== actual : true;
  const verified = actual === expected;
  return { verified, contentChanged, noOp: verified && !contentChanged };
}

export function isEmptySourceWrite(filePath: string, content: string) {
  return !content.trim() && /\.(?:html?|css|scss|sass|less|js|jsx|ts|tsx|mjs|cjs|vue|svelte|json|ya?ml|toml|xml|py|rb|php|java|kt|cs|go|rs|dart|swift)$/i.test(filePath);
}

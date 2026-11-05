/**
 * Optional text polish hook. Gemma ASR is out of v1.
 * Default OFF — never called unless polishEnabled is true in storage.
 */
export async function maybePolish(text, { enabled } = {}) {
  if (!enabled) return text;
  return text;
}

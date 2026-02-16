export function errorEnvelope(code: string, message: string, details: Record<string, unknown> = {}) {
  return { error: { code, message, details } };
}

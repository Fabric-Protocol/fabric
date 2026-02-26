export type FabricErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function parseErrorEnvelope(value: unknown): FabricErrorEnvelope | null {
  if (typeof value !== 'object' || value === null) return null;
  const envelope = value as { error?: unknown };
  if (typeof envelope.error !== 'object' || envelope.error === null) return null;
  const errorObject = envelope.error as { code?: unknown; message?: unknown; details?: unknown };
  if (typeof errorObject.code !== 'string' || typeof errorObject.message !== 'string') return null;
  return {
    error: {
      code: errorObject.code,
      message: errorObject.message,
      details: errorObject.details,
    },
  };
}

export class FabricError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'FabricError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class FabricHttpError extends Error {
  readonly status: number;
  readonly rawBody: string;
  readonly parsedBody: unknown;

  constructor(status: number, message: string, rawBody: string, parsedBody: unknown) {
    super(message);
    this.name = 'FabricHttpError';
    this.status = status;
    this.rawBody = rawBody;
    this.parsedBody = parsedBody;
  }
}

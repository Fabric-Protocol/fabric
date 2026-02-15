declare const process: any;

declare module 'node:crypto';
declare module 'node:fs/promises';
declare module 'node:path';

declare module 'dotenv' {
  const dotenv: { config: () => void };
  export default dotenv;
}

declare module 'pg' {
  export class Pool {
    constructor(config?: any);
    query(text: string, params?: any[]): Promise<{ rows: any[] }>;
    end(): Promise<void>;
  }
}

declare module 'fastify' {
  export interface FastifyRequest { [k: string]: any }
  export default function Fastify(opts?: any): any;
}

declare module 'zod' {
  export const z: any;
}

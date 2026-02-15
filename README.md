# Fabric API MVP

Fastify + TypeScript backend implementing the Fabric API contracts in `docs/specs`.

## Run locally
1. Copy env values:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Bootstrap database schema from authoritative DDL:
   ```bash
   npm run db:bootstrap
   ```
4. Start server:
   ```bash
   npm start
   ```

The service binds to `HOST`/`PORT` (default `0.0.0.0:3000`).

## Test
```bash
npm test
```

## Lint + Typecheck
```bash
npm run lint
npm run typecheck
```

## Cloud Run
Build and run via included Dockerfile:
```bash
docker build -t fabric-api .
docker run --rm -p 8080:8080 --env-file .env fabric-api
```

Cloud Run compatibility:
- container exposes `8080`
- app binds `0.0.0.0`
- runtime reads `PORT`

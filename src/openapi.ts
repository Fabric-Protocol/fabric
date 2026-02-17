export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Fabric API',
    version: 'v1',
    description: 'Fabric backend API (MVP)',
  },
  servers: [
    { url: '/' },
  ],
  paths: {
    '/healthz': {
      get: {
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Service health',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                  },
                  required: ['ok'],
                },
              },
            },
          },
        },
      },
    },
    '/v1/meta': {
      get: {
        summary: 'Service metadata',
        responses: {
          '200': {
            description: 'Meta payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    api_version: { type: 'string' },
                    required_legal_version: { type: 'string' },
                    openapi_url: { type: 'string' },
                  },
                  required: ['api_version', 'required_legal_version', 'openapi_url'],
                },
              },
            },
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        summary: 'OpenAPI JSON document',
        responses: {
          '200': {
            description: 'OpenAPI spec',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    openapi: { type: 'string' },
                  },
                  required: ['openapi'],
                },
              },
            },
          },
        },
      },
    },
    '/v1/bootstrap': {
      post: {
        summary: 'Bootstrap node and issue initial API key',
        responses: {
          '200': { description: 'Bootstrap result' },
          '422': { description: 'Validation or legal assent error' },
        },
      },
    },
    '/v1/me': {
      get: {
        summary: 'Get current node profile',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': { description: 'Node profile' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description: 'Format: ApiKey <api_key>',
      },
      AdminKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Admin-Key',
      },
    },
  },
} as const;

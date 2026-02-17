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
                    legal_urls: { type: 'object' },
                    support_url: { type: 'string' },
                    docs_urls: { type: 'object' },
                  },
                  required: ['api_version', 'required_legal_version', 'openapi_url', 'legal_urls', 'support_url', 'docs_urls'],
                },
              },
            },
          },
        },
      },
    },
    '/legal/terms': {
      get: {
        summary: 'Terms of Service page',
        responses: { '200': { description: 'HTML terms page', content: { 'text/html': {} } } },
      },
    },
    '/legal/privacy': {
      get: {
        summary: 'Privacy policy page',
        responses: { '200': { description: 'HTML privacy page', content: { 'text/html': {} } } },
      },
    },
    '/legal/acceptable-use': {
      get: {
        summary: 'Acceptable use policy page',
        responses: { '200': { description: 'HTML acceptable-use page', content: { 'text/html': {} } } },
      },
    },
    '/legal/aup': {
      get: {
        summary: 'Compatibility alias for acceptable use policy',
        responses: { '200': { description: 'HTML acceptable-use page', content: { 'text/html': {} } } },
      },
    },
    '/legal/refunds': {
      get: {
        summary: 'Refunds and cancellation policy page',
        responses: { '200': { description: 'HTML refunds page', content: { 'text/html': {} } } },
      },
    },
    '/legal/agents': {
      get: {
        summary: 'Agent/API terms page',
        responses: { '200': { description: 'HTML agent terms page', content: { 'text/html': {} } } },
      },
    },
    '/support': {
      get: {
        summary: 'Support and abuse contacts page',
        responses: { '200': { description: 'HTML support page', content: { 'text/html': {} } } },
      },
    },
    '/docs/agents': {
      get: {
        summary: 'Agent quickstart documentation page',
        responses: { '200': { description: 'HTML quickstart page', content: { 'text/html': {} } } },
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
    '/v1/credits/quote': {
      get: {
        summary: 'Get credits/search/top-up quote catalog',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': { description: 'Quote catalog' },
          '401': { description: 'Unauthorized' },
        },
      },
      post: {
        summary: 'Estimate search credit cost without executing search',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': { description: 'Quote estimate' },
          '401': { description: 'Unauthorized' },
          '422': { description: 'Validation error' },
        },
      },
    },
    '/v1/billing/topups/checkout-session': {
      post: {
        summary: 'Create Stripe Checkout Session for a credit top-up pack',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': { description: 'Top-up checkout session created' },
          '401': { description: 'Unauthorized' },
          '422': { description: 'Validation error' },
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

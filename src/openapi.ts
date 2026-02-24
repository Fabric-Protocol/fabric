const REGION_ID_PATTERN = '^[A-Z]{2}(-[A-Z0-9]{1,3})?$';

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
                    categories_url: { type: 'string' },
                    categories_version: { type: 'integer' },
                    mcp_url: { type: 'string', description: 'URL of the read-only MCP (Model Context Protocol) endpoint.' },
                    legal_urls: { type: 'object' },
                    support_url: { type: 'string' },
                    docs_urls: { type: 'object' },
                    agent_toc: {
                      type: 'object',
                      description: 'Machine-readable table of contents for agent onboarding',
                      properties: {
                        start_here: { type: 'array', items: { type: 'string' } },
                        capabilities: { type: 'array', items: { type: 'string' } },
                        invariants: { type: 'array', items: { type: 'string' } },
                        trust_safety_rules: { type: 'array', items: { type: 'string' } },
                      },
                      required: ['start_here', 'capabilities', 'invariants', 'trust_safety_rules'],
                    },
                  },
                  required: ['api_version', 'required_legal_version', 'openapi_url', 'categories_url', 'categories_version', 'legal_urls', 'support_url', 'docs_urls', 'agent_toc'],
                },
              },
            },
          },
        },
      },
    },
    '/v1/categories': {
      get: {
        summary: 'Category registry for units/requests and search filters',
        responses: {
          '200': {
            description: 'Categories payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CategoriesResponse' },
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
    '/mcp': {
      post: {
        summary: 'MCP (Model Context Protocol) read-only endpoint',
        description: 'JSON-RPC 2.0 endpoint exposing read-only Fabric tools for agent integration. Supports initialize, tools/list, and tools/call methods.',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  jsonrpc: { type: 'string', enum: ['2.0'] },
                  id: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
                  method: { type: 'string', enum: ['initialize', 'tools/list', 'tools/call', 'notifications/initialized'] },
                  params: { type: 'object' },
                },
                required: ['jsonrpc', 'method'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'JSON-RPC 2.0 response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jsonrpc: { type: 'string' },
                    id: {},
                    result: {},
                    error: { type: 'object' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '429': { description: 'Rate limit exceeded' },
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
    '/v1/email/start-verify': {
      post: {
        summary: 'Start email verification for the authenticated node',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': { description: 'Verification challenge created and code sent' },
          '401': { description: 'Unauthorized' },
          '422': { description: 'Validation error' },
          '503': { description: 'Email delivery failed' },
        },
      },
    },
    '/v1/email/complete-verify': {
      post: {
        summary: 'Complete email verification using OTP code',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': { description: 'Email verified' },
          '401': { description: 'Unauthorized' },
          '422': { description: 'Validation error' },
          '429': { description: 'Attempts exceeded' },
        },
      },
    },
    '/v1/recovery/start': {
      post: {
        summary: 'Start public API key recovery challenge (pubkey only in MVP)',
        responses: {
          '200': { description: 'Recovery challenge created' },
          '404': { description: 'Node not found' },
          '422': { description: 'Validation error' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/v1/recovery/complete': {
      post: {
        summary: 'Complete public API key recovery challenge (signature only in MVP)',
        responses: {
          '200': { description: 'New API key minted' },
          '404': { description: 'Challenge not found' },
          '409': { description: 'Challenge already used' },
          '422': { description: 'Validation error' },
          '429': { description: 'Attempts exceeded' },
        },
      },
    },
    '/v1/me': {
      get: {
        summary: 'Get current node profile',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'Node profile',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MeResponse' },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
      patch: {
        summary: 'Update current node profile',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MePatchRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated node profile',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MeResponse' },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '422': { description: 'Validation error' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/v1/credits/quote': {
      get: {
        summary: 'Get credits/search/Credit Pack quote catalog',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': { description: 'Quote catalog' },
          '401': { description: 'Unauthorized' },
        },
      },
      post: {
        summary: 'Estimate search credit cost without executing search',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SearchQuoteRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Quote estimate' },
          '401': { description: 'Unauthorized' },
          '422': { description: 'Validation error' },
        },
      },
    },
    '/v1/search/listings': {
      post: {
        summary: 'Search public listings',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SearchRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Search result page' },
          '400': { description: 'Invalid search cursor' },
          '401': { description: 'Unauthorized' },
          '402': { description: 'Credits exhausted' },
          '403': { description: 'Forbidden' },
          '422': { description: 'Validation error' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/v1/search/requests': {
      post: {
        summary: 'Search public requests',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SearchRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Search result page' },
          '400': { description: 'Invalid search cursor' },
          '401': { description: 'Unauthorized' },
          '402': { description: 'Credits exhausted' },
          '403': { description: 'Forbidden' },
          '422': { description: 'Validation error' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/v1/billing/topups/checkout-session': {
      post: {
        summary: 'Create Stripe Checkout Session for a Credit Pack',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': { description: 'Credit Pack checkout session created' },
          '401': { description: 'Unauthorized' },
          '422': { description: 'Validation error' },
        },
      },
    },
    '/v1/billing/topups/bcon/invoice': {
      post: {
        summary: 'Create a Bcon payment invoice for a Credit Pack',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BconTopupInvoiceRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Bcon invoice created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BconTopupInvoiceResponse' },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden' },
          '422': { description: 'Validation error' },
        },
      },
    },
    '/v1/webhooks/bcon': {
      post: {
        summary: 'Process Bcon payment callback',
        description: 'Public webhook endpoint. Validate callback secret via query parameter `secret`.',
        responses: {
          '200': { description: 'Webhook accepted' },
          '401': { description: 'Invalid callback secret' },
          '422': { description: 'Invalid payload' },
          '500': { description: 'Webhook not configured or internal error' },
        },
      },
    },
    '/v1/requests': {
      post: {
        summary: 'Create a new request',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RequestCreateRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Request created', content: { 'application/json': { schema: { $ref: '#/components/schemas/RequestCreateResponse' } } } },
          '400': { description: 'Validation error (including ttl_minutes out of range)' },
          '401': { description: 'Unauthorized' },
          '422': { description: 'Validation error' },
        },
      },
    },
    '/v1/requests/{request_id}': {
      patch: {
        summary: 'Patch a request',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/RequestIdPath' },
          { $ref: '#/components/parameters/IdempotencyKeyHeader' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RequestPatchRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Request patched', content: { 'application/json': { schema: { $ref: '#/components/schemas/RequestPatchResponse' } } } },
          '400': { description: 'Validation error (including ttl_minutes out of range)' },
          '401': { description: 'Unauthorized' },
          '409': { description: 'Stale write conflict' },
          '422': { description: 'Validation error' },
        },
      },
    },
    '/v1/offers': {
      post: {
        summary: 'Create a new offer',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OfferCreateRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Offer created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OfferResponse' },
              },
            },
          },
          '400': { description: 'Validation error (including ttl_minutes out of range)' },
          '401': { description: 'Unauthorized' },
          '409': { description: 'Offer conflict' },
          '422': { description: 'Validation or legal assent error' },
          '429': { description: 'Pre-purchase daily limit exceeded' },
        },
      },
    },
    '/v1/offers/{offer_id}/counter': {
      post: {
        summary: 'Counter an existing offer',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/OfferIdPath' },
          { $ref: '#/components/parameters/IdempotencyKeyHeader' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OfferCounterRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Counter-offer created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OfferResponse' },
              },
            },
          },
          '400': { description: 'Validation error (including ttl_minutes out of range)' },
          '401': { description: 'Unauthorized' },
          '404': { description: 'Offer not found' },
          '422': { description: 'Validation or legal assent error' },
          '429': { description: 'Pre-purchase daily limit exceeded' },
        },
      },
    },
    '/v1/offers/{offer_id}/accept': {
      post: {
        summary: 'Accept an offer',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/OfferIdPath' },
          { $ref: '#/components/parameters/IdempotencyKeyHeader' },
        ],
        responses: {
          '200': {
            description: 'Offer acceptance updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OfferResponse' },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Offer not found' },
          '402': { description: 'Not enough credits' },
          '409': { description: 'Invalid state transition' },
          '422': { description: 'Legal assent required' },
          '429': { description: 'Pre-purchase daily limit exceeded' },
        },
      },
    },
    '/v1/offers/{offer_id}/reveal-contact': {
      post: {
        summary: 'Reveal contact details for a mutually accepted offer',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/OfferIdPath' },
          { $ref: '#/components/parameters/IdempotencyKeyHeader' },
        ],
        responses: {
          '200': {
            description: 'Contact revealed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RevealContactResponse' },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Offer not found' },
          '409': { description: 'Offer not mutually accepted' },
          '422': { description: 'Legal assent required' },
        },
      },
    },
    '/events': {
      get: {
        summary: 'List offer lifecycle events for the authenticated node',
        description: 'Polling fallback for offer lifecycle events. Use next_cursor as the next since value. Delivery is at-least-once; dedupe by event id.',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/EventsSinceQuery' },
          { $ref: '#/components/parameters/EventsLimitQuery' },
        ],
        responses: {
          '200': {
            description: 'Event stream page',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EventsListResponse' },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '422': { description: 'Invalid cursor or pagination params' },
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
    parameters: {
      IdempotencyKeyHeader: {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string' },
        description: 'Required for all non-GET endpoints (except webhooks)',
      },
      OfferIdPath: {
        name: 'offer_id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      RequestIdPath: {
        name: 'request_id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      EventsSinceQuery: {
        name: 'since',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Opaque cursor string. Returns events strictly after this cursor.',
      },
      EventsLimitQuery: {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    },
    schemas: {
      Category: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          slug: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          examples: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'slug', 'name', 'description', 'examples'],
      },
      CategoriesResponse: {
        type: 'object',
        properties: {
          categories_version: { type: 'integer' },
          categories: {
            type: 'array',
            items: { $ref: '#/components/schemas/Category' },
          },
        },
        required: ['categories_version', 'categories'],
      },
      BconTopupInvoiceRequest: {
        type: 'object',
        properties: {
          node_id: { type: 'string', format: 'uuid' },
          pack_code: { type: 'string', enum: ['credits_500', 'credits_1500', 'credits_4500'] },
          chain: { type: 'string' },
          payment_currency: { type: 'string' },
        },
        required: ['node_id', 'pack_code', 'chain', 'payment_currency'],
      },
      BconTopupInvoiceResponse: {
        type: 'object',
        properties: {
          invoice_id: { type: 'string', format: 'uuid' },
          address: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          chain: { type: 'string' },
        },
        required: ['invoice_id', 'address', 'amount', 'currency', 'chain'],
      },
      SearchFilters: {
        type: 'object',
        properties: {
          center: { type: 'object', additionalProperties: true },
          radius_miles: { type: 'number' },
          regions: { type: 'array', items: { type: 'string', pattern: REGION_ID_PATTERN } },
          languages: { type: 'array', items: { type: 'string' } },
          ship_to_regions: { type: 'array', items: { type: 'string', pattern: REGION_ID_PATTERN } },
          ships_from_regions: { type: 'array', items: { type: 'string', pattern: REGION_ID_PATTERN } },
          max_ship_days: { type: 'integer', minimum: 1, maximum: 30 },
          delivery_methods: { type: 'array', items: { type: 'string' } },
          scope_notes: { type: 'string' },
          category_ids_any: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Forward-compatible category filter. Unknown IDs are accepted and return empty results when no items match.',
          },
        },
        additionalProperties: true,
      },
      SearchTarget: {
        type: 'object',
        properties: {
          node_id: { type: 'string', format: 'uuid', nullable: true },
          username: { type: 'string', nullable: true },
        },
        required: [],
      },
      SearchRequest: {
        type: 'object',
        properties: {
          q: { type: 'string', nullable: true },
          scope: { type: 'string', enum: ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'] },
          filters: { $ref: '#/components/schemas/SearchFilters' },
          broadening: {
            type: 'object',
            nullable: true,
            description: 'Deprecated. Optional; omitted or null defaults to { level: 0, allow: false }.',
            properties: {
              level: { type: 'integer', minimum: 0 },
              allow: { type: 'boolean' },
            },
            required: ['level', 'allow'],
          },
          budget: {
            type: 'object',
            properties: {
              credits_requested: { type: 'integer', minimum: 0, description: 'Hard credit cap; server returns 402 budget_cap_exceeded if computed cost exceeds this value.' },
              credits_max: { type: 'integer', minimum: 0, deprecated: true, description: 'Deprecated alias for credits_requested.' },
            },
            anyOf: [
              { required: ['credits_requested'] },
              { required: ['credits_max'] },
            ],
          },
          target: { $ref: '#/components/schemas/SearchTarget' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          cursor: { type: 'string', nullable: true },
        },
        required: ['q', 'scope', 'filters', 'budget', 'limit', 'cursor'],
      },
      SearchQuoteRequest: {
        type: 'object',
        properties: {
          q: { type: 'string', nullable: true },
          scope: { type: 'string', enum: ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'] },
          filters: { $ref: '#/components/schemas/SearchFilters' },
          broadening: {
            type: 'object',
            nullable: true,
            description: 'Deprecated. Optional; omitted or null defaults to { level: 0, allow: false }.',
            properties: {
              level: { type: 'integer', minimum: 0 },
              allow: { type: 'boolean' },
            },
            required: ['level', 'allow'],
          },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          cursor: { type: 'string', nullable: true },
        },
        required: ['q', 'scope', 'filters', 'limit', 'cursor'],
      },
      OfferCreateRequest: {
        type: 'object',
        properties: {
          unit_ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
          thread_id: { type: 'string', nullable: true },
          note: { type: 'string', nullable: true },
          ttl_minutes: { type: 'integer', minimum: 15, maximum: 10080 },
        },
        required: ['unit_ids', 'thread_id', 'note'],
      },
      OfferCounterRequest: {
        type: 'object',
        properties: {
          unit_ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
          note: { type: 'string', nullable: true },
          ttl_minutes: { type: 'integer', minimum: 15, maximum: 10080 },
        },
        required: ['unit_ids', 'note'],
      },
      RequestCreateRequest: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          type: { type: 'string', nullable: true },
          condition: { type: 'string', nullable: true },
          quantity: { type: 'number', nullable: true },
          measure: { type: 'string', nullable: true },
          custom_measure: { type: 'string', nullable: true },
          scope_primary: { type: 'string', enum: ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'], nullable: true },
          scope_secondary: { type: 'array', items: { type: 'string' }, nullable: true },
          scope_notes: { type: 'string', nullable: true },
          location_text_public: { type: 'string', nullable: true },
          origin_region: { type: 'object', additionalProperties: true, nullable: true },
          dest_region: { type: 'object', additionalProperties: true, nullable: true },
          service_region: { type: 'object', additionalProperties: true, nullable: true },
          delivery_format: { type: 'string', nullable: true },
          max_ship_days: { type: 'integer', minimum: 1, maximum: 30, nullable: true },
          need_by: { type: 'string', nullable: true },
          accept_substitutions: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          category_ids: { type: 'array', items: { type: 'integer' } },
          public_summary: { type: 'string', nullable: true },
          ttl_minutes: { type: 'integer', minimum: 60, maximum: 43200 },
        },
        required: ['title'],
      },
      RequestPatchRequest: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          type: { type: 'string', nullable: true },
          condition: { type: 'string', nullable: true },
          quantity: { type: 'number', nullable: true },
          measure: { type: 'string', nullable: true },
          custom_measure: { type: 'string', nullable: true },
          scope_primary: { type: 'string', enum: ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'], nullable: true },
          scope_secondary: { type: 'array', items: { type: 'string' }, nullable: true },
          scope_notes: { type: 'string', nullable: true },
          location_text_public: { type: 'string', nullable: true },
          origin_region: { type: 'object', additionalProperties: true, nullable: true },
          dest_region: { type: 'object', additionalProperties: true, nullable: true },
          service_region: { type: 'object', additionalProperties: true, nullable: true },
          delivery_format: { type: 'string', nullable: true },
          max_ship_days: { type: 'integer', minimum: 1, maximum: 30, nullable: true },
          need_by: { type: 'string', nullable: true },
          accept_substitutions: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          category_ids: { type: 'array', items: { type: 'integer' } },
          public_summary: { type: 'string', nullable: true },
          ttl_minutes: { type: 'integer', minimum: 60, maximum: 43200 },
        },
      },
      RequestSummary: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          node_id: { type: 'string', format: 'uuid' },
          publish_status: { type: 'string' },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
          version: { type: 'integer' },
          expires_at: { type: 'string' },
        },
        required: ['id', 'node_id', 'publish_status', 'created_at', 'updated_at', 'version', 'expires_at'],
      },
      RequestCreateResponse: {
        type: 'object',
        properties: {
          request: { $ref: '#/components/schemas/RequestSummary' },
        },
        required: ['request'],
      },
      RequestPatchResponse: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          version: { type: 'integer' },
          expires_at: { type: 'string' },
        },
        required: ['id', 'version', 'expires_at'],
      },
      Offer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          thread_id: { type: 'string', format: 'uuid' },
          from_node_id: { type: 'string', format: 'uuid' },
          to_node_id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          expires_at: { type: 'string' },
          accepted_by_from_at: { type: 'string', nullable: true },
          accepted_by_to_at: { type: 'string', nullable: true },
          held_unit_ids: { type: 'array', items: { type: 'string' } },
          unheld_unit_ids: { type: 'array', items: { type: 'string' } },
          hold_status: { type: 'string', nullable: true },
          hold_expires_at: { type: 'string', nullable: true },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
          version: { type: 'integer' },
          unit_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'thread_id', 'from_node_id', 'to_node_id', 'status', 'expires_at', 'created_at', 'updated_at', 'version', 'unit_ids'],
      },
      OfferResponse: {
        type: 'object',
        properties: {
          offer: { $ref: '#/components/schemas/Offer' },
        },
        required: ['offer'],
      },
      MessagingHandle: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          handle: { type: 'string' },
          url: { type: 'string', nullable: true },
        },
        required: ['kind', 'handle', 'url'],
      },
      NodeProfile: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          display_name: { type: 'string' },
          email: { type: 'string', nullable: true },
          email_verified_at: { type: 'string', nullable: true },
          recovery_public_key_configured: { type: 'boolean' },
          messaging_handles: {
            type: 'array',
            items: { $ref: '#/components/schemas/MessagingHandle' },
          },
          event_webhook_url: {
            type: 'string',
            format: 'uri',
            nullable: true,
            maxLength: 2048,
            description: 'HTTPS webhook URL. Local/private/link-local destinations and URL fragments/credentials are rejected.',
          },
          status: { type: 'string' },
          plan: { type: 'string' },
          is_subscriber: { type: 'boolean' },
          created_at: { type: 'string' },
        },
        required: [
          'id',
          'display_name',
          'email',
          'email_verified_at',
          'recovery_public_key_configured',
          'messaging_handles',
          'event_webhook_url',
          'status',
          'plan',
          'is_subscriber',
          'created_at',
        ],
      },
      MePatchRequest: {
        type: 'object',
        properties: {
          display_name: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true },
          recovery_public_key: { type: 'string', nullable: true },
          messaging_handles: {
            type: 'array',
            maxItems: 10,
            nullable: true,
            items: { $ref: '#/components/schemas/MessagingHandle' },
          },
          event_webhook_url: {
            type: 'string',
            format: 'uri',
            nullable: true,
            maxLength: 2048,
            description: 'Absolute HTTPS URL; URL userinfo and fragment are not allowed. Set null to clear and disable webhook delivery.',
          },
          event_webhook_secret: {
            type: 'string',
            nullable: true,
            writeOnly: true,
            maxLength: 256,
            description: 'Optional signing secret. When set, webhook includes x-fabric-timestamp and x-fabric-signature (t=<timestamp>,v1=<hex_hmac_sha256>) over `${t}.${rawBody}`. Set null to clear.',
          },
        },
      },
      MeResponse: {
        type: 'object',
        properties: {
          node: { $ref: '#/components/schemas/NodeProfile' },
          subscription: {
            type: 'object',
            properties: {
              plan: { type: 'string' },
              status: { type: 'string' },
              period_start: { type: 'string', nullable: true },
              period_end: { type: 'string', nullable: true },
              credits_rollover_enabled: { type: 'boolean' },
            },
            required: ['plan', 'status', 'period_start', 'period_end', 'credits_rollover_enabled'],
          },
          credits_balance: { type: 'number' },
        },
        required: ['node', 'subscription', 'credits_balance'],
      },
      RevealContactResponse: {
        type: 'object',
        properties: {
          contact: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              phone: { type: 'string', nullable: true },
              messaging_handles: {
                type: 'array',
                items: { $ref: '#/components/schemas/MessagingHandle' },
              },
            },
            required: ['email', 'phone', 'messaging_handles'],
          },
        },
        required: ['contact'],
      },
      OfferEvent: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: {
            type: 'string',
            enum: ['offer_created', 'offer_countered', 'offer_accepted', 'offer_cancelled', 'offer_contact_revealed'],
          },
          offer_id: { type: 'string', format: 'uuid' },
          actor_node_id: { type: 'string', format: 'uuid' },
          recipient_node_id: { type: 'string', format: 'uuid' },
          payload: { type: 'object', additionalProperties: true },
          created_at: { type: 'string' },
        },
        required: ['id', 'type', 'offer_id', 'actor_node_id', 'recipient_node_id', 'payload', 'created_at'],
      },
      EventsListResponse: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            items: { $ref: '#/components/schemas/OfferEvent' },
          },
          next_cursor: { type: 'string', nullable: true },
        },
        required: ['events', 'next_cursor'],
      },
    },
  },
} as const;

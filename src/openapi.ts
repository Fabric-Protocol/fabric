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
                    legal_urls: { type: 'object' },
                    support_url: { type: 'string' },
                    docs_urls: { type: 'object' },
                  },
                  required: ['api_version', 'required_legal_version', 'openapi_url', 'categories_url', 'categories_version', 'legal_urls', 'support_url', 'docs_urls'],
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
          '401': { description: 'Unauthorized' },
          '402': { description: 'Credits exhausted' },
          '403': { description: 'Subscriber required' },
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
          '401': { description: 'Unauthorized' },
          '402': { description: 'Credits exhausted' },
          '403': { description: 'Subscriber required' },
          '422': { description: 'Validation error' },
          '429': { description: 'Rate limit exceeded' },
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
          '401': { description: 'Unauthorized' },
          '409': { description: 'Offer conflict' },
          '422': { description: 'Validation or legal assent error' },
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
          '401': { description: 'Unauthorized' },
          '404': { description: 'Offer not found' },
          '422': { description: 'Validation or legal assent error' },
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
          '409': { description: 'Invalid state transition' },
          '422': { description: 'Legal assent required' },
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
      SearchFilters: {
        type: 'object',
        properties: {
          center: { type: 'object', additionalProperties: true },
          radius_miles: { type: 'number' },
          regions: { type: 'array', items: { type: 'string' } },
          languages: { type: 'array', items: { type: 'string' } },
          ship_to_regions: { type: 'array', items: { type: 'string' } },
          ships_from_regions: { type: 'array', items: { type: 'string' } },
          max_ship_days: { type: 'number' },
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
            properties: {
              level: { type: 'integer', minimum: 0 },
              allow: { type: 'boolean' },
            },
            required: ['level', 'allow'],
          },
          budget: {
            type: 'object',
            properties: {
              credits_requested: { type: 'integer', minimum: 0 },
            },
            required: ['credits_requested'],
          },
          target: { $ref: '#/components/schemas/SearchTarget' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          cursor: { type: 'string', nullable: true },
        },
        required: ['q', 'scope', 'filters', 'broadening', 'budget', 'limit', 'cursor'],
      },
      SearchQuoteRequest: {
        type: 'object',
        properties: {
          q: { type: 'string', nullable: true },
          scope: { type: 'string', enum: ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'] },
          filters: { $ref: '#/components/schemas/SearchFilters' },
          broadening: {
            type: 'object',
            properties: {
              level: { type: 'integer', minimum: 0 },
              allow: { type: 'boolean' },
            },
            required: ['level', 'allow'],
          },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          cursor: { type: 'string', nullable: true },
        },
        required: ['q', 'scope', 'filters', 'broadening', 'limit', 'cursor'],
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
        },
        required: ['unit_ids', 'note'],
      },
      Offer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          thread_id: { type: 'string', format: 'uuid' },
          from_node_id: { type: 'string', format: 'uuid' },
          to_node_id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
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
        required: ['id', 'thread_id', 'from_node_id', 'to_node_id', 'status', 'created_at', 'updated_at', 'version', 'unit_ids'],
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

export type FabricNodeStatus = 'ACTIVE' | 'SUSPENDED';
export type FabricPlanCode = 'free' | 'basic' | 'pro' | 'business';
export type FabricSubscriptionStatus = 'none' | 'active' | 'past_due' | 'canceled';

export type NodeMessagingHandle = {
  kind: string;
  handle: string;
  url: string | null;
};

export type MeNode = {
  id: string;
  display_name: string;
  email: string | null;
  email_verified_at: string | null;
  recovery_public_key_configured: boolean;
  messaging_handles: NodeMessagingHandle[];
  event_webhook_url: string | null;
  status: FabricNodeStatus;
  plan: FabricPlanCode;
  is_subscriber: boolean;
  created_at: string;
};

export type MeSubscription = {
  plan: FabricPlanCode;
  status: FabricSubscriptionStatus;
  period_start: string | null;
  period_end: string | null;
  credits_rollover_enabled: boolean;
};

export type MeResponse = {
  node: MeNode;
  subscription: MeSubscription;
  credits_balance: number;
};

export type SearchScope = 'local_in_person' | 'remote_online_service' | 'ship_to' | 'digital_delivery' | 'OTHER';

export type SearchFilters = {
  center?: { lat: number; lng: number };
  radius_miles?: number;
  regions?: string[];
  languages?: string[];
  ship_to_regions?: string[];
  ships_from_regions?: string[];
  max_ship_days?: number;
  delivery_methods?: string[];
  scope_notes?: string;
  category_ids_any?: number[];
};

export type SearchRequestBody = {
  q: string | null;
  scope: SearchScope;
  filters: SearchFilters;
  broadening?: { level: number; allow: boolean } | null;
  budget: { credits_requested: number };
  target?: { node_id: string | null; username: string | null };
  limit: number;
  cursor: string | null;
};

export type SearchBudgetBreakdown = {
  base_search_cost: number;
  broadening_level: number;
  broadening_cost: number;
  page_index: number;
  page_cost: number;
  base_cost: number;
  pagination_addons: number;
  geo_addon: number;
};

export type SearchBudgetCoverage = {
  page_index_executed: number;
  broadening_level_executed: number;
  items_returned: number;
  executed_page_index: number;
  executed_broadening_level: number;
  returned_count: number;
};

export type SearchBudget = {
  credits_requested: number;
  credits_charged: number;
  breakdown: SearchBudgetBreakdown;
  coverage: SearchBudgetCoverage;
  was_capped: boolean;
  cap_reason: string | null;
  guidance: string | null;
};

export type SearchResultItem = {
  item: Record<string, unknown>;
  rank: {
    sort_keys: {
      distance_miles: number | null;
      route_specificity_score: number;
      fts_rank: number;
      recency_score: number;
    };
  };
};

export type SearchNodeSummary = {
  node_id: string;
  category_counts_nonzero: Record<string, number>;
};

export type SearchListingsResponse = {
  search_id: string;
  scope: SearchScope;
  limit: number;
  cursor: string | null;
  broadening: { level: number; allow: boolean };
  applied_filters: Record<string, unknown>;
  budget: SearchBudget;
  items: SearchResultItem[];
  nodes: SearchNodeSummary[];
  has_more: boolean;
};

export type OfferStatus = 'pending' | 'accepted_by_a' | 'accepted_by_b' | 'mutually_accepted' | 'rejected' | 'cancelled' | 'countered' | 'expired';

export type OfferObject = {
  id: string;
  thread_id: string;
  from_node_id: string;
  to_node_id: string;
  status: OfferStatus;
  expires_at: string;
  accepted_by_from_at: string | null;
  accepted_by_to_at: string | null;
  held_unit_ids: string[];
  unheld_unit_ids: string[];
  hold_status: string;
  hold_expires_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  [key: string]: unknown;
};

export type CreateOfferRequest = {
  unit_ids: string[];
  thread_id: string | null;
  note: string | null;
  ttl_minutes?: number;
};

export type CreateOfferResponse = {
  offer: OfferObject;
};

export type RecoveryStartRequest = {
  node_id: string;
  method: 'pubkey' | 'email';
};

export type RecoveryStartResponse = {
  challenge_id: string;
  nonce: string;
  expires_at: string;
};

export type RecoveryCompleteRequest = {
  challenge_id: string;
  signature: string;
};

export type RecoveryCompleteResponse = {
  node_id: string;
  key_id: string;
  api_key: string;
};

export type MetaResponse = {
  api_version: string;
  required_legal_version: string;
  openapi_url: string;
  categories_url: string;
  categories_version: number;
  legal_urls: {
    terms: string;
    privacy: string;
    aup: string;
  };
  support_url: string;
  docs_urls: {
    agents_url: string;
  };
};

export type BootstrapRequest = {
  display_name: string;
  email: string | null;
  referral_code: string | null;
  recovery_public_key: string | null;
  messaging_handles: NodeMessagingHandle[];
  legal: {
    accepted: true;
    version: string;
  };
};

export type BootstrapResponse = {
  node: MeNode;
  api_key: {
    key_id: string;
    api_key: string;
    created_at: string;
  };
  credits: {
    granted: number;
    reason: string;
  };
};

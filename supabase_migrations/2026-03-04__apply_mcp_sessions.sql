create table if not exists mcp_sessions (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  last_used_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists mcp_sessions_token_hash_unique on mcp_sessions(token_hash);
create index if not exists mcp_sessions_node_active_idx on mcp_sessions(node_id, revoked_at, expires_at);

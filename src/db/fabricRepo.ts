import crypto from 'node:crypto';
import { query } from './client.js';

export type NodeContext = { nodeId: string };

export async function findApiKey(rawKey: string) {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const rows = await query<{ node_id: string; plan_code: string; status: string }>(
    `select ak.node_id, coalesce(s.plan_code, 'free') as plan_code, coalesce(s.status, 'none') as status
     from api_keys ak left join subscriptions s on s.node_id=ak.node_id
     where ak.key_hash=$1 and ak.revoked_at is null limit 1`,
    [keyHash],
  );
  return rows[0] ?? null;
}

export async function getIdempotency(nodeId: string, key: string, method: string, path: string) {
  const rows = await query<{ request_hash: string; status_code: number; response_json: unknown }>(
    `select request_hash,status_code,response_json
     from idempotency_keys where node_id=$1 and key=$2 and method=$3 and path=$4 and expires_at > now() limit 1`,
    [nodeId, key, method, path],
  );
  return rows[0] ?? null;
}

export async function saveIdempotency(nodeId: string, key: string, method: string, path: string, hash: string, statusCode: number, responseJson: unknown) {
  await query(
    `insert into idempotency_keys(node_id,key,method,path,request_hash,status_code,response_json,expires_at)
     values($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours') on conflict do nothing`,
    [nodeId, key, method, path, hash, statusCode, responseJson as object],
  );
}

export async function createNode(
  displayName: string,
  email: string | null,
  legal: { acceptedAt: string; version: string; ip: string | null; userAgent: string | null },
) {
  const rows = await query<{ id: string; created_at: string; legal_accepted_at: string; legal_version: string }>(
    `insert into nodes(display_name,email,status,legal_accepted_at,legal_version,legal_ip,legal_user_agent)
     values($1,$2,'ACTIVE',$3,$4,$5,$6)
     returning id,created_at,legal_accepted_at,legal_version`,
    [displayName, email, legal.acceptedAt, legal.version, legal.ip, legal.userAgent],
  );
  return rows[0];
}

export async function createApiKey(nodeId: string, label: string | null) {
  const apiKey = crypto.randomUUID() + crypto.randomUUID();
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const rows = await query<{ id: string; created_at: string }>(
    'insert into api_keys(node_id,label,key_prefix,key_hash) values($1,$2,$3,$4) returning id,created_at',
    [nodeId, label, apiKey.slice(0, 8), keyHash],
  );
  return { ...rows[0], api_key: apiKey };
}

export async function ensureSubscription(nodeId: string) {
  await query("insert into subscriptions(node_id,plan_code,status) values($1,'free','none') on conflict (node_id) do nothing", [nodeId]);
}

export async function addCredit(nodeId: string, type: string, amount: number, meta: object = {}, idempotencyKey: string | null = null) {
  await query('insert into credit_ledger(node_id,type,amount,meta,idempotency_key) values($1,$2,$3,$4,$5)', [nodeId, type, amount, meta, idempotencyKey]);
}

export async function getMe(nodeId: string) {
  const rows = await query<any>(
    `select n.id,n.display_name,n.email,n.phone,n.status,n.created_at,
      n.legal_accepted_at,n.legal_version,n.legal_ip,n.legal_user_agent,
      coalesce(s.plan_code,'free') as plan_code, coalesce(s.status,'none') as sub_status,
      s.current_period_start,s.current_period_end
     from nodes n left join subscriptions s on s.node_id=n.id where n.id=$1 and n.deleted_at is null`,
    [nodeId],
  );
  return rows[0] ?? null;
}

export async function updateMe(nodeId: string, displayName: string | null | undefined, email: string | null | undefined) {
  const rows = await query<any>(
    `update nodes
     set display_name = coalesce($2, display_name), email = coalesce($3, email)
     where id=$1 returning id`,
    [nodeId, displayName, email],
  );
  return rows[0] ?? null;
}

export async function creditBalance(nodeId: string) {
  const rows = await query<{ balance: string }>('select coalesce(sum(amount),0)::text as balance from credit_ledger where node_id=$1', [nodeId]);
  return Number(rows[0]?.balance ?? 0);
}

export async function listKeys(nodeId: string) {
  return query<any>(
    `select id as key_id,label,last_used_at,created_at,(key_prefix || '...') as prefix
     from api_keys where node_id=$1 and revoked_at is null order by created_at desc`,
    [nodeId],
  );
}

export async function revokeKey(nodeId: string, keyId: string) {
  const rows = await query<{ id: string }>('update api_keys set revoked_at=now() where node_id=$1 and id=$2 and revoked_at is null returning id', [nodeId, keyId]);
  return !!rows[0];
}

export async function listLedger(nodeId: string, limit: number, cursor: string | null) {
  if (cursor) {
    return query<any>('select id,node_id,type,amount,created_at,meta from credit_ledger where node_id=$1 and created_at < $3::timestamptz order by created_at desc limit $2', [nodeId, limit, cursor]);
  }
  return query<any>('select id,node_id,type,amount,created_at,meta from credit_ledger where node_id=$1 order by created_at desc limit $2', [nodeId, limit]);
}

function tableFor(kind: 'units' | 'requests') { return kind; }

export async function createResource(kind: 'units'|'requests', nodeId: string, payload: any) {
  if (kind === 'units') {
    const rows = await query<any>(`insert into units(node_id,title,description,type,condition,quantity,measure,custom_measure,scope_primary,scope_secondary,scope_notes,location_text_public,origin_region,dest_region,service_region,delivery_format,tags,category_ids,public_summary)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      returning id,node_id,case when published_at is null then 'draft' else 'published' end as publish_status,created_at,updated_at,row_version as version`,
      [nodeId,payload.title,payload.description,payload.type,payload.condition,payload.quantity,payload.measure,payload.custom_measure,payload.scope_primary,payload.scope_secondary,payload.scope_notes,payload.location_text_public,payload.origin_region,payload.dest_region,payload.service_region,payload.delivery_format,payload.tags,payload.category_ids,payload.public_summary]);
    return rows[0];
  }
  const rows = await query<any>(`insert into requests(node_id,title,description,type,condition,desired_quantity,measure,custom_measure,scope_primary,scope_secondary,scope_notes,location_text_public,origin_region,dest_region,service_region,delivery_format,need_by,accept_substitutions,tags,category_ids,public_summary)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      returning id,node_id,case when published_at is null then 'draft' else 'published' end as publish_status,created_at,updated_at,row_version as version`,
      [nodeId,payload.title,payload.description,payload.type,payload.condition,payload.quantity,payload.measure,payload.custom_measure,payload.scope_primary,payload.scope_secondary,payload.scope_notes,payload.location_text_public,payload.origin_region,payload.dest_region,payload.service_region,payload.delivery_format,payload.need_by,payload.accept_substitutions ?? true,payload.tags,payload.category_ids,payload.public_summary]);
  return rows[0];
}

export async function listResources(kind:'units'|'requests', nodeId:string, limit:number, cursor:string|null) {
  const table = tableFor(kind);
  if (cursor) return query<any>(`select * from ${table} where node_id=$1 and deleted_at is null and created_at < $3::timestamptz order by created_at desc limit $2`, [nodeId, limit, cursor]);
  return query<any>(`select * from ${table} where node_id=$1 and deleted_at is null order by created_at desc limit $2`, [nodeId, limit]);
}

export async function getResource(kind:'units'|'requests', nodeId:string, id:string) {
  const idCol = kind === 'units' ? 'id' : 'id';
  const rows = await query<any>(`select * from ${kind} where ${idCol}=$1 and node_id=$2 and deleted_at is null limit 1`, [id,nodeId]);
  return rows[0] ?? null;
}

export async function patchResource(kind:'units'|'requests', nodeId:string, id:string, version:number, payload:any) {
  const rows = await query<any>(`update ${kind} set
      title=coalesce($4,title),description=coalesce($5,description),type=coalesce($6,type),condition=coalesce($7,condition),
      ${kind==='units'?'quantity':'desired_quantity'}=coalesce($8,${kind==='units'?'quantity':'desired_quantity'}),measure=coalesce($9,measure),custom_measure=coalesce($10,custom_measure),
      scope_primary=coalesce($11,scope_primary),scope_secondary=coalesce($12,scope_secondary),scope_notes=coalesce($13,scope_notes),
      location_text_public=coalesce($14,location_text_public),origin_region=coalesce($15,origin_region),dest_region=coalesce($16,dest_region),
      service_region=coalesce($17,service_region),delivery_format=coalesce($18,delivery_format),tags=coalesce($19,tags),category_ids=coalesce($20,category_ids),public_summary=coalesce($21,public_summary)
      where id=$1 and node_id=$2 and row_version=$3 and deleted_at is null
      returning id,row_version as version`,
    [id,nodeId,version,payload.title,payload.description,payload.type,payload.condition,payload.quantity,payload.measure,payload.custom_measure,payload.scope_primary,payload.scope_secondary,payload.scope_notes,payload.location_text_public,payload.origin_region,payload.dest_region,payload.service_region,payload.delivery_format,payload.tags,payload.category_ids,payload.public_summary]);
  return rows[0] ?? null;
}

export async function deleteResource(kind:'units'|'requests', nodeId:string, id:string) {
  const rows = await query<any>(`update ${kind} set deleted_at=now() where id=$1 and node_id=$2 and deleted_at is null returning id`, [id,nodeId]);
  return !!rows[0];
}

export async function setPublished(kind:'units'|'requests', id:string, published:boolean) {
  if (published) await query(`update ${kind} set published_at=now() where id=$1`, [id]);
  else await query(`update ${kind} set published_at=null where id=$1`, [id]);
}

export async function upsertProjection(kind:'units'|'requests', row:any) {
  if (kind === 'units') {
    const doc = {
      id: row.id,node_id: row.node_id,scope_primary: row.scope_primary,scope_secondary: row.scope_secondary,
      title: row.title,description: row.description,public_summary: row.public_summary,quantity: row.quantity,measure: row.measure,
      custom_measure: row.custom_measure,category_ids: row.category_ids,tags: row.tags,type: row.type,condition: row.condition,
      location_text_public: row.location_text_public,origin_region: row.origin_region,dest_region: row.dest_region,service_region: row.service_region,
      delivery_format: row.delivery_format,photos: row.photos,published_at: row.published_at,updated_at: row.updated_at,
    };
    await query(`insert into public_listings(unit_id,node_id,doc,published_at) values($1,$2,$3,now())
      on conflict (unit_id) do update set doc=excluded.doc,published_at=excluded.published_at,updated_at=now()`, [row.id,row.node_id,doc]);
    return;
  }
  const doc = {
    id: row.id,node_id: row.node_id,scope_primary: row.scope_primary,scope_secondary: row.scope_secondary,
    title: row.title,description: row.description,public_summary: row.public_summary,desired_quantity: row.desired_quantity,measure: row.measure,
    custom_measure: row.custom_measure,category_ids: row.category_ids,tags: row.tags,type: row.type,condition: row.condition,
    location_text_public: row.location_text_public,origin_region: row.origin_region,dest_region: row.dest_region,service_region: row.service_region,
    delivery_format: row.delivery_format,need_by: row.need_by,accept_substitutions: row.accept_substitutions,published_at: row.published_at,updated_at: row.updated_at,
  };
  await query(`insert into public_requests(request_id,node_id,doc,published_at) values($1,$2,$3,now())
    on conflict (request_id) do update set doc=excluded.doc,published_at=excluded.published_at,updated_at=now()`, [row.id,row.node_id,doc]);
}

export async function removeProjection(kind:'units'|'requests', id:string) {
  if (kind==='units') await query('delete from public_listings where unit_id=$1',[id]);
  else await query('delete from public_requests where request_id=$1',[id]);
}

export async function searchPublic(kind:'listings'|'requests', scope:string, limit:number, cursor:string|null) {
  const table = kind === 'listings' ? 'public_listings' : 'public_requests';
  if (cursor) return query<any>(`select * from ${table} where published_at < $2::timestamptz and (doc->>'scope_primary')=$3 order by published_at desc limit $1`, [limit,cursor,scope]);
  return query<any>(`select * from ${table} where (doc->>'scope_primary')=$2 order by published_at desc limit $1`, [limit,scope]);
}

export async function logSearch(nodeId:string, kind:'listings'|'requests', scope:string, q:string|null, filters:any, broadening:number, credits:number) {
  await query(`insert into search_logs(node_id,kind,scope,query_redacted,query_hash,filters_json,broadening_level,credits_charged)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [nodeId,kind,scope,q? q.replace(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[redacted_email]'):null,q?crypto.createHash('sha256').update(q).digest('hex'):null,filters,broadening,credits]);
}

export async function listNodePublic(nodeId:string, kind:'listings'|'requests', limit:number, cursor:string|null) {
  const table = kind === 'listings' ? 'public_listings' : 'public_requests';
  if (cursor) return query<any>(`select doc,published_at from ${table} where node_id=$1 and published_at < $3::timestamptz order by published_at desc limit $2`, [nodeId,limit,cursor]);
  return query<any>(`select doc,published_at from ${table} where node_id=$1 order by published_at desc limit $2`, [nodeId,limit]);
}

export async function getUnitsOwners(unitIds: string[]) {
  return query<{ id: string; node_id: string }>('select id,node_id from units where id = any($1::uuid[]) and deleted_at is null', [unitIds]);
}

export async function createOffer(fromNodeId: string, toNodeId: string, unitId: string, threadId: string, note: string | null) {
  const rows = await query<any>(`insert into offers(thread_id,from_node_id,to_node_id,unit_id,request_id,status,expires_at,note)
    values($1,$2,$3,$4,null,'pending',now()+interval '48 hours',$5) returning *`, [threadId, fromNodeId, toNodeId, unitId, note]);
  return rows[0];
}

export async function addOfferLine(offerId: string, unitId: string) {
  await query('insert into offer_lines(offer_id,unit_id) values($1,$2) on conflict do nothing', [offerId, unitId]);
}

export async function activeHeld(unitId: string) {
  const rows = await query<{ c: string }>("select count(*)::text as c from holds where unit_id=$1 and status='active' and expires_at>now()", [unitId]);
  return Number(rows[0].c) > 0;
}

export async function createHold(offerId: string, unitId: string) {
  await query("insert into holds(offer_id,unit_id,status,expires_at) values($1,$2,'active',now()+interval '48 hours')", [offerId, unitId]);
}

export async function getOffer(offerId: string) {
  const rows = await query<any>('select * from offers where id=$1 and deleted_at is null', [offerId]);
  return rows[0] ?? null;
}

export async function getOfferLines(offerId: string) {
  return query<{ unit_id: string }>('select unit_id from offer_lines where offer_id=$1', [offerId]);
}

export async function getHoldSummary(offerId: string) {
  const holds = await query<any>('select unit_id,status,expires_at from holds where offer_id=$1', [offerId]);
  const held = holds.filter((h) => h.status === 'active' || h.status === 'committed').map((h) => h.unit_id);
  const unheld: string[] = [];
  const first = holds[0];
  return { held_unit_ids: held, unheld_unit_ids: unheld, hold_status: first?.status ?? 'released', hold_expires_at: first?.expires_at ?? null };
}

export async function setOfferStatus(offerId: string, status: string, fields: Record<string, unknown> = {}) {
  const sets = ['status=$2'];
  const vals: unknown[] = [offerId, status];
  let idx = 3;
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k}=$${idx++}`); vals.push(v); }
  const rows = await query<any>(`update offers set ${sets.join(',')} where id=$1 and deleted_at is null returning *`, vals);
  return rows[0] ?? null;
}

export async function releaseHolds(offerId: string) {
  await query("update holds set status='released', released_at=now() where offer_id=$1 and status='active'", [offerId]);
}

export async function commitHolds(offerId: string) {
  await query("update holds set status='committed', committed_at=now() where offer_id=$1 and status='active'", [offerId]);
}

export async function listOffers(nodeId: string, role: 'made'|'received', limit: number, cursor: string | null) {
  const col = role === 'made' ? 'from_node_id' : 'to_node_id';
  if (cursor) return query<any>(`select * from offers where ${col}=$1 and created_at < $3::timestamptz and deleted_at is null order by created_at desc limit $2`, [nodeId, limit, cursor]);
  return query<any>(`select * from offers where ${col}=$1 and deleted_at is null order by created_at desc limit $2`, [nodeId, limit]);
}

export async function addContactReveal(offerId: string, requestingNodeId: string, revealedNodeId: string, email: string | null, phone: string | null) {
  await query('insert into contact_reveals(offer_id,requesting_node_id,revealed_node_id,revealed_email,revealed_phone) values($1,$2,$3,$4,$5)', [offerId, requestingNodeId, revealedNodeId, email, phone]);
}

export async function findReferralCode(code: string) {
  const rows = await query<{ issuer_node_id: string; active: boolean }>('select issuer_node_id, active from referral_codes where code=$1 limit 1', [code]);
  return rows[0] ?? null;
}

export async function ensureReferralCode(code: string, issuerNodeId: string) {
  await query('insert into referral_codes(code, issuer_node_id, active) values($1,$2,true) on conflict (code) do nothing', [code, issuerNodeId]);
}

export async function hasReferralClaim(nodeId: string) {
  const rows = await query<{ c: string }>('select count(*)::text as c from referral_claims where claimer_node_id=$1', [nodeId]);
  return Number(rows[0].c) > 0;
}

export async function hasPaidStripeEvent(nodeId: string) {
  const rows = await query<{ c: string }>(`select count(*)::text as c
    from stripe_events e
    where e.type='invoice.paid'
      and (
        coalesce(e.payload->'data'->'object'->'metadata'->>'node_id', e.payload->'data'->'object'->>'node_id', e.payload->>'node_id') = $1
        or exists (
          select 1 from subscriptions s
          where s.node_id::text = $1
            and s.stripe_customer_id is not null
            and s.stripe_customer_id = coalesce(e.payload->'data'->'object'->>'customer', e.payload->>'customer')
        )
      )`, [nodeId]);
  return Number(rows[0].c) > 0;
}

export async function createReferralClaim(code: string, claimerNodeId: string, issuerNodeId: string) {
  await query(`insert into referral_claims(code,claimer_node_id,issuer_node_id,status)
    values($1,$2,$3,'claimed')
    on conflict (claimer_node_id) do nothing`, [code, claimerNodeId, issuerNodeId]);
}

export async function stripeEventExists(id: string) {
  const rows = await query<{ id: string }>('select id from stripe_events where id=$1 limit 1', [id]);
  return !!rows[0];
}

export async function insertStripeEvent(id: string, type: string, payload: any) {
  await query('insert into stripe_events(id,type,payload) values($1,$2,$3) on conflict do nothing', [id, type, payload]);
}

export async function markStripeProcessed(id: string) {
  await query('update stripe_events set processed_at=now(), processing_error=null where id=$1', [id]);
}

export async function markStripeError(id: string, message: string) {
  await query('update stripe_events set processing_error=$2 where id=$1', [id, message]);
}

export async function upsertSubscription(nodeId: string, planCode: string, status: string, periodStart: string | null, periodEnd: string | null, stripeCustomerId: string | null, stripeSubId: string | null) {
  if (stripeSubId) {
    await query('update subscriptions set stripe_subscription_id = null where stripe_subscription_id = $1 and node_id <> $2', [stripeSubId, nodeId]);
  }
  await query(`insert into subscriptions(node_id,plan_code,status,current_period_start,current_period_end,stripe_customer_id,stripe_subscription_id)
    values($1,$2,$3,$4,$5,$6,$7)
    on conflict (node_id) do update set plan_code=excluded.plan_code,status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id`,
    [nodeId, planCode, status, periodStart, periodEnd, stripeCustomerId, stripeSubId]);
}

export async function findNodeIdByStripeCustomerId(stripeCustomerId: string) {
  const rows = await query<{ node_id: string }>('select node_id from subscriptions where stripe_customer_id=$1 limit 1', [stripeCustomerId]);
  return rows[0]?.node_id ?? null;
}

export async function findNodeIdByStripeSubscriptionId(stripeSubscriptionId: string) {
  const rows = await query<{ node_id: string }>('select node_id from subscriptions where stripe_subscription_id=$1 limit 1', [stripeSubscriptionId]);
  return rows[0]?.node_id ?? null;
}

export async function getSubscriptionMapping(nodeId: string) {
  const rows = await query<{ stripe_customer_id: string | null; stripe_subscription_id: string | null }>(
    'select stripe_customer_id, stripe_subscription_id from subscriptions where node_id=$1 limit 1',
    [nodeId],
  );
  return rows[0] ?? { stripe_customer_id: null, stripe_subscription_id: null };
}

export async function monthlyCreditGranted(nodeId: string, periodStart: string) {
  const rows = await query<{ c: string }>("select count(*)::text as c from credit_ledger where node_id=$1 and type='grant_subscription_monthly' and amount > 0 and (meta->>'period_start')=$2", [nodeId, periodStart]);
  return Number(rows[0].c) > 0;
}

export async function getReferralClaim(nodeId: string) {
  const rows = await query<any>("select * from referral_claims where claimer_node_id=$1 and status='claimed' order by claimed_at asc limit 1", [nodeId]);
  return rows[0] ?? null;
}

export async function markReferralAwarded(claimId: string) {
  await query("update referral_claims set status='awarded', awarded_at=now() where id=$1", [claimId]);
}

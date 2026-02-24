import crypto from 'node:crypto';
import { pool, query } from './client.js';

export type NodeContext = { nodeId: string };

export async function findApiKey(rawKey: string) {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const rows = await query<{ node_id: string; plan_code: string; status: string; is_suspended: boolean; is_revoked: boolean; has_active_trial: boolean }>(
    `select
       ak.node_id,
       coalesce(s.plan_code, 'free') as plan_code,
       coalesce(s.status, 'none') as status,
       (n.status <> 'ACTIVE' or n.suspended_at is not null) as is_suspended,
       (ak.revoked_at is not null) as is_revoked,
       exists (
         select 1
         from trial_entitlements te
         where te.node_id = ak.node_id
           and te.starts_at <= now()
           and te.ends_at > now()
       ) as has_active_trial
     from api_keys ak
     join nodes n on n.id = ak.node_id and n.deleted_at is null
     left join subscriptions s on s.node_id = ak.node_id
     where ak.key_hash=$1
     limit 1`,
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
  recoveryPublicKey: string | null,
  messagingHandles: Array<{ kind: string; handle: string; url: string | null }>,
  legal: { acceptedAt: string; version: string; ip: string | null; userAgent: string | null },
) {
  const rows = await query<{ id: string; created_at: string; legal_accepted_at: string; legal_version: string; email_verified_at: string | null }>(
    `insert into nodes(display_name,email,recovery_public_key,messaging_handles,status,legal_accepted_at,legal_version,legal_ip,legal_user_agent)
     values($1,$2,$3,$4::jsonb,'ACTIVE',$5,$6,$7,$8)
     returning id,created_at,legal_accepted_at,legal_version`,
    [displayName, email, recoveryPublicKey, JSON.stringify(messagingHandles ?? []), legal.acceptedAt, legal.version, legal.ip, legal.userAgent],
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

export async function addCreditIdempotent(nodeId: string, type: string, amount: number, meta: object = {}, idempotencyKey: string) {
  try {
    await query(
      'insert into credit_ledger(node_id,type,amount,meta,idempotency_key) values($1,$2,$3,$4,$5)',
      [nodeId, type, amount, meta, idempotencyKey],
    );
    return true;
  } catch (err: any) {
    if (err?.code === '23505') return false;
    throw err;
  }
}

export async function getMe(nodeId: string) {
  const rows = await query<any>(
    `select n.id,n.display_name,n.email,n.phone,n.status,n.created_at,
      n.suspended_at,n.legal_accepted_at,n.legal_version,n.legal_ip,n.legal_user_agent,n.email_verified_at,n.recovery_public_key,n.messaging_handles,n.event_webhook_url,
      coalesce(s.plan_code,'free') as plan_code, coalesce(s.status,'none') as sub_status,
      s.current_period_start,s.current_period_end
     from nodes n left join subscriptions s on s.node_id=n.id where n.id=$1 and n.deleted_at is null`,
    [nodeId],
  );
  return rows[0] ?? null;
}

export async function findActiveNodeById(nodeId: string) {
  const rows = await query<{ id: string }>(
    `select id
     from nodes
     where id=$1
       and status='ACTIVE'
       and suspended_at is null
       and deleted_at is null
     limit 1`,
    [nodeId],
  );
  return rows[0] ?? null;
}

export async function findActiveNodeByUsername(username: string) {
  const rows = await query<{ id: string }>(
    `select id
     from nodes
     where lower(display_name)=lower($1)
       and status='ACTIVE'
       and suspended_at is null
       and deleted_at is null
     limit 1`,
    [username],
  );
  return rows[0] ?? null;
}

export async function getNodeRecoveryProfile(nodeId: string) {
  const rows = await query<{
    id: string;
    email: string | null;
    email_verified_at: string | null;
    recovery_public_key: string | null;
    status: string;
  }>(
    `select id,email,email_verified_at,recovery_public_key,status
     from nodes
     where id=$1 and deleted_at is null
     limit 1`,
    [nodeId],
  );
  return rows[0] ?? null;
}

export async function hasActiveTrialEntitlement(nodeId: string) {
  const rows = await query<{ c: string }>(
    `select count(*)::text as c
     from trial_entitlements
     where node_id = $1
       and starts_at <= now()
       and ends_at > now()`,
    [nodeId],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

export async function getTrialEntitlement(nodeId: string) {
  const rows = await query<any>('select * from trial_entitlements where node_id=$1 limit 1', [nodeId]);
  return rows[0] ?? null;
}

export async function updateMe(
  nodeId: string,
  displayName: string | null | undefined,
  email: string | null | undefined,
  recoveryPublicKey: string | null | undefined = undefined,
  messagingHandles: Array<{ kind: string; handle: string; url: string | null }> | null | undefined = undefined,
  eventWebhookUrl: string | null | undefined = undefined,
  eventWebhookSecret: string | null | undefined = undefined,
) {
  const rows = await query<{ id: string }>(
    `update nodes
     set display_name = coalesce($2, display_name),
         email = coalesce($3, email),
         email_verified_at = case
           when $3 is not null and lower($3) <> lower(coalesce(email, '')) then null
           else email_verified_at
         end,
         recovery_public_key = coalesce($4, recovery_public_key)
     where id=$1 returning id`,
    [nodeId, displayName, email, recoveryPublicKey],
  );
  const updated = rows[0] ?? null;
  if (!updated) return null;

  if (messagingHandles !== undefined) {
    await query('update nodes set messaging_handles=$2::jsonb where id=$1', [nodeId, JSON.stringify(messagingHandles ?? [])]);
  }
  if (eventWebhookUrl !== undefined) {
    await query('update nodes set event_webhook_url=$2 where id=$1', [nodeId, eventWebhookUrl]);
  }
  if (eventWebhookSecret !== undefined) {
    await query('update nodes set event_webhook_secret=$2 where id=$1', [nodeId, eventWebhookSecret]);
  }
  return updated;
}

export async function setNodeEmailForVerification(nodeId: string, email: string) {
  const rows = await query<any>(
    `update nodes
     set email=$2,
         email_verified_at = case
           when lower($2) <> lower(coalesce(email, '')) then null
           else email_verified_at
         end
     where id=$1 and deleted_at is null
     returning id,email,email_verified_at`,
    [nodeId, email],
  );
  return rows[0] ?? null;
}

export async function createRecoveryChallenge(
  nodeId: string,
  type: 'pubkey' | 'email' | 'email_verify',
  nonceOrCodeHash: string,
  expiresAt: string,
  maxAttempts: number,
  meta: Record<string, unknown> = {},
) {
  const rows = await query<{ id: string; expires_at: string }>(
    `insert into recovery_challenges(node_id,type,nonce_or_code_hash,expires_at,max_attempts,meta)
     values($1,$2,$3,$4,$5,$6)
     returning id,expires_at`,
    [nodeId, type, nonceOrCodeHash, expiresAt, maxAttempts, meta],
  );
  return rows[0];
}

export async function getRecoveryChallenge(challengeId: string) {
  const rows = await query<any>(
    `select
       rc.id,
       rc.node_id,
       rc.type,
       rc.nonce_or_code_hash,
       rc.expires_at,
       rc.attempts,
       rc.max_attempts,
       rc.meta,
       rc.used_at,
       rc.created_at,
       n.email,
       n.email_verified_at,
       n.recovery_public_key
     from recovery_challenges rc
     join nodes n on n.id=rc.node_id and n.deleted_at is null
     where rc.id=$1
     limit 1`,
    [challengeId],
  );
  return rows[0] ?? null;
}

type CompleteEmailVerificationResult = {
  status: 'ok' | 'not_found' | 'invalid_code' | 'expired' | 'attempts_exceeded' | 'used';
};

export async function completeEmailVerificationChallenge(
  nodeId: string,
  email: string,
  codeHash: string,
): Promise<CompleteEmailVerificationResult> {
  const client = await (pool as any).connect();
  try {
    await client.query('begin');
    const challengeRows = await client.query(
      `select *
       from recovery_challenges
       where node_id=$1
         and type='email_verify'
         and lower(coalesce(meta->>'email','')) = lower($2)
       order by created_at desc
       limit 1
       for update`,
      [nodeId, email],
    );
    const challenge = challengeRows.rows[0];
    if (!challenge) {
      await client.query('rollback');
      return { status: 'not_found' };
    }
    if (challenge.used_at) {
      await client.query('rollback');
      return { status: 'used' };
    }
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await client.query('rollback');
      return { status: 'expired' };
    }
    if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
      await client.query('rollback');
      return { status: 'attempts_exceeded' };
    }
    if (challenge.nonce_or_code_hash !== codeHash) {
      await client.query('update recovery_challenges set attempts=attempts+1 where id=$1', [challenge.id]);
      await client.query('commit');
      return { status: 'invalid_code' };
    }

    await client.query('update recovery_challenges set used_at=now() where id=$1', [challenge.id]);
    await client.query(
      `update nodes
       set email=$2, email_verified_at=now()
       where id=$1`,
      [nodeId, email],
    );
    await client.query(
      `insert into recovery_events(node_id, challenge_id, event_type, meta)
       values($1,$2,'email_verification_completed',$3)`,
      [nodeId, challenge.id, { email }],
    );
    await client.query('commit');
    return { status: 'ok' };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

type CompleteRecoveryResult = {
  status: 'ok' | 'not_found' | 'type_mismatch' | 'invalid_secret' | 'expired' | 'attempts_exceeded' | 'used';
  api_key?: string;
  key_id?: string;
  node_id?: string;
};

export async function completeRecoveryChallenge(
  challengeId: string,
  expectedType: 'pubkey' | 'email',
  expectedSecret: string,
): Promise<CompleteRecoveryResult> {
  const client = await (pool as any).connect();
  try {
    await client.query('begin');
    const challengeRows = await client.query('select * from recovery_challenges where id=$1 limit 1 for update', [challengeId]);
    const challenge = challengeRows.rows[0];
    if (!challenge) {
      await client.query('rollback');
      return { status: 'not_found' };
    }
    if (challenge.type !== expectedType) {
      await client.query('rollback');
      return { status: 'type_mismatch' };
    }
    if (challenge.used_at) {
      await client.query('rollback');
      return { status: 'used' };
    }
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await client.query('rollback');
      return { status: 'expired' };
    }
    if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
      await client.query('rollback');
      return { status: 'attempts_exceeded' };
    }
    if (challenge.nonce_or_code_hash !== expectedSecret) {
      await client.query('update recovery_challenges set attempts=attempts+1 where id=$1', [challenge.id]);
      await client.query('commit');
      return { status: 'invalid_secret' };
    }

    const apiKey = crypto.randomUUID() + crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const keyPrefix = apiKey.slice(0, 8);

    await client.query('update recovery_challenges set used_at=now() where id=$1', [challenge.id]);
    await client.query('update api_keys set revoked_at=now() where node_id=$1 and revoked_at is null', [challenge.node_id]);
    const keyRows = await client.query(
      'insert into api_keys(node_id,label,key_prefix,key_hash) values($1,$2,$3,$4) returning id',
      [challenge.node_id, `recovery_${expectedType}`, keyPrefix, keyHash],
    );
    await client.query(
      `insert into recovery_events(node_id, challenge_id, event_type, meta)
       values($1,$2,'api_key_recovery_completed',$3)`,
      [challenge.node_id, challenge.id, { method: expectedType }],
    );
    await client.query('commit');
    return {
      status: 'ok',
      node_id: challenge.node_id,
      key_id: keyRows.rows[0].id,
      api_key: apiKey,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
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
    const rows = await query<any>(`insert into units(node_id,title,description,type,condition,quantity,estimated_value,measure,custom_measure,scope_primary,scope_secondary,scope_notes,location_text_public,origin_region,dest_region,service_region,delivery_format,max_ship_days,tags,category_ids,public_summary)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      returning id,node_id,case when published_at is null then 'draft' else 'published' end as publish_status,created_at,updated_at,row_version as version`,
      [nodeId,payload.title,payload.description,payload.type,payload.condition,payload.quantity,payload.estimated_value,payload.measure,payload.custom_measure,payload.scope_primary,payload.scope_secondary,payload.scope_notes,payload.location_text_public,payload.origin_region,payload.dest_region,payload.service_region,payload.delivery_format,payload.max_ship_days,payload.tags,payload.category_ids,payload.public_summary]);
    return rows[0];
  }
  const rows = await query<any>(`insert into requests(node_id,title,description,type,condition,desired_quantity,measure,custom_measure,scope_primary,scope_secondary,scope_notes,location_text_public,origin_region,dest_region,service_region,delivery_format,max_ship_days,need_by,accept_substitutions,expires_at,tags,category_ids,public_summary)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,coalesce($20::timestamptz, now() + interval '7 days'),$21,$22,$23)
      returning id,node_id,case when published_at is null then 'draft' else 'published' end as publish_status,created_at,updated_at,row_version as version,expires_at`,
      [nodeId,payload.title,payload.description,payload.type,payload.condition,payload.quantity,payload.measure,payload.custom_measure,payload.scope_primary,payload.scope_secondary,payload.scope_notes,payload.location_text_public,payload.origin_region,payload.dest_region,payload.service_region,payload.delivery_format,payload.max_ship_days,payload.need_by,payload.accept_substitutions ?? true,payload.expires_at,payload.tags,payload.category_ids,payload.public_summary]);
  return rows[0];
}

export async function createUnitWithUploadTrial(
  nodeId: string,
  payload: any,
  options: { threshold: number; trialDays: number },
) {
  const rows = await query<any>(`
    with inserted_unit as (
      insert into units(
        node_id,title,description,type,condition,quantity,estimated_value,measure,custom_measure,
        scope_primary,scope_secondary,scope_notes,location_text_public,origin_region,
        dest_region,service_region,delivery_format,max_ship_days,tags,category_ids,public_summary
      )
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      returning
        id,
        node_id,
        case when published_at is null then 'draft' else 'published' end as publish_status,
        created_at,
        updated_at,
        row_version as version
    ),
    upload_count as (
      select (count(*)::int + 1) as c
      from units
      where node_id = $1
    ),
    insert_trial as (
      insert into trial_entitlements(node_id, source, threshold_count, upload_count_at_grant, starts_at, ends_at)
      select
        $1,
        'unit_upload_count',
        $22,
        upload_count.c,
        now(),
        now() + make_interval(days => $23::int)
      from upload_count
      where upload_count.c >= $22
      on conflict (node_id) do nothing
      returning node_id, starts_at, ends_at, upload_count_at_grant
    ),
    insert_milestone_credits as (
      insert into credit_ledger(node_id, type, amount, meta, idempotency_key)
      select
        $1,
        'grant_trial',
        100,
        jsonb_build_object(
          'reason', 'unit_milestone_grant',
          'threshold', milestones.threshold,
          'unit_count', upload_count.c
        ),
        ('unit_milestone_threshold:' || milestones.threshold::text)
      from upload_count
      join (values (10), (20)) as milestones(threshold) on upload_count.c >= milestones.threshold
      on conflict (node_id, idempotency_key) where idempotency_key is not null do nothing
      returning amount
    ),
    insert_trial_event as (
      insert into trial_entitlement_events(node_id, event_type, meta)
      select
        $1,
        'granted',
        jsonb_build_object(
          'source', 'unit_upload_count',
          'threshold', $22,
          'upload_count', insert_trial.upload_count_at_grant,
          'trial_starts_at', insert_trial.starts_at,
          'trial_ends_at', insert_trial.ends_at,
          'credits_granted', coalesce((select sum(amount)::int from insert_milestone_credits), 0)
        )
      from insert_trial
      returning id
    )
    select
      iu.id,
      iu.node_id,
      iu.publish_status,
      iu.created_at,
      iu.updated_at,
      iu.version,
      (select c from upload_count) as upload_count,
      exists(select 1 from insert_trial) as trial_granted,
      (select ends_at from insert_trial limit 1) as trial_ends_at
    from inserted_unit iu
  `, [
    nodeId,
    payload.title,
    payload.description,
    payload.type,
    payload.condition,
    payload.quantity,
    payload.estimated_value,
    payload.measure,
    payload.custom_measure,
    payload.scope_primary,
    payload.scope_secondary,
    payload.scope_notes,
    payload.location_text_public,
    payload.origin_region,
    payload.dest_region,
    payload.service_region,
    payload.delivery_format,
    payload.max_ship_days,
    payload.tags,
    payload.category_ids,
    payload.public_summary,
    options.threshold,
    options.trialDays,
  ]);
  return rows[0];
}

export async function grantRequestMilestoneIfEligible(
  nodeId: string,
  _options: { threshold: number; creditGrant: number },
) {
  const counts = await query<{ c: string }>(
    'select count(*)::text as c from requests where node_id=$1',
    [nodeId],
  );
  const requestCount = Number(counts[0]?.c ?? 0);
  const milestones = [10, 20];
  let granted = false;
  for (const threshold of milestones) {
    if (requestCount < threshold) continue;
    const didGrant = await addCreditIdempotent(
      nodeId,
      'grant_milestone_requests',
      100,
      {
        reason: 'request_milestone_grant',
        threshold,
        request_count: requestCount,
      },
      `request_milestone_threshold:${threshold}`,
    );
    granted = granted || didGrant;
  }
  return { granted, request_count: requestCount };
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
  if (kind === 'units') {
    const rows = await query<any>(`update units set
        title=coalesce($4,title),description=coalesce($5,description),type=coalesce($6,type),condition=coalesce($7,condition),
        quantity=coalesce($8,quantity),estimated_value=coalesce($9,estimated_value),measure=coalesce($10,measure),custom_measure=coalesce($11,custom_measure),
        scope_primary=coalesce($12,scope_primary),scope_secondary=coalesce($13,scope_secondary),scope_notes=coalesce($14,scope_notes),
        location_text_public=coalesce($15,location_text_public),origin_region=coalesce($16,origin_region),dest_region=coalesce($17,dest_region),
        service_region=coalesce($18,service_region),delivery_format=coalesce($19,delivery_format),max_ship_days=coalesce($20,max_ship_days),tags=coalesce($21,tags),category_ids=coalesce($22,category_ids),public_summary=coalesce($23,public_summary)
        where id=$1 and node_id=$2 and row_version=$3 and deleted_at is null
        returning id,row_version as version`,
      [id,nodeId,version,payload.title,payload.description,payload.type,payload.condition,payload.quantity,payload.estimated_value,payload.measure,payload.custom_measure,payload.scope_primary,payload.scope_secondary,payload.scope_notes,payload.location_text_public,payload.origin_region,payload.dest_region,payload.service_region,payload.delivery_format,payload.max_ship_days,payload.tags,payload.category_ids,payload.public_summary]);
    return rows[0] ?? null;
  }
  const rows = await query<any>(`update requests set
      title=coalesce($4,title),description=coalesce($5,description),type=coalesce($6,type),condition=coalesce($7,condition),
      desired_quantity=coalesce($8,desired_quantity),measure=coalesce($9,measure),custom_measure=coalesce($10,custom_measure),
      scope_primary=coalesce($11,scope_primary),scope_secondary=coalesce($12,scope_secondary),scope_notes=coalesce($13,scope_notes),
      location_text_public=coalesce($14,location_text_public),origin_region=coalesce($15,origin_region),dest_region=coalesce($16,dest_region),
      service_region=coalesce($17,service_region),delivery_format=coalesce($18,delivery_format),max_ship_days=coalesce($19,max_ship_days),tags=coalesce($20,tags),category_ids=coalesce($21,category_ids),public_summary=coalesce($22,public_summary),expires_at=coalesce($23,expires_at)
      where id=$1 and node_id=$2 and row_version=$3 and deleted_at is null
      returning id,row_version as version,expires_at`,
    [id,nodeId,version,payload.title,payload.description,payload.type,payload.condition,payload.quantity,payload.measure,payload.custom_measure,payload.scope_primary,payload.scope_secondary,payload.scope_notes,payload.location_text_public,payload.origin_region,payload.dest_region,payload.service_region,payload.delivery_format,payload.max_ship_days,payload.tags,payload.category_ids,payload.public_summary,payload.expires_at]);
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
    const estimatedValueRaw = row.estimated_value;
    const estimatedValue = estimatedValueRaw === null || estimatedValueRaw === undefined
      ? null
      : Number(estimatedValueRaw);
    const doc = {
      id: row.id,node_id: row.node_id,scope_primary: row.scope_primary,scope_secondary: row.scope_secondary,
      title: row.title,description: row.description,public_summary: row.public_summary,quantity: row.quantity,estimated_value: Number.isFinite(estimatedValue) ? estimatedValue : null,measure: row.measure,
      custom_measure: row.custom_measure,category_ids: row.category_ids,tags: row.tags,type: row.type,condition: row.condition,
      location_text_public: row.location_text_public,origin_region: row.origin_region,dest_region: row.dest_region,service_region: row.service_region,
      delivery_format: row.delivery_format,max_ship_days: row.max_ship_days,photos: row.photos,published_at: row.published_at,updated_at: row.updated_at,
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
    delivery_format: row.delivery_format,max_ship_days: row.max_ship_days,need_by: row.need_by,accept_substitutions: row.accept_substitutions,expires_at: row.expires_at,published_at: row.published_at,updated_at: row.updated_at,
  };
  await query(`insert into public_requests(request_id,node_id,doc,published_at) values($1,$2,$3,now())
    on conflict (request_id) do update set doc=excluded.doc,published_at=excluded.published_at,updated_at=now()`, [row.id,row.node_id,doc]);
}

export async function removeProjection(kind:'units'|'requests', id:string) {
  if (kind==='units') await query('delete from public_listings where unit_id=$1',[id]);
  else await query('delete from public_requests where request_id=$1',[id]);
}

export type SearchAfterTuple = {
  route_specificity_score: number;
  fts_rank: number;
  updated_at: string;
  id: string;
};

type RegionFilter = {
  countryCode: string;
  admin1: string | null;
};

function parseRegionFilters(raw: unknown): RegionFilter[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (typeof value !== 'string') return [];
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(normalized)) return [];
    const [countryCode, admin1] = normalized.split('-', 2);
    return [{ countryCode, admin1: admin1 ?? null }];
  });
}

function buildRegionMatchExpressions(regionCountryExpr: string, regionAdminExpr: string, filters: RegionFilter[], params: unknown[], nextIdx: { value: number }) {
  const countryOnly: string[] = [];
  const specific: string[] = [];

  for (const filter of filters) {
    const countryIdx = nextIdx.value;
    params.push(filter.countryCode);
    nextIdx.value += 1;

    if (filter.admin1) {
      const adminIdx = nextIdx.value;
      params.push(filter.admin1);
      nextIdx.value += 1;
      specific.push(`(${regionCountryExpr}=$${countryIdx} and ${regionAdminExpr}=$${adminIdx})`);
      continue;
    }

    countryOnly.push(`(${regionCountryExpr}=$${countryIdx})`);
  }

  const specificExpr = specific.length > 0 ? `(${specific.join(' or ')})` : 'false';
  const countryOnlyExpr = countryOnly.length > 0 ? `(${countryOnly.join(' or ')})` : 'false';
  const anyExpr = `(${regionCountryExpr} is not null and (${specificExpr} or ${countryOnlyExpr}))`;
  const scoreExpr = `(case when ${specificExpr} then 2 when ${countryOnlyExpr} then 1 else 0 end)`;

  return { anyExpr, scoreExpr };
}

export async function searchPublic(
  kind: 'listings' | 'requests',
  scope: string,
  q: string | null,
  filters: any,
  limit: number,
  cursor: SearchAfterTuple | null,
  callerNodeId: string | null = null,
  targetNodeId: string | null = null,
  categoryIdsAny: number[] = [],
) {
  const table = kind === 'listings' ? 'public_listings' : 'public_requests';
  const idColumn = kind === 'listings' ? 'p.unit_id' : 'p.request_id';
  const lifecycleJoin = kind === 'requests'
    ? "join requests rq on rq.id = p.request_id and rq.deleted_at is null and rq.expires_at > now()"
    : '';
  const params: unknown[] = [limit];
  const where: string[] = [];

  const nextIdx = { value: 2 };
  where.push(`(p.doc->>'scope_primary')=$${nextIdx.value}`);
  params.push(scope);
  nextIdx.value += 1;

  const trimmedQ = typeof q === 'string' ? q.trim() : '';
  let ftsRankExpr = '0::double precision';
  if (trimmedQ.length > 0) {
    const qIdx = nextIdx.value;
    params.push(trimmedQ);
    nextIdx.value += 1;
    ftsRankExpr = `ts_rank_cd(coalesce(p.search_tsv, ''::tsvector), websearch_to_tsquery('english', $${qIdx}))`;
    where.push(`coalesce(p.search_tsv, ''::tsvector) @@ websearch_to_tsquery('english', $${qIdx})`);
  }

  const filterPayload = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {};
  const regions = parseRegionFilters((filterPayload as any).regions);
  const shipToRegions = parseRegionFilters((filterPayload as any).ship_to_regions);
  const shipsFromRegions = parseRegionFilters((filterPayload as any).ships_from_regions);
  const maxShipDaysRaw = (filterPayload as any).max_ship_days;
  const maxShipDays = Number.isInteger(maxShipDaysRaw) ? Number(maxShipDaysRaw) : null;
  let routeSpecificityExpr = '0::int';

  if (scope === 'local_in_person' && regions.length > 0) {
    const serviceMatch = buildRegionMatchExpressions(
      "(p.doc->'service_region'->>'country_code')",
      "(p.doc->'service_region'->>'admin1')",
      regions,
      params,
      nextIdx,
    );
    where.push(serviceMatch.anyExpr);
  }

  if (scope === 'remote_online_service' && regions.length > 0) {
    const serviceMatch = buildRegionMatchExpressions(
      "(p.doc->'service_region'->>'country_code')",
      "(p.doc->'service_region'->>'admin1')",
      regions,
      params,
      nextIdx,
    );
    where.push(serviceMatch.anyExpr);
  }

  if (scope === 'ship_to') {
    const destMatch = buildRegionMatchExpressions(
      "(p.doc->'dest_region'->>'country_code')",
      "(p.doc->'dest_region'->>'admin1')",
      shipToRegions,
      params,
      nextIdx,
    );
    where.push(destMatch.anyExpr);

    if (shipsFromRegions.length > 0) {
      const originMatch = buildRegionMatchExpressions(
        "(p.doc->'origin_region'->>'country_code')",
        "(p.doc->'origin_region'->>'admin1')",
        shipsFromRegions,
        params,
        nextIdx,
      );
      where.push(originMatch.anyExpr);
      routeSpecificityExpr = `(${destMatch.scoreExpr} + ${originMatch.scoreExpr})::int`;
    } else {
      routeSpecificityExpr = `${destMatch.scoreExpr}::int`;
    }

    if (maxShipDays !== null) {
      where.push(`(p.doc->>'max_ship_days') is not null and (p.doc->>'max_ship_days')::int <= $${nextIdx.value}`);
      params.push(maxShipDays);
      nextIdx.value += 1;
    }
  }

  if (callerNodeId) {
    where.push(`p.node_id <> $${nextIdx.value}`);
    params.push(callerNodeId);
    nextIdx.value += 1;
  }
  if (targetNodeId) {
    where.push(`p.node_id = $${nextIdx.value}`);
    params.push(targetNodeId);
    nextIdx.value += 1;
  }
  if (categoryIdsAny.length > 0) {
    const categoryKeys = categoryIdsAny.map((value) => String(value));
    where.push(`exists (
      select 1
      from jsonb_array_elements_text(coalesce(p.doc->'category_ids', '[]'::jsonb)) as c(category_id)
      where c.category_id = any($${nextIdx.value}::text[])
    )`);
    params.push(categoryKeys);
    nextIdx.value += 1;
  }

  where.push("n.status='ACTIVE'");
  where.push('n.suspended_at is null');
  where.push('n.deleted_at is null');

  const cursorWhere: string[] = [];
  if (cursor) {
    if (scope === 'ship_to') {
      const routeIdx = nextIdx.value;
      params.push(cursor.route_specificity_score);
      nextIdx.value += 1;
      const ftsIdx = nextIdx.value;
      params.push(cursor.fts_rank);
      nextIdx.value += 1;
      const updatedAtIdx = nextIdx.value;
      params.push(cursor.updated_at);
      nextIdx.value += 1;
      const idIdx = nextIdx.value;
      params.push(cursor.id);
      nextIdx.value += 1;

      cursorWhere.push(`(
        ranked.route_specificity_score < $${routeIdx}
        or (ranked.route_specificity_score = $${routeIdx} and ranked.fts_rank < $${ftsIdx})
        or (ranked.route_specificity_score = $${routeIdx} and ranked.fts_rank = $${ftsIdx} and ranked.updated_at < $${updatedAtIdx}::timestamptz)
        or (ranked.route_specificity_score = $${routeIdx} and ranked.fts_rank = $${ftsIdx} and ranked.updated_at = $${updatedAtIdx}::timestamptz and ranked.entity_id < $${idIdx}::uuid)
      )`);
    } else {
      const ftsIdx = nextIdx.value;
      params.push(cursor.fts_rank);
      nextIdx.value += 1;
      const updatedAtIdx = nextIdx.value;
      params.push(cursor.updated_at);
      nextIdx.value += 1;
      const idIdx = nextIdx.value;
      params.push(cursor.id);
      nextIdx.value += 1;

      cursorWhere.push(`(
        ranked.fts_rank < $${ftsIdx}
        or (ranked.fts_rank = $${ftsIdx} and ranked.updated_at < $${updatedAtIdx}::timestamptz)
        or (ranked.fts_rank = $${ftsIdx} and ranked.updated_at = $${updatedAtIdx}::timestamptz and ranked.entity_id < $${idIdx}::uuid)
      )`);
    }
  }

  const orderBy = scope === 'ship_to'
    ? 'ranked.route_specificity_score desc, ranked.fts_rank desc, ranked.updated_at desc, ranked.entity_id desc'
    : 'ranked.fts_rank desc, ranked.updated_at desc, ranked.entity_id desc';

  return query<any>(
    `with ranked as (
       select
         p.doc,
         p.node_id,
         p.published_at,
         p.updated_at,
         ${idColumn} as entity_id,
         ${ftsRankExpr}::double precision as fts_rank,
         ${routeSpecificityExpr}::int as route_specificity_score
       from ${table} p
       ${lifecycleJoin}
       join nodes n on n.id=p.node_id
       where ${where.join('\n         and ')}
     )
     select
       ranked.doc,
       ranked.node_id,
       ranked.published_at,
       ranked.updated_at,
       ranked.entity_id,
       ranked.fts_rank,
       ranked.route_specificity_score,
       extract(epoch from ranked.updated_at)::double precision as recency_score
     from ranked
     ${cursorWhere.length > 0 ? `where ${cursorWhere.join('\n       and ')}` : ''}
     order by ${orderBy}
     limit $1`,
    params,
  );
}

export async function logSearch(nodeId:string, kind:'listings'|'requests', scope:string, q:string|null, filters:any, broadening:number, credits:number) {
  await query(`insert into search_logs(node_id,kind,scope,query_redacted,query_hash,filters_json,broadening_level,credits_charged)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [nodeId,kind,scope,q? q.replace(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[redacted_email]'):null,q?crypto.createHash('sha256').update(q).digest('hex'):null,filters,broadening,credits]);
}

export async function addSearchImpressions(events: Array<{
  search_id: string;
  viewer_node_id: string;
  subject_kind: 'listing' | 'request';
  item_id: string;
  position: number;
  scope: string;
}>) {
  if (events.length === 0) return;
  await query(
    `insert into visibility_events(event_type,viewer_node_id,subject_kind,item_id,search_id,position,scope)
     select
       'search_impression',
       ev.viewer_node_id::uuid,
       ev.subject_kind::text,
       ev.item_id::uuid,
       ev.search_id::uuid,
       ev.position::int,
       ev.scope::text
     from jsonb_to_recordset($1::jsonb)
       as ev(viewer_node_id text, subject_kind text, item_id text, search_id text, position int, scope text)`,
    [JSON.stringify(events)],
  );
}

export async function addDetailView(viewerNodeId: string, subjectKind: 'listing' | 'request', itemId: string, scope: string | null) {
  await query(
    `insert into visibility_events(event_type,viewer_node_id,subject_kind,item_id,search_id,position,scope)
     values('detail_view',$1,$2,$3,null,null,$4)`,
    [viewerNodeId, subjectKind, itemId, scope],
  );
}

export async function listNodePublic(nodeId:string, kind:'listings'|'requests', limit:number, cursor:string|null) {
  const table = kind === 'listings' ? 'public_listings' : 'public_requests';
  const lifecycleJoin = kind === 'requests'
    ? 'join requests rq on rq.id=p.request_id and rq.deleted_at is null and rq.expires_at > now()'
    : '';
  if (cursor) {
    return query<any>(
      `select p.doc,p.published_at
       from ${table} p
       ${lifecycleJoin}
       join nodes n on n.id=p.node_id
       where p.node_id=$1
         and p.published_at < $3::timestamptz
         and n.status='ACTIVE'
         and n.suspended_at is null
         and n.deleted_at is null
       order by p.published_at desc
       limit $2`,
      [nodeId, limit, cursor],
    );
  }
  return query<any>(
    `select p.doc,p.published_at
     from ${table} p
     ${lifecycleJoin}
     join nodes n on n.id=p.node_id
     where p.node_id=$1
       and n.status='ACTIVE'
       and n.suspended_at is null
       and n.deleted_at is null
     order by p.published_at desc
     limit $2`,
    [nodeId, limit],
  );
}

export async function listNodePublicByCategory(nodeId: string, kind: 'listings' | 'requests', categoryId: number, limit: number, cursor: string | null) {
  const table = kind === 'listings' ? 'public_listings' : 'public_requests';
  const lifecycleJoin = kind === 'requests'
    ? 'join requests rq on rq.id=p.request_id and rq.deleted_at is null and rq.expires_at > now()'
    : '';
  const categoryKey = String(categoryId);
  if (cursor) {
    return query<any>(
      `select p.doc,p.published_at
       from ${table} p
       ${lifecycleJoin}
       join nodes n on n.id=p.node_id
       where p.node_id=$1
         and exists (
           select 1
           from jsonb_array_elements_text(coalesce(p.doc->'category_ids', '[]'::jsonb)) as c(category_id)
           where c.category_id = $2
         )
         and p.published_at < $4::timestamptz
         and n.status='ACTIVE'
         and n.suspended_at is null
         and n.deleted_at is null
       order by p.published_at desc
       limit $3`,
      [nodeId, categoryKey, limit, cursor],
    );
  }
  return query<any>(
    `select p.doc,p.published_at
     from ${table} p
     ${lifecycleJoin}
     join nodes n on n.id=p.node_id
     where p.node_id=$1
       and exists (
         select 1
         from jsonb_array_elements_text(coalesce(p.doc->'category_ids', '[]'::jsonb)) as c(category_id)
         where c.category_id = $2
       )
       and n.status='ACTIVE'
       and n.suspended_at is null
       and n.deleted_at is null
     order by p.published_at desc
     limit $3`,
    [nodeId, categoryKey, limit],
  );
}

export async function listNodeCategorySummary(nodeIds: string[], kind: 'listings' | 'requests' | 'both') {
  if (nodeIds.length === 0) return [] as Array<{ node_id: string; kind: string; category_id: number; count: number }>;
  const tables: Array<{ table: string; kind: 'listings' | 'requests' }> = [];
  if (kind === 'listings' || kind === 'both') tables.push({ table: 'public_listings', kind: 'listings' });
  if (kind === 'requests' || kind === 'both') tables.push({ table: 'public_requests', kind: 'requests' });

  const results: Array<{ node_id: string; kind: string; category_id: number; count: number }> = [];
  for (const { table, kind: k } of tables) {
    const lifecycleJoin = k === 'requests'
      ? 'join requests rq on rq.id = p.request_id and rq.deleted_at is null and rq.expires_at > now()'
      : '';
    const rows = await query<{ node_id: string; category_id: string; count: string }>(
      `select p.node_id, c.category_id, count(*)::text as count
       from ${table} p
       ${lifecycleJoin}
       join nodes n on n.id = p.node_id
       cross join lateral jsonb_array_elements_text(coalesce(p.doc->'category_ids', '[]'::jsonb)) as c(category_id)
       where p.node_id = any($1::uuid[])
         and n.status = 'ACTIVE'
         and n.suspended_at is null
         and n.deleted_at is null
       group by p.node_id, c.category_id`,
      [nodeIds],
    );
    for (const row of rows) {
      results.push({ node_id: row.node_id, kind: k, category_id: Number(row.category_id), count: Number(row.count) });
    }
  }
  return results;
}

export async function getUnitsOwners(unitIds: string[]) {
  return query<{ id: string; node_id: string }>('select id,node_id from units where id = any($1::uuid[]) and deleted_at is null', [unitIds]);
}

export async function createOffer(
  fromNodeId: string,
  toNodeId: string,
  unitId: string,
  threadId: string,
  note: string | null,
  expiresAt: string,
) {
  const rows = await query<any>(`insert into offers(thread_id,from_node_id,to_node_id,unit_id,request_id,status,expires_at,note)
    values($1,$2,$3,$4,null,'pending',$5::timestamptz,$6) returning *`, [threadId, fromNodeId, toNodeId, unitId, expiresAt, note]);
  return rows[0];
}

export async function addOfferLine(offerId: string, unitId: string) {
  await query('insert into offer_lines(offer_id,unit_id) values($1,$2) on conflict do nothing', [offerId, unitId]);
}

export async function activeHeld(unitId: string) {
  const rows = await query<{ c: string }>("select count(*)::text as c from holds where unit_id=$1 and status='active' and expires_at>now()", [unitId]);
  return Number(rows[0].c) > 0;
}

export async function createHold(offerId: string, unitId: string, expiresAt: string) {
  await query("insert into holds(offer_id,unit_id,status,expires_at) values($1,$2,'active',$3::timestamptz)", [offerId, unitId, expiresAt]);
}

export async function getOffer(offerId: string) {
  const rows = await query<any>('select * from offers where id=$1 and deleted_at is null', [offerId]);
  return rows[0] ?? null;
}

export async function expireStaleOffers() {
  const rows = await query<{ id: string }>(
    `with expired as (
       update offers
       set status='expired',
           expired_at=coalesce(expired_at, now())
       where status in ('pending','accepted_by_a','accepted_by_b')
         and expires_at <= now()
         and deleted_at is null
       returning id
     ),
     expired_holds as (
       update holds
       set status='expired',
           expired_at=coalesce(expired_at, now())
       where offer_id in (select id from expired)
         and status='active'
       returning id
     )
     select id from expired`,
  );
  return rows.length;
}

export async function expireStaleRequests() {
  const rows = await query<{ id: string }>(
    `with expired as (
       update requests
       set published_at = null
       where deleted_at is null
         and expires_at <= now()
       returning id
     ),
     removed as (
       delete from public_requests
       where request_id in (select id from expired)
       returning request_id
     )
     select id from expired`,
  );
  return rows.length;
}

export async function getOfferLines(offerId: string) {
  return query<{ unit_id: string }>('select unit_id from offer_lines where offer_id=$1', [offerId]);
}

export async function getHoldSummary(offerId: string) {
  const holds = await query<any>('select unit_id,status,expires_at from holds where offer_id=$1', [offerId]);
  const lines = await query<{ unit_id: string }>('select unit_id from offer_lines where offer_id=$1', [offerId]);
  const held = holds.filter((h) => h.status === 'active' || h.status === 'committed').map((h) => h.unit_id);
  const heldSet = new Set(held);
  const unheld = lines.map((line) => line.unit_id).filter((unitId) => !heldSet.has(unitId));
  const firstActiveOrCommitted = holds.find((h) => h.status === 'active' || h.status === 'committed');
  const first = firstActiveOrCommitted ?? holds[0];
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

export async function finalizeOfferMutualAcceptanceWithFees(
  offerId: string,
  acceptedBy: 'from' | 'to',
  feeCredits: number,
) {
  const fee = Math.max(0, Math.trunc(feeCredits));
  const acceptedField = acceptedBy === 'from' ? 'accepted_by_from_at' : 'accepted_by_to_at';
  const counterpartField = acceptedBy === 'from' ? 'accepted_by_to_at' : 'accepted_by_from_at';
  const rows = await query<{
    missing_offer: boolean;
    conflict: boolean;
    from_balance: string;
    to_balance: string;
    offer: any | null;
  }>(
    `with locked_offer as (
       select *
       from offers
       where id=$1
         and deleted_at is null
       limit 1
       for update
     ),
     checks as (
       select
         (count(*) = 0) as missing_offer,
         coalesce(bool_or((${counterpartField} is null) or status not in ('pending', 'accepted_by_a', 'accepted_by_b')), false) as conflict
       from locked_offer
     ),
     balances as (
       select
         lo.from_node_id,
         lo.to_node_id,
         coalesce((select sum(amount) from credit_ledger where node_id=lo.from_node_id), 0)::int as from_balance,
         coalesce((select sum(amount) from credit_ledger where node_id=lo.to_node_id), 0)::int as to_balance
       from locked_offer lo
     ),
     can_finalize as (
       select
         not checks.missing_offer
         and not checks.conflict
         and balances.from_balance >= $2
         and balances.to_balance >= $2 as ok
       from checks
       left join balances on true
     ),
     updated_offer as (
       update offers o
       set status='mutually_accepted',
           mutually_accepted_at=coalesce(mutually_accepted_at, now()),
           ${acceptedField}=coalesce(${acceptedField}, now())
       where o.id in (select id from locked_offer)
         and exists(select 1 from can_finalize where ok)
       returning *
     ),
     commit_holds as (
       update holds
       set status='committed',
           committed_at=now()
       where offer_id in (select id from updated_offer)
         and status='active'
       returning id
     ),
     involved_units as (
       select distinct ol.unit_id
       from offer_lines ol
       where ol.offer_id in (select id from updated_offer)
     ),
     unpublish_units as (
       update units
       set published_at = null
       where id in (select unit_id from involved_units)
       returning id
     ),
     remove_listings as (
       delete from public_listings
       where unit_id in (select unit_id from involved_units)
       returning unit_id
     ),
     charge_from as (
       insert into credit_ledger(node_id, type, amount, meta, idempotency_key)
       select
         balances.from_node_id,
         'deal_accept_fee',
         -$2,
         jsonb_build_object('offer_id', $1::text, 'side', 'from'),
         ('deal_accept_fee:' || $1::text || ':' || balances.from_node_id::text)
       from balances
       where $2 > 0
         and exists(select 1 from updated_offer)
       on conflict (node_id, idempotency_key) where idempotency_key is not null do nothing
       returning id
     ),
     charge_to as (
       insert into credit_ledger(node_id, type, amount, meta, idempotency_key)
       select
         balances.to_node_id,
         'deal_accept_fee',
         -$2,
         jsonb_build_object('offer_id', $1::text, 'side', 'to'),
         ('deal_accept_fee:' || $1::text || ':' || balances.to_node_id::text)
       from balances
       where $2 > 0
         and exists(select 1 from updated_offer)
       on conflict (node_id, idempotency_key) where idempotency_key is not null do nothing
       returning id
     )
     select
       checks.missing_offer,
       checks.conflict,
       coalesce(balances.from_balance, 0)::text as from_balance,
       coalesce(balances.to_balance, 0)::text as to_balance,
       (select row_to_json(updated_offer) from updated_offer limit 1) as offer
     from checks
     left join balances on true`,
    [offerId, fee],
  );
  const row = rows[0] ?? null;
  if (!row || row.missing_offer) return { notFound: true as const };
  if (row.conflict) return { conflict: true as const };
  if (!row.offer) {
    const fromBalance = Number(row.from_balance ?? 0);
    const toBalance = Number(row.to_balance ?? 0);
    if (fromBalance < fee) return { creditsExhausted: { credits_required: fee, credits_balance: fromBalance } };
    if (toBalance < fee) return { creditsExhausted: { credits_required: fee, credits_balance: toBalance } };
    return { conflict: true as const };
  }
  return { offer: row.offer };
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

export async function addContactReveal(
  offerId: string,
  requestingNodeId: string,
  revealedNodeId: string,
  email: string | null,
  phone: string | null,
  messagingHandles: Array<{ kind: string; handle: string; url: string | null }>,
) {
  await query(
    'insert into contact_reveals(offer_id,requesting_node_id,revealed_node_id,revealed_email,revealed_phone,revealed_messaging_handles) values($1,$2,$3,$4,$5,$6::jsonb)',
    [offerId, requestingNodeId, revealedNodeId, email, phone, JSON.stringify(messagingHandles ?? [])],
  );
}

export type OfferEventCursor = { created_at: string; id: string };

export async function addOfferLifecycleEvents(
  offerId: string,
  eventType: 'offer_created' | 'offer_countered' | 'offer_accepted' | 'offer_cancelled' | 'offer_contact_revealed',
  actorNodeId: string,
  recipientNodeIds: string[],
  payload: Record<string, unknown> = {},
) {
  const recipients = [...new Set(recipientNodeIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (recipients.length === 0) return [] as any[];
  return query<any>(
    `insert into offer_events(offer_id,event_type,actor_node_id,recipient_node_id,payload)
     select
       $1::uuid,
       $2::text,
       $3::uuid,
       recipients.node_id::uuid,
       $4::jsonb
     from unnest($5::uuid[]) as recipients(node_id)
     returning id,offer_id,event_type,actor_node_id,recipient_node_id,payload,created_at`,
    [offerId, eventType, actorNodeId, JSON.stringify(payload ?? {}), recipients],
  );
}

export async function listOfferLifecycleEvents(nodeId: string, limit: number, cursor: OfferEventCursor | null) {
  if (cursor) {
    return query<any>(
      `select
         id,
         offer_id,
         event_type,
         actor_node_id,
         recipient_node_id,
         payload,
         to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
       from offer_events
       where recipient_node_id=$1
         and (created_at, id) > ($2::timestamptz, $3::uuid)
       order by created_at asc, id asc
       limit $4`,
      [nodeId, cursor.created_at, cursor.id, limit],
    );
  }
  return query<any>(
    `select
       id,
       offer_id,
       event_type,
       actor_node_id,
       recipient_node_id,
       payload,
       to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
     from offer_events
     where recipient_node_id=$1
     order by created_at asc, id asc
     limit $2`,
    [nodeId, limit],
  );
}

export async function getNodeEventWebhookConfig(nodeId: string) {
  const rows = await query<{ event_webhook_url: string | null; event_webhook_secret: string | null }>(
    `select event_webhook_url, event_webhook_secret
     from nodes
     where id=$1
       and deleted_at is null
     limit 1`,
    [nodeId],
  );
  return {
    event_webhook_url: rows[0]?.event_webhook_url ?? null,
    event_webhook_secret: rows[0]?.event_webhook_secret ?? null,
  };
}

export async function addEventWebhookDelivery(
  eventId: string,
  nodeId: string,
  webhookUrl: string,
  attemptNumber: number,
  nextRetryAt: string | null,
  deliveredAt: string | null,
  statusCode: number | null,
  ok: boolean,
  error: string | null,
) {
  await query(
    `insert into event_webhook_deliveries(event_id,node_id,webhook_url,attempt_number,next_retry_at,delivered_at,status_code,ok,error)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [eventId, nodeId, webhookUrl, attemptNumber, nextRetryAt, deliveredAt, statusCode, ok, error],
  );
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

export async function countTopupPurchasesSince(nodeId: string, sinceIso: string) {
  const rows = await query<{ c: string }>(
    "select count(*)::text as c from credit_ledger where node_id=$1 and type='topup_purchase' and amount > 0 and created_at >= $2::timestamptz",
    [nodeId, sinceIso],
  );
  return Number(rows[0]?.c ?? 0);
}

export async function getPrepurchaseOfferCreateUsage(nodeId: string) {
  const rows = await query<{ has_purchased: boolean; usage_today: string }>(
    `select
       (
         exists (
           select 1
           from credit_ledger cl
           where cl.node_id = $1::uuid
             and cl.type = 'topup_purchase'
             and cl.amount > 0
         )
         or exists (
           select 1
           from stripe_events e
           where e.type = 'invoice.paid'
             and (
               coalesce(e.payload->'data'->'object'->'metadata'->>'node_id', e.payload->'data'->'object'->>'node_id', e.payload->>'node_id') = $1::text
               or exists (
                 select 1
                 from subscriptions s
                 where s.node_id::text = $1::text
                   and s.stripe_customer_id is not null
                   and s.stripe_customer_id = coalesce(e.payload->'data'->'object'->>'customer', e.payload->>'customer')
               )
             )
         )
         or exists (
           select 1
           from subscriptions s
           where s.node_id = $1::uuid
             and s.plan_code in ('basic', 'pro', 'business')
             and s.status in ('active', 'past_due', 'canceled')
         )
       ) as has_purchased,
       (
         select count(*)::text
         from offers o
         where o.from_node_id = $1::uuid
           and o.deleted_at is null
           and o.created_at >= date_trunc('day', now())
       ) as usage_today`,
    [nodeId],
  );
  return {
    hasPurchased: Boolean(rows[0]?.has_purchased),
    usageToday: Number(rows[0]?.usage_today ?? 0),
  };
}

export async function getPrepurchaseOfferAcceptUsage(nodeId: string) {
  const rows = await query<{ has_purchased: boolean; usage_today: string }>(
    `select
       (
         exists (
           select 1
           from credit_ledger cl
           where cl.node_id = $1::uuid
             and cl.type = 'topup_purchase'
             and cl.amount > 0
         )
         or exists (
           select 1
           from stripe_events e
           where e.type = 'invoice.paid'
             and (
               coalesce(e.payload->'data'->'object'->'metadata'->>'node_id', e.payload->'data'->'object'->>'node_id', e.payload->>'node_id') = $1::text
               or exists (
                 select 1
                 from subscriptions s
                 where s.node_id::text = $1::text
                   and s.stripe_customer_id is not null
                   and s.stripe_customer_id = coalesce(e.payload->'data'->'object'->>'customer', e.payload->>'customer')
               )
             )
         )
         or exists (
           select 1
           from subscriptions s
           where s.node_id = $1::uuid
             and s.plan_code in ('basic', 'pro', 'business')
             and s.status in ('active', 'past_due', 'canceled')
         )
       ) as has_purchased,
       (
         select count(*)::text
         from offers o
         where o.deleted_at is null
           and (
             (o.from_node_id = $1::uuid and o.accepted_by_from_at >= date_trunc('day', now()))
             or
             (o.to_node_id = $1::uuid and o.accepted_by_to_at >= date_trunc('day', now()))
           )
       ) as usage_today`,
    [nodeId],
  );
  return {
    hasPurchased: Boolean(rows[0]?.has_purchased),
    usageToday: Number(rows[0]?.usage_today ?? 0),
  };
}

export async function getReferralClaim(nodeId: string) {
  const rows = await query<any>("select * from referral_claims where claimer_node_id=$1 and status='claimed' order by claimed_at asc limit 1", [nodeId]);
  return rows[0] ?? null;
}

export async function awardReferralFirstPaid(
  claimerNodeId: string,
  awardCredits: number,
  paymentReference: string,
  maxGrantsPerReferrer: number,
  meta: { invoice_id: string | null; stripe_subscription_id: string | null } = { invoice_id: null, stripe_subscription_id: null },
) {
  const idempotencyKey = `referral:first_paid:${claimerNodeId}:${paymentReference}`;
  const rows = await query<{
    claim_marked_awarded: boolean;
    credit_granted: boolean;
    claim_id: string | null;
    issuer_node_id: string | null;
  }>(
    `with claim as (
       update referral_claims
       set status='awarded', awarded_at=now()
       where claimer_node_id=$1
         and status='claimed'
       returning id, issuer_node_id, claimer_node_id
     ),
     issuer_lock as (
       select n.id
       from nodes n
       join claim on claim.issuer_node_id = n.id
       for update
     ),
     credit as (
       insert into credit_ledger(node_id, type, amount, meta, idempotency_key)
       select
         claim.issuer_node_id,
         'grant_referral',
         $2,
         jsonb_build_object(
           'claimer_node_id', claim.claimer_node_id,
           'claim_id', claim.id,
           'payment_reference', $3::text,
           'invoice_id', $4::text,
           'stripe_subscription_id', $5::text
         ),
         $6::text
       from claim
       join issuer_lock on issuer_lock.id = claim.issuer_node_id
       where (
         select count(*)::int
         from credit_ledger cl
         where cl.node_id = claim.issuer_node_id
           and cl.type = 'grant_referral'
           and cl.amount > 0
       ) < $7
       on conflict (node_id, idempotency_key) where idempotency_key is not null do nothing
       returning id
     )
     select
       exists(select 1 from claim) as claim_marked_awarded,
       exists(select 1 from credit) as credit_granted,
       (select id from claim limit 1) as claim_id,
       (select issuer_node_id from claim limit 1) as issuer_node_id`,
    [claimerNodeId, awardCredits, paymentReference, meta.invoice_id, meta.stripe_subscription_id, idempotencyKey, maxGrantsPerReferrer],
  );
  return rows[0] ?? {
    claim_marked_awarded: false,
    credit_granted: false,
    claim_id: null,
    issuer_node_id: null,
  };
}

export async function markReferralAwarded(claimId: string) {
  await query("update referral_claims set status='awarded', awarded_at=now() where id=$1", [claimId]);
}

export async function getDailyMetricsSnapshot(windowHours: number = 24) {
  const windowStart = new Date(Date.now() - (windowHours * 60 * 60 * 1000)).toISOString();

  const suspendedRows = await query<{ c: string }>(
    `select count(*)::text as c
     from nodes
     where deleted_at is null
       and (status='SUSPENDED' or suspended_at is not null)`,
  );
  const takedownRows = await query<{ c: string }>(
    `select count(*)::text as c
     from takedowns
     where reversed_at is null`,
  );
  const attemptsRows = await query<{ c: string }>(
    `select count(*)::text as c
     from recovery_challenges
     where created_at >= $1::timestamptz
       and attempts >= max_attempts`,
    [windowStart],
  );

  const stripeRows = await query<{ received: string; processing_errors: string }>(
    `select
       count(*)::text as received,
       count(*) filter (where processing_error is not null)::text as processing_errors
     from stripe_events
     where received_at >= $1::timestamptz`,
    [windowStart],
  );
  const creditRows = await query<{ grants: string; debits: string; net: string }>(
    `select
       coalesce(sum(case when amount > 0 then amount else 0 end), 0)::text as grants,
       coalesce(sum(case when amount < 0 then -amount else 0 end), 0)::text as debits,
       coalesce(sum(amount), 0)::text as net
     from credit_ledger
     where created_at >= $1::timestamptz`,
    [windowStart],
  );

  const publicRows = await query<{ listings: string; requests: string }>(
    `select
       (select count(*)::text from public_listings) as listings,
       (select count(*)::text from public_requests) as requests`,
  );
  const offerRows = await query<{ created: string; mutually_accepted: string }>(
    `select
       count(*) filter (where created_at >= $1::timestamptz)::text as created,
       count(*) filter (where mutually_accepted_at is not null and mutually_accepted_at >= $1::timestamptz)::text as mutually_accepted
     from offers
     where deleted_at is null`,
    [windowStart],
  );
  const reliabilityRows = await query<{ searches: string; active_nodes: string; active_api_keys: string }>(
    `select
       (select count(*)::text from search_logs where created_at >= $1::timestamptz) as searches,
       (select count(*)::text from nodes where deleted_at is null and status='ACTIVE' and suspended_at is null) as active_nodes,
       (select count(*)::text from api_keys where revoked_at is null) as active_api_keys`,
    [windowStart],
  );
  const webhookRows = await query<{ deliveries: string; failures: string }>(
    `select
       count(*)::text as deliveries,
       count(*) filter (where ok=false)::text as failures
     from event_webhook_deliveries
     where created_at >= $1::timestamptz`,
    [windowStart],
  );

  const suspended = Number(suspendedRows[0]?.c ?? 0);
  const activeTakedowns = Number(takedownRows[0]?.c ?? 0);
  const attemptsExceeded = Number(attemptsRows[0]?.c ?? 0);
  const stripeReceived = Number(stripeRows[0]?.received ?? 0);
  const stripeErrors = Number(stripeRows[0]?.processing_errors ?? 0);
  const creditGrants = Number(creditRows[0]?.grants ?? 0);
  const creditDebits = Number(creditRows[0]?.debits ?? 0);
  const creditNet = Number(creditRows[0]?.net ?? 0);
  const publicListings = Number(publicRows[0]?.listings ?? 0);
  const publicRequests = Number(publicRows[0]?.requests ?? 0);
  const offersCreated = Number(offerRows[0]?.created ?? 0);
  const offersMutuallyAccepted = Number(offerRows[0]?.mutually_accepted ?? 0);
  const searches = Number(reliabilityRows[0]?.searches ?? 0);
  const activeNodes = Number(reliabilityRows[0]?.active_nodes ?? 0);
  const activeApiKeys = Number(reliabilityRows[0]?.active_api_keys ?? 0);
  const webhookDeliveries = Number(webhookRows[0]?.deliveries ?? 0);
  const webhookFailures = Number(webhookRows[0]?.failures ?? 0);

  return {
    generated_at: new Date().toISOString(),
    window_hours: windowHours,
    abuse: {
      suspended_nodes: suspended,
      active_takedowns: activeTakedowns,
      recovery_attempts_exceeded: attemptsExceeded,
    },
    stripe_credits_health: {
      stripe_events_received: stripeReceived,
      stripe_processing_errors: stripeErrors,
      credit_grants: creditGrants,
      credit_debits: creditDebits,
      credit_net: creditNet,
    },
    liquidity: {
      public_listings: publicListings,
      public_requests: publicRequests,
      offers_created: offersCreated,
      offers_mutually_accepted: offersMutuallyAccepted,
    },
    reliability: {
      searches,
      active_nodes: activeNodes,
      active_api_keys: activeApiKeys,
    },
    webhook_health: {
      stripe_events_received: stripeReceived,
      stripe_processing_errors: stripeErrors,
      offer_webhook_deliveries: webhookDeliveries,
      offer_webhook_failures: webhookFailures,
    },
  };
}

import { config as loadEnv } from 'dotenv';
import { FabricClient, FabricError, type SearchRequestBody } from '../sdk/src/index.ts';

loadEnv({ path: 'examples/.env' });
loadEnv();

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

async function main() {
  const baseUrl = process.env.BASE_URL?.trim() || 'http://127.0.0.1:3000';
  const apiKey = process.env.API_KEY?.trim();
  if (!apiKey) {
    throw new Error('API_KEY is required for examples/search-offer.ts');
  }

  const scopeNotes = process.env.SEARCH_SCOPE_NOTES?.trim() || 'sdk-example-scope';
  const creditsRequested = parsePositiveInt(process.env.SEARCH_CREDITS_REQUESTED, 5);
  const offerNote = process.env.OFFER_NOTE?.trim() || null;
  const targetNodeId = process.env.SEARCH_TARGET_NODE_ID?.trim() || null;
  const targetUsername = process.env.SEARCH_TARGET_USERNAME?.trim() || null;

  const body: SearchRequestBody = {
    q: null,
    scope: 'OTHER',
    filters: { scope_notes: scopeNotes },
    broadening: { level: 0, allow: false },
    budget: { credits_requested: creditsRequested },
    target: targetNodeId || targetUsername ? { node_id: targetNodeId, username: targetUsername } : undefined,
    limit: 20,
    cursor: null,
  };

  const client = new FabricClient({ baseUrl, apiKey });
  const search = await client.searchListings(body);
  const first = search.items[0];
  const candidateId = first && typeof first.item?.id === 'string' ? first.item.id : null;
  if (!candidateId) {
    console.log('No listings returned. Update SEARCH_SCOPE_NOTES or target filters and retry.');
    return;
  }

  const created = await client.createOffer({
    unit_ids: [candidateId],
    thread_id: null,
    note: offerNote,
  });

  console.log(JSON.stringify({
    search_id: search.search_id,
    selected_unit_id: candidateId,
    offer_id: created.offer.id,
    offer_status: created.offer.status,
  }, null, 2));
}

main().catch((error) => {
  if (error instanceof FabricError) {
    console.error(JSON.stringify({
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details ?? null,
    }, null, 2));
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

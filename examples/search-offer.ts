import { FabricClient, FabricError, type SearchRequestBody } from '../sdk/src/index.js';

async function main() {
  const baseUrl = process.env.BASE_URL?.trim() || 'https://fabric-api-393345198409.us-west1.run.app';
  const apiKey = process.env.API_KEY?.trim();
  if (!apiKey) {
    throw new Error('API_KEY is required. Set it as an environment variable.');
  }

  const scopeNotes = process.env.SEARCH_SCOPE_NOTES?.trim() || 'sdk-example-scope';
  const creditsRequested = 5;
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

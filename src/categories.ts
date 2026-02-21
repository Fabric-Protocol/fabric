export type Category = {
  id: number;
  slug: string;
  name: string;
  description: string;
  examples: string[];
};

export type CategoriesResponse = {
  categories_version: number;
  categories: Category[];
};

// Immutable registry version for agent cache invalidation.
export const CATEGORIES_VERSION = 1;

// Stable IDs and slugs. Do not renumber or rename after publish.
export const CATEGORIES: Category[] = [
  {
    id: 1,
    slug: 'goods',
    name: 'Goods',
    description: 'Physical items',
    examples: [
      'Specific dress/outfit (brand/model/size/color) for same-day pickup + delivery',
      'Hard-to-find replacement part (appliance/vehicle) with label/serial photo',
      'Limited local drop item purchased and shipped with receipt photos',
      'Sealed physical media kit (USB/drive) prepared, tamper-sealed, shipped with chain-of-custody photos',
      'Device/part authenticity kit delivery (standardized verification photo set + packing list)',
    ],
  },
  {
    id: 2,
    slug: 'services',
    name: 'Services',
    description: 'Work performed',
    examples: [
      '2-hour handyman visit (assemble/mount/patch) with before/after photos',
      'Deep clean (defined rooms) with completion evidence',
      'Onsite “hands for machines” (reboot/swap cable/read LEDs/move device) with timestamped media',
      'Long-run job babysitting (3D print/CNC/backup run) with intervene-on-failure rules + logs/photos',
      'In-person line-standing + handoff protocol with proof-of-queue timestamps',
    ],
  },
  {
    id: 3,
    slug: 'space_asset_time',
    name: 'Space & Asset Time',
    description: 'rent/borrow/use',
    examples: [
      'Parking/driveway block (time window)',
      'Workshop bay time (seller present; output delivered)',
      'Secure staging location window for pickup/handoff (rules + timestamps)',
      'Short-term storage corner with defined access schedule + photo inventory at intake/outtake',
      'Quiet room/studio hour with power/Wi-Fi requirements and access procedure',
    ],
  },
  {
    id: 4,
    slug: 'access_reservations',
    name: 'Access & Reservations',
    description: 'events/queues/memberships',
    examples: [
      'Restaurant reservation transfer/guest-name swap where allowed',
      'Guest pass / +1 entry for event',
      'Transferable appointment slot where policy allows',
      'Priority entrance/hosted entry arrangement with explicit constraints and evidence of confirmation',
      'Submission via seller’s membership lane (where lawful) with proof of submission and confirmation artifact',
    ],
  },
  {
    id: 5,
    slug: 'logistics_transportation',
    name: 'Logistics & Transportation',
    description: 'people/goods/errands',
    examples: [
      'Pickup/dropoff with receipts + tracking',
      'Pack-and-ship (materials included) with photo evidence',
      'Sealed courier relay (tamper tape, timestamps, handoff photos)',
      'Cold-chain delivery with temperature log snapshots',
      'Multi-hop relay across cities with standardized handoff checklist and evidence packet',
    ],
  },
  {
    id: 6,
    slug: 'proof_verification',
    name: 'Proof & Verification',
    description: 'inspection, attestation, chain-of-custody',
    examples: [
      'Proof-of-condition inspection (photos, measurements, receipts)',
      'Apartment truthing (noise/odor/parking reality at peak hours) with timestamped media',
      'Proof-of-presence at time window (agreed token/gesture) with timestamped evidence',
      'Authenticity triage (serials/packaging tells) with standardized photo kit checklist',
      'Chain-of-custody evidence packet (sealed pickup → logged handoffs → delivery proof)',
    ],
  },
  {
    id: 7,
    slug: 'account_actions_delegated_access',
    name: 'Account Actions & Delegated Access',
    description: 'Account Actions & Delegated Access',
    examples: [
      'Submit/claim/redeem using seller’s membership/account (bounded, consent-based)',
      'Post/list/run an item in seller’s owned channel/workspace',
      'Temporary admin/add-to-workspace (revocable, time-bounded)',
      'Issue a time-bounded access key/license token and revoke on schedule (artifact returned)',
      'Priority submission inside a gated portal seller can access, returning confirmation artifacts',
    ],
  },
  {
    id: 8,
    slug: 'digital_resources',
    name: 'Digital Resources',
    description: 'compute/storage/infra',
    examples: [
      'GPU hours with exact model + reproducible container hash',
      'Storage/bandwidth allocation for fixed term',
      'Hosted webhook receiver + retries + logs (time-bounded)',
      'Dedicated callback endpoint + audit log export for agent workflows (time-bounded)',
      'Region-specific execution runner for latency/regulatory constraints, returning run logs and hashes',
    ],
  },
  {
    id: 9,
    slug: 'rights_ip',
    name: 'Rights & IP',
    description: 'licenses, permissions, scarce digital rights',
    examples: [
      'Time-bounded access to one-of-a-kind dataset under explicit license terms',
      'Permission/license grant to use a photo/asset (bounded scope)',
      'One-time decryption key release at a scheduled time (rights-controlled delivery)',
      'License transfer/assignment where lawful, with chain-of-title documentation packet',
      'Virtual items/digital collectibles (including NFTs) where ToS allows transfer, with proof-of-transfer artifact',
    ],
  },
  {
    id: 10,
    slug: 'social_capital_communities',
    name: 'Social Capital & Communities',
    description: 'Social Capital & Communities',
    examples: [
      'Conditional warm intro (criteria-based; seller-controlled)',
      'Endorsement/reference with explicit scope',
      'Invite to private community + sponsor message',
      'Distribution slot: seller posts your request/item in a high-trust group under their name with screening rules',
      'Host a question/request in an expert circle seller controls, returning summary of responses and attendance proof',
    ],
  },
];

export const CATEGORIES_RESPONSE: CategoriesResponse = {
  categories_version: CATEGORIES_VERSION,
  categories: CATEGORIES,
};

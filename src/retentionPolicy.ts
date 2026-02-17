const DAY_MS = 24 * 60 * 60 * 1000;

export const SEARCH_LOG_HOT_DAYS = 30;
export const SEARCH_LOG_ARCHIVE_MAX_DAYS = 365;

export function retentionCutoffs(now: Date = new Date()) {
  const nowMs = now.getTime();
  return {
    hotCutoff: new Date(nowMs - (SEARCH_LOG_HOT_DAYS * DAY_MS)),
    deleteCutoff: new Date(nowMs - (SEARCH_LOG_ARCHIVE_MAX_DAYS * DAY_MS)),
  };
}

export type SearchLogRetentionBucket = 'hot' | 'archive' | 'delete';

export function classifySearchLogRetention(createdAt: Date | string, now: Date = new Date()): SearchLogRetentionBucket {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const { hotCutoff, deleteCutoff } = retentionCutoffs(now);
  if (created < deleteCutoff) return 'delete';
  if (created < hotCutoff) return 'archive';
  return 'hot';
}

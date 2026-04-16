import {env} from '../config/env';

export interface ApiKeyEntry {
  name: string;
  key: string;
  namespace: string;
}

/**
 * Parse `STATEHASH_API_KEYS` env var into a lookup by key value.
 *
 * Format: comma-separated `name:key:namespace` triples. Each key has an
 * implicit default `namespace` that is used when the caller omits it on
 * `POST /v1/anchors`.
 */
function parseApiKeys(raw: string): Map<string, ApiKeyEntry> {
  const out = new Map<string, ApiKeyEntry>();
  const entries = raw.split(',');
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(':').map((s) => s.trim());
    if (parts.length !== 3 || parts.some((p) => !p)) {
      throw new Error(`STATEHASH_API_KEYS entry must be name:key:namespace (got "${trimmed}")`);
    }
    const [name, key, namespace] = parts as [string, string, string];
    if (out.has(key)) {
      throw new Error(
        `STATEHASH_API_KEYS duplicates key for names "${out.get(key)!.name}" and "${name}"`
      );
    }
    out.set(key, {name, key, namespace});
  }
  if (out.size === 0) {
    throw new Error('STATEHASH_API_KEYS must include at least one entry');
  }
  return out;
}

const keyMap = parseApiKeys(env.STATEHASH_API_KEYS);

export function findApiKey(rawKey: string | undefined | null): ApiKeyEntry | null {
  if (!rawKey) return null;
  return keyMap.get(rawKey) ?? null;
}

export function apiKeyCount(): number {
  return keyMap.size;
}

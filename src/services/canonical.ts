import {keccak256, stringToBytes, type Hex} from 'viem';

/**
 * Any JSON-shaped value a caller can submit as `payload`. statehash.io does
 * not care about the shape — the whole product is generic. Arrays preserve
 * order; object keys are sorted during canonicalization.
 */
export type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | CanonicalJsonValue[]
  | {[key: string]: CanonicalJsonValue};

/**
 * Deterministic JSON: UTF-8 string with sorted keys at every object level and
 * no extra whitespace. Arrays keep their order.
 *
 * This output is the preimage of the commitment hash. Changing it after any
 * anchor has been submitted on-chain invalidates all historical verifications,
 * so keep the implementation stable.
 */
export function canonicalJson(payload: CanonicalJsonValue): string {
  return stableStringify(payload);
}

/** Keccak-256 over the UTF-8 bytes of {@link canonicalJson}. */
export function commitmentHash(payload: CanonicalJsonValue): Hex {
  return keccak256(stringToBytes(canonicalJson(payload)));
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => stableStringify(item === undefined ? null : item))
      .join(',')}]`;
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  throw new TypeError(`Unsupported value for canonical JSON: ${String(value)}`);
}

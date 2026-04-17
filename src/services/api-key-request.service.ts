import {ulid} from 'ulid';
import {apiKeyRequestRepository} from '../repositories/api-key-request.repository';
import type {
  ApiKeyRequestRecord,
  ApiKeyRequestResponse,
} from '../types/api-key-request';
import logger from './logger';

export class ApiKeyRequestError extends Error {
  public readonly code:
    | 'rate_limited'
    | 'invalid_input'
    | 'internal';
  constructor(
    message: string,
    code: 'rate_limited' | 'invalid_input' | 'internal'
  ) {
    super(message);
    this.name = 'ApiKeyRequestError';
    this.code = code;
  }
}

export interface SubmitApiKeyRequestInput {
  email: string;
  name: string;
  company: string | null;
  website: string | null;
  useCase: string | null;
  source: string;
  /** Honeypot field — real browsers leave empty; bots fill it. */
  honeypot: string | null;
  ipAddress: string;
  userAgent: string | null;
}

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_IP = 8;
const MAX_NAME = 200;
const MAX_EMAIL = 320;
const MAX_COMPANY = 200;
const MAX_WEBSITE = 500;
const MAX_USE_CASE = 2000;
const MAX_SOURCE = 64;

function newRequestId(): string {
  return `akr_${ulid()}`;
}

function normalizeOptional(value: string | null, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Capture a public API-key request.
 *
 * Anti-abuse in this v1 is deliberately cheap:
 *   - Honeypot field (`website_url`): any non-empty value = silently drop.
 *   - Per-IP rate limit backed by the DB (no Redis dependency).
 *   - Hard field length caps so a malicious client can't blow up the row.
 *
 * The response intentionally echoes back very little (id + status) so this
 * endpoint can't be used to confirm whether a given email already exists.
 */
export async function submitApiKeyRequest(
  input: SubmitApiKeyRequestInput
): Promise<ApiKeyRequestResponse> {
  if (input.honeypot && input.honeypot.trim().length > 0) {
    logger.warn('api-key-request: honeypot tripped, dropping', {
      ip: input.ipAddress,
    });
    return {
      id: `akr_dropped_${ulid()}`,
      status: 'new',
      created_at: new Date().toISOString(),
    };
  }

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > MAX_EMAIL) {
    throw new ApiKeyRequestError(
      'a valid email address is required',
      'invalid_input'
    );
  }
  if (!name || name.length > MAX_NAME) {
    throw new ApiKeyRequestError(
      'name is required (max 200 chars)',
      'invalid_input'
    );
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await apiKeyRequestRepository.countByIpSince(
    input.ipAddress,
    since
  );
  if (recent >= RATE_LIMIT_MAX_PER_IP) {
    throw new ApiKeyRequestError(
      'too many requests from this address; please try again later',
      'rate_limited'
    );
  }

  try {
    const record: ApiKeyRequestRecord = await apiKeyRequestRepository.insert({
      id: newRequestId(),
      email,
      name: name.slice(0, MAX_NAME),
      company: normalizeOptional(input.company, MAX_COMPANY),
      website: normalizeOptional(input.website, MAX_WEBSITE),
      useCase: normalizeOptional(input.useCase, MAX_USE_CASE),
      source: normalizeOptional(input.source, MAX_SOURCE) || 'landing',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      status: 'new',
    });

    logger.info('api-key-request: captured', {
      id: record.id,
      email: record.email,
      source: record.source,
    });

    return {
      id: record.id,
      status: record.status,
      created_at: record.createdAt.toISOString(),
    };
  } catch (err) {
    logger.error('api-key-request: insert failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ApiKeyRequestError(
      'failed to submit request, please try again',
      'internal'
    );
  }
}

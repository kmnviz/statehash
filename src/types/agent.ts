/**
 * Domain shape for an Agent. An agent is a named actor — an AI model, an
 * analyst team, a content publisher, a compliance reviewer — that emits
 * claims under a namespace. Every agent has its own on-chain wallet so a
 * verifier can enumerate its anchors directly from the chain, without
 * trusting statehash.io.
 */
export interface Agent {
  id: string;
  namespace: string;
  displayName: string | null;
  address: `0x${string}`;
  chainId: number;
  apiKeyName: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Authenticated response — returned when the caller owns the agent's
 * namespace. Mirrors the public shape today, but may grow fields that are
 * only visible to the owner (usage stats, webhook config, gas balance, ...).
 */
export interface AgentResponse {
  id: string;
  namespace: string;
  display_name: string | null;
  address: `0x${string}`;
  chain_id: number;
  explorer_url: string;
  anchor_count: number;
  first_anchor_at: string | null;
  last_anchor_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Public response — returned from the unauthenticated `GET /v1/agents/:id`
 * endpoint. Intentionally identical to the owner view today: an agent's
 * address, anchor count, and history are designed to be world-readable so
 * any third party can audit the agent's track record.
 */
export type PublicAgentResponse = AgentResponse;

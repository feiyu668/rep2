# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI SDKs**: openai@^6, @anthropic-ai/sdk@^0.82

## Artifacts

### API Server (`artifacts/api-server`)
Express 5 backend. Serves:
- `/api` — standard REST API (healthz etc.)
- `/v1` — AI proxy routes (proxy.ts):
  - `GET /v1/models` — list available models (requires Bearer PROXY_API_KEY)
  - `POST /v1/chat/completions` — OpenAI-compatible endpoint; routes gpt-/o- to OpenAI, claude- to Anthropic
  - `POST /v1/messages` — Anthropic-native endpoint; routes claude- directly, openai models with format conversion
  - Full tool-call support, streaming (SSE), keepalive, format conversion between APIs

### API Portal (`artifacts/api-portal`)
React + Vite frontend at `/`. Dark-themed developer portal showing:
- Connection details and copy buttons
- All 3 API endpoints with descriptions and badges
- Available models grid (8 models total)
- CherryStudio 4-step setup guide
- Quick test curl example with syntax highlighting

## AI Integrations

- **OpenAI**: via Replit AI Integrations proxy (`AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`)
- **Anthropic**: via Replit AI Integrations proxy (`AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`)
- **PROXY_API_KEY**: user-provided secret for authenticating clients

## Models

OpenAI: `gpt-5.2`, `gpt-5-mini`, `gpt-5-nano`, `o4-mini`, `o3`
Anthropic: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

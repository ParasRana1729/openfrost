---
num: 014
title: "P0 — Agent chat loop with streamed responses (AI SDK, OpenAI + Anthropic, per-workspace model, 1 run/workspace)"
owner: AGENT
area: agent
labels: [P0, area:agent]
iteration: "Iteration 1"
depends_on: [007, 010, 012]
---

## Context
The heart of the product: an agent loop that uses workspace instructions/persona/memory, streams replies, runs tools (empty stub until #017), and respects the concurrency rule — one active run per workspace, others queue (spec §3, #29).

## Scope
- `packages/agent`: AI SDK loop; providers OpenAI + Anthropic (user's own keys from DPAPI); global default model + per-workspace override.
- System prompt assembly: workspace instructions + persona + capability list + memory summary (#016) + permission rules.
- Streaming via the #012 realtime hub (`message.streaming` chunks).
- Run manager: per-workspace lock/queue (AgentRun states), graceful stop on `openfrost stop`.
- Tool scaffold: registry + `toolExecutionRequested` events (approval wiring lands in #017/#018).

## Acceptance criteria
- [ ] Chat in each workspace uses its own instructions/persona/model.
- [ ] Two workspaces can respond in parallel; a second message in the *same* workspace queues (visible via `run.updated`).
- [ ] Provider switch OpenAI↔Anthropic works with only provider-local config changes.
- [ ] Streaming works on web and Telegram (Telegram splice-in lands with #020/#015).
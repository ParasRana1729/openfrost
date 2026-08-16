# ❄️ OpenFrost — Product One-Pager (MVP)

**Document Status:** Approved  
**Target Audience:** Power users, developers, and technical builders (Windows-first)  
**Release Target:** v0.1.0 (MVP)  
**Full Specification:** [`docs/ai-os-project-spec.md`](./ai-os-project-spec.md)

---

## 1. Problem Statement

Existing AI assistants are either closed web chat interfaces with no access to local files and terminals, or unrestricted shell scripts that pose severe security risks. Developers need an **AI Operating System** that runs locally on their own PC, separates contexts by task, and provides remote control with strict, approval-gated safety.

---

## 2. Product Vision & MVP Promise

> **One always-on, self-hosted AI OS on the user's PC, with isolated custom workspaces (Coding, Learning, General, Custom), synced Telegram/web chats, persistent hybrid memory, and approval-gated real-PC tools.**

---

## 3. Workspaces as AI Apps

| Workspace Template | Focus                                         | Default Capabilities                                                         | Security Tier                                                                      |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Coding**         | Software development, repo tasks, scripts     | Terminal exec, file read/write, managed Chromium browser, local folder links | `telegram` approval for standard actions, `local` dashboard approval for high-risk |
| **Learning**       | Research, study, notes, conceptual synthesis  | Markdown memory, web browsing, notes                                         | `auto` read & plan                                                                 |
| **General**        | Cross-workspace coordinator, global reminders | Promoted summaries from other workspaces, global scheduling                  | `auto` / `telegram`                                                                |
| **Custom**         | User-defined domain tasks                     | Configurable capability toggles & custom system instructions                 | Gated by enabled capabilities                                                      |

---

## 4. Security & Governance Model

1. **3-Tier Permission Classification**:
   - `auto`: Safe reads and planning execute without interruption.
   - `telegram`: Standard workspace modifications (write file, run dev server) require remote inline button approval.
   - `local`: High-risk actions (file deletion, overwrites, executing outside `.allowed-folders`, system/credential changes) **must be approved in the local Control Center session**.
2. **Secrets Storage**: Model API keys and Telegram tokens are encrypted using **Windows DPAPI** (`node:crypto` / `keytar`). Zero plaintext secrets on disk.
3. **Execution Concurrency**: Strictly **one active agent run per workspace**. Extra requests queue.

---

## 5. Non-Goals (Explicitly OUT of MVP Scope)

- ❌ **No Plugin Marketplace**: Fixed core tools only; no untrusted user scripts or marketplace.
- ❌ **No Screen/Mouse/Keyboard OS Automation**: Interacts only via scoped terminal and file APIs.
- ❌ **No Group Chat Bots**: Paired direct-messages only (1-to-1 trust boundary).
- ❌ **No Cloud Relays**: Completely self-hosted; local long polling for Telegram.
- ❌ **No Docker / VPS Requirements**: Native Windows daemon and SQLite database.

---

## 6. MVP Demo Acceptance Criteria (Definition of Done)

1. A user creates a Coding and a Learning workspace with distinct personalities.
2. They pair Telegram via a one-time code and send a message to the active workspace.
3. The chat appears instantly in the web dashboard (real-time sync <1s).
4. Each assistant remembers **only its own workspace's** context and memory.
5. A tool action requests approval in the dashboard and via Telegram buttons, and is successfully approved/rejected.
6. The background daemon restarts without losing any chats, workspaces, or memory.
7. A scheduled job runs, posts to Telegram and the activity log, and a missed job prompts the user at next sign-in.

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function withBasePath(path: string): string {
  if (!basePath || !path.startsWith('/')) {
    return path;
  }
  return `${basePath}${path}`;
}

export function getSiteBaseUrl(): string | undefined {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return undefined;
  }
  return siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
}

export function getMetadataBaseUrl(): URL {
  const fallback = new URL('http://127.0.0.1:3001');
  const siteBaseUrl = getSiteBaseUrl();
  if (!siteBaseUrl) {
    return fallback;
  }
  const trimmed = siteBaseUrl.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    return new URL(trimmed);
  } catch {
    return fallback;
  }
}

export const repositoryUrl = 'https://github.com/ParasRana1729/openfrost';
export const releasesUrl = `${repositoryUrl}/releases`;
export const bootstrapScriptUrl =
  'https://raw.githubusercontent.com/ParasRana1729/openfrost/main/scripts/bootstrap.ps1';
export const installCommand = `irm ${bootstrapScriptUrl} | iex`;

export const providers = ['OpenAI', 'Gemini', 'OpenRouter'] as const;

export const workflows = [
  {
    name: 'Research briefs',
    detail:
      'Searches the public web, reads bounded pages, and saves a Markdown brief with citations.',
    artifact: 'Research brief',
  },
  {
    name: 'Project updates',
    detail:
      'Reads supported files inside roots you grant and saves an evidence-backed update.',
    artifact: 'Project update',
  },
  {
    name: 'Weekly plans',
    detail:
      'Uses a project’s granted notes and recent saved updates to draft next steps for your review.',
    artifact: 'Weekly plan',
  },
] as const;

export const recentUpdates = [
  {
    title: 'Rust Control Center TUI & Frost Owl',
    detail:
      'Replaced the web control center with a native Ratatui terminal UI in the Glacier Ink palette—featuring the animated Frost Owl boot screen, live SSE execution trees, GFM Markdown tables, slash commands, and inline model selection.',
    tag: 'Control Center',
  },
  {
    title: 'One-command CLI & self-update',
    detail:
      'Run openfrost from any terminal to auto-start the local API and attach the TUI, manage background runs with start, stop, status, and logs, and pull or rebuild anytime via openfrost update.',
    tag: 'CLI launcher',
  },
  {
    title: 'Loopback trust without login friction',
    detail:
      'Removed local passwords, sessions, and CSRF onboarding screens. The API binds strictly to 127.0.0.1 with strict Origin checks for browser requests, while the TUI connects directly.',
    tag: 'Local security',
  },
  {
    title: 'Hardened secrets, models & SSRF guards',
    detail:
      'Provider keys are sealed with Windows DPAPI and redacted from error logs, fetch_page blocks NAT64 64:ff9b::/96 private addresses, and CI enforces Zod-to-Rust contract parity.',
    tag: 'Hardening',
  },
] as const;

export const tuiScreens = [
  {
    id: 'assistant',
    tabLabel: 'Assistant stream',
    title: 'Conversation-first stream with live SSE tool traces',
    caption:
      'Prompt from the bottom composer, switch project scope with Tab or mode with Shift+Tab, and watch bounded tool calls resolve into a rendered Markdown brief.',
    imageSrc: withBasePath('/images/tui-assistant.png'),
    imageAlt:
      'OpenFrost Assistant tab showing a live research brief execution tree, a rendered Markdown comparison table, and the bottom prompt composer',
  },
  {
    id: 'splash',
    tabLabel: 'Frost Owl boot',
    title: 'Animated Frost Owl splash & automatic runtime startup',
    caption:
      'Launching openfrost starts the background loopback API if needed and connects with an animated Glacier Ink boot card.',
    imageSrc: withBasePath('/images/tui-splash.png'),
    imageAlt:
      'OpenFrost terminal splash screen showing the Frost Owl mascot, shimmering wordmark, and local API startup indicator',
  },
  {
    id: 'tasks',
    tabLabel: 'Tasks & approvals',
    title: 'Global single-run queue and exact export approvals',
    caption:
      'Filter queued, running, completed, and failed tasks, inspect run history, and review exact content hashes before any file is exported.',
    imageSrc: withBasePath('/images/tui-tasks.png'),
    imageAlt:
      'OpenFrost Tasks tab listing an export task awaiting approval, completed briefs, and a queued weekly planning task',
  },
  {
    id: 'settings',
    tabLabel: 'Settings & DPAPI',
    title: 'Provider, model picker, DPAPI keys & export roots',
    caption:
      'Cycle between OpenAI, Gemini, and OpenRouter, pick or reset models inline with m, seal API keys with Windows DPAPI, and grant export folders.',
    imageSrc: withBasePath('/images/tui-settings.png'),
    imageAlt:
      'OpenFrost Settings tab showing the active OpenRouter provider, model configuration, Windows DPAPI key badge, and granted export folder',
  },
] as const;

export const executionLimits = [
  ['12', 'steps per run'],
  ['10', 'minutes wall-clock'],
  ['20,000', 'input characters'],
  ['100,000', 'output characters'],
] as const;

export const repositoryUrl = 'https://github.com/ParasRana1729/openfrost';
export const releasesUrl = `${repositoryUrl}/releases`;

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

export const executionLimits = [
  ['12 steps', 'per run'],
  ['10 minutes', 'wall-clock limit'],
  ['20,000 characters', 'input limit'],
  ['100,000 characters', 'output limit'],
] as const;

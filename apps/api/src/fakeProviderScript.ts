import type { ScriptedStep } from '@openfrost/agent';

/**
 * Dev/test provider script for OPENFROST_PROVIDER=fake: a deterministic
 * two-step "research" run that exercises the real fetch_page tool against
 * a stable public page, then produces an honest brief-shaped report. It
 * exists so the full request-to-report flow can be exercised without any
 * API key. It is never used unless explicitly requested via the env flag.
 */
export function fakeResearchScript(): ScriptedStep[] {
  return [
    {
      type: 'tool_calls',
      calls: [
        {
          name: 'fetch_page',
          argsJson: JSON.stringify({ url: 'https://example.com/' }),
        },
      ],
    },
    {
      type: 'final',
      usage: { inputTokens: 1840, outputTokens: 460 },
      citations: [{ url: 'https://example.com/', title: 'Example Domain' }],
      text: [
        '## Comparison',
        '',
        'This is a scripted development report produced by the fake provider',
        '(`OPENFROST_PROVIDER=fake`), not a real model. It demonstrates the full',
        'research-brief pipeline: task intake, bounded page retrieval, and a',
        'saved artifact with recorded retrieval timings.',
        '',
        '| Option | Retrieval | Notes |',
        '| --- | --- | --- |',
        '| example.com | via fetch_page | Placeholder page used by the script |',
        '',
        '## Recommendation',
        '',
        'Treat this run as a pipeline check. The retrieval appendix below is',
        'recorded by the runtime itself, so its timings and status codes are real',
        'even though the narrative above is scripted.',
        '',
        '## Sources',
        '',
        '- [Example Domain](https://example.com/) — retrieved via fetch_page',
        '',
        '## Uncertainties and unanswered questions',
        '',
        '- Everything here is scripted; no model reasoning occurred.',
        '- Hosted web-search timing is not exposed by the provider API.',
      ].join('\n'),
    },
  ];
}

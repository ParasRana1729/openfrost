import { FIRST_FILE_TOKEN, type ScriptedStep } from '@openfrost/agent';

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

/**
 * The fake weekly-plan counterpart for routine occurrences: reads the first
 * granted file (substituted from the task message's inventory) and produces
 * an honest plan-shaped draft with the three required sections. Lets the S06
 * routine workflow be exercised in a browser without any API key.
 */
export function fakeWeeklyPlanScript(): ScriptedStep[] {
  return [
    {
      type: 'tool_calls',
      calls: [
        {
          name: 'read_project_file',
          argsJson: JSON.stringify({ path: FIRST_FILE_TOKEN }),
        },
      ],
    },
    {
      type: 'final',
      usage: { inputTokens: 1210, outputTokens: 340 },
      text: [
        '## Draft priorities for next week',
        '',
        'This is a scripted development plan produced by the fake provider',
        '(`OPENFROST_PROVIDER=fake`), not a real model. It demonstrates the',
        'routine pipeline: granted-folder enumeration, a bounded file read,',
        'recent saved updates in context, and a saved artifact whose',
        'appendices are recorded by the runtime.',
        '',
        '1. Review the updates consulted below and confirm which priorities',
        '   actually matter.',
        '2. Nothing here is committed: the owner decides what to keep.',
        '',
        '## Unresolved questions',
        '',
        '- Whether the granted notes ground any priority at all — check the',
        '  file appendix for what was actually readable.',
        '',
        '## Suggested next steps',
        '',
        '- Replace this scripted run with a real model (Settings) and judge',
        '  the plan from the cited files, excerpts, and dated updates.',
      ].join('\n'),
    },
  ];
}

/**
 * The fake project-update counterpart: reads the first file from the run's
 * granted-file inventory (substituted by the fake provider from the task
 * message) and produces an honest update-shaped report. Lets the S03
 * project-update workflow be exercised in a browser without any API key.
 */
export function fakeProjectUpdateScript(): ScriptedStep[] {
  return [
    {
      type: 'tool_calls',
      calls: [
        {
          name: 'read_project_file',
          argsJson: JSON.stringify({ path: FIRST_FILE_TOKEN }),
        },
      ],
    },
    {
      type: 'final',
      usage: { inputTokens: 980, outputTokens: 310 },
      text: [
        '## Documented progress',
        '',
        'This is a scripted development update produced by the fake provider',
        '(`OPENFROST_PROVIDER=fake`), not a real model. It demonstrates the',
        'project-update pipeline: granted-folder enumeration, a bounded file',
        'read, and a saved artifact whose file appendix is recorded by the',
        'runtime.',
        '',
        'The notes state that this file was readable; nothing in this update',
        'is evidence that any feature shipped or a test passed.',
        '',
        '## Stated blockers',
        '',
        '- None can be stated from a scripted run.',
        '',
        '## Unknowns',
        '',
        '- If the requested file failed to read, the update is grounded in',
        '  nothing; the file appendix below records the real outcome.',
        '',
        '## Proposed next steps',
        '',
        '- Replace this scripted run with a real model (Settings) and judge',
        '  the update from the cited files and excerpts.',
      ].join('\n'),
    },
  ];
}

'use client';

import { useState } from 'react';

const examples = {
  research: 'Compare three self-hosted note apps and cite current pricing.',
  project: 'Summarize the decisions and open questions in my project notes.',
  planning: 'Draft next week’s priorities from my project notes and last update.',
} as const;

type Workflow = keyof typeof examples;

export function TaskPreview() {
  const [workflow, setWorkflow] = useState<Workflow>('research');
  const [request, setRequest] = useState<string>(examples.research);
  const [previewed, setPreviewed] = useState(false);

  function selectWorkflow(next: Workflow) {
    setWorkflow(next);
    setRequest(examples[next]);
    setPreviewed(false);
  }

  return (
    <div className="task-preview" data-ui aria-label="Interactive OpenFrost task preview">
      <div className="preview-heading">
        <div>
          <h2>Shape an example request</h2>
          <p>Choose a workflow, then edit the sample prompt.</p>
        </div>
        <span className="local-mark"><span aria-hidden="true" />Sample only</span>
      </div>

      <div className="workflow-choice" role="group" aria-label="Workflow">
        <button type="button" aria-pressed={workflow === 'research'} onClick={() => selectWorkflow('research')}>
          Research
        </button>
        <button type="button" aria-pressed={workflow === 'project'} onClick={() => selectWorkflow('project')}>
          Project update
        </button>
        <button type="button" aria-pressed={workflow === 'planning'} onClick={() => selectWorkflow('planning')}>
          Weekly plan
        </button>
      </div>

      <label className="sr-only" htmlFor="preview-request">Describe the task</label>
      <textarea
        id="preview-request"
        value={request}
        onChange={(event) => {
          setRequest(event.target.value);
          setPreviewed(false);
        }}
        rows={3}
        maxLength={500}
      />
      <div className="preview-actions">
        <span>One task runs at a time</span>
        <button
          className="action-button"
          type="button"
          onClick={() => setPreviewed(true)}
          disabled={!request.trim()}
        >
          Show sample result
        </button>
      </div>

      <div className="preview-result" aria-live="polite">
        {previewed ? (
          <>
            <span className="result-state">Example preview</span>
            <p><strong>{request.trim()}</strong></p>
            <p>
              OpenFrost would create a {workflow === 'research' ? 'research brief' : workflow === 'project' ? 'project update' : 'weekly plan'} draft and keep its sources with the saved result.
            </p>
          </>
        ) : (
          <>
            <span className="result-state">Ready for a request</span>
            <p>Try the sample to see how a saved result is presented.</p>
          </>
        )}
      </div>
      <p className="demo-note">This page preview is illustrative. It does not send a task or contact a model.</p>
    </div>
  );
}

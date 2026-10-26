'use client';

import { useState } from 'react';

const screens = ['Assistant', 'Tasks', 'Projects', 'Settings'] as const;
type Screen = (typeof screens)[number];

function AssistantScreen() {
  return (
    <div className="tour-workspace">
      <div className="tour-sidebar">
        <div className="tour-brand">OpenFrost</div>
        <span className="tour-nav active">Assistant</span>
        <span className="tour-nav">Tasks</span>
        <span className="tour-nav">Projects</span>
        <span className="tour-nav">Memory</span>
      </div>
      <div className="tour-main">
        <h3>What should I work on?</h3>
        <p>Choose a workflow and describe the result you need.</p>
        <div className="tour-composer">
          <p>Compare two approaches to backup for a small Windows project.</p>
          <div><span>Research brief</span><span className="tour-queue">Queue task</span></div>
        </div>
        <p className="tour-foot">The task runs locally. Sources and the saved brief stay in your workspace.</p>
      </div>
    </div>
  );
}

function TasksScreen() {
  return (
    <div className="tour-list">
      <div className="tour-list-title"><h3>Tasks</h3><span>One run at a time</span></div>
      <div className="tour-task"><span><strong>Compare backup approaches</strong><small>Research brief · just now</small></span><b>Running</b></div>
      <div className="tour-task"><span><strong>Prepare the project update</strong><small>Project update · today</small></span><b className="done">Completed</b></div>
      <div className="tour-task"><span><strong>Draft next week’s plan</strong><small>Weekly plan · Friday</small></span><b className="waiting">Queued</b></div>
      <p>Runs are saved, recoverable, and visible in the task history.</p>
    </div>
  );
}

function ProjectsScreen() {
  return (
    <div className="tour-project">
      <div><h3>Northstar notes</h3><span>Project context</span></div>
      <p>Only folders you grant are available to this project.</p>
      <div className="file-row"><span aria-hidden="true">▤</span><span>README.md</span><small>Ready to read</small></div>
      <div className="file-row"><span aria-hidden="true">▤</span><span>roadmap.md</span><small>Ready to read</small></div>
      <div className="file-row muted-file"><span aria-hidden="true">▤</span><span>personal.txt</span><small>Outside granted folder</small></div>
    </div>
  );
}

function SettingsScreen() {
  return (
    <div className="tour-settings">
      <h3>Provider settings</h3>
      <p>One configured model provider is active at a time.</p>
      <div className="provider-row"><span>OpenRouter</span><b>Active</b></div>
      <div className="provider-row"><span>OpenAI</span><small>Not configured</small></div>
      <div className="provider-row"><span>Gemini</span><small>Not configured</small></div>
      <p className="tour-foot">Provider keys are protected with Windows DPAPI.</p>
    </div>
  );
}

export function ProductTour() {
  const [screen, setScreen] = useState<Screen>('Assistant');
  return (
    <div className="product-tour" data-ui>
      <div className="tour-controls" role="group" aria-label="Choose a product view">
        {screens.map((name) => (
          <button key={name} type="button" aria-pressed={screen === name} onClick={() => setScreen(name)}>
            {name}
          </button>
        ))}
      </div>
      <div className="tour-canvas" aria-live="polite">
        {screen === 'Assistant' && <AssistantScreen />}
        {screen === 'Tasks' && <TasksScreen />}
        {screen === 'Projects' && <ProjectsScreen />}
        {screen === 'Settings' && <SettingsScreen />}
      </div>
    </div>
  );
}

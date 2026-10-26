import { MotionLayer } from '../components/MotionLayer';
import { ProductTour } from '../components/ProductTour';
import { TaskPreview } from '../components/TaskPreview';
import { executionLimits, providers, releasesUrl, repositoryUrl, workflows } from '../lib/content';

function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="mark" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M14 2.5v23M4.05 8.25l19.9 11.5M4.05 19.75l19.9-11.5" />
      <path d="m14 2.5-2.7 2.8M14 2.5l2.7 2.8M14 25.5l-2.7-2.8m2.7 2.8 2.7-2.8M4.05 8.25l3.85.2m-3.85-.2 1.1 3.7m16.8 7.8-1.1-3.7m1.1 3.7-3.85-.2M4.05 19.75l3.85-.2m-3.85.2 1.1-3.7m16.8-7.8-1.1 3.7m1.1-3.7-3.85.2" />
    </svg>
  );
}

const stages = [
  { title: 'A request enters', body: 'Describe a research brief, project update, or weekly plan.', tag: 'Saved to the local queue' },
  { title: 'One run starts', body: 'The single-run executor takes the next task and applies its bounded workflow.', tag: 'One active run' },
  { title: 'Sources are checked', body: 'Public pages or explicitly granted project files supply the evidence.', tag: 'Scope rechecked' },
  { title: 'A result is saved', body: 'The artifact keeps its sources and the run history for review.', tag: 'Markdown artifact' },
] as const;

const faqs = [
  ['Is OpenFrost available to download?', 'There is no packaged Windows installer published yet. The repository is available now, and the release page will list an installer when one is published.'],
  ['Does my data stay on this computer?', 'Structured app data is stored under %USERPROFILE%\\.openfrost and provider keys are protected with Windows DPAPI. Prompts, granted context, and retrieved excerpts are sent to your configured model or search provider for processing.'],
  ['What providers can I use?', 'The app includes adapters for OpenAI, Gemini, and OpenRouter. You choose one active provider in Settings.'],
  ['Does closing the browser stop a task?', 'No. The local API runs the task while the computer is awake and the runtime process is running. Closing the browser does not stop it.'],
  ['Which platforms are supported?', 'Windows is the supported platform today. The current secret-storage implementation uses Windows DPAPI.'],
  ['Can OpenFrost run any command or change files?', 'No. Arbitrary shell and operating-system control are outside v0.1. Folder reads require explicit grants. File export is limited to a reviewed, exact proposal and a granted destination.'],
] as const;

export default function Home() {
  return (
    <>
      <MotionLayer />
      <header className="site-header wrap">
        <a className="wordmark" href="#top" aria-label="OpenFrost home"><Mark /></a>
        <nav aria-label="Main navigation">
          <a href="#workflows">Workflows</a>
          <a href="#privacy">Privacy</a>
          <a href="#download">Get the code</a>
          <a className="nav-github" href={repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero wrap">
          <div className="hero-copy" data-reveal>
            <h1>OpenFrost AI assistant</h1>
            <p>Research the public web, summarize notes you grant, and save the result with its sources.</p>
            <div className="hero-actions">
              <a className="primary-link" href={repositoryUrl} target="_blank" rel="noreferrer">View the source</a>
              <a className="text-link" href="#workflows">See how it works</a>
            </div>
            <p className="hero-note">Windows-first. Runs on your machine, one task at a time.</p>
          </div>
          <div className="hero-demo" data-reveal>
            <TaskPreview />
          </div>
        </section>

        <section className="provider-line wrap" aria-label="Supported model providers">
          <p>Choose one provider in Settings</p>
          <ul>{providers.map((provider) => <li key={provider}>{provider}</li>)}</ul>
        </section>

        <section className="workflow-section" id="workflows">
          <div className="section-intro wrap" data-reveal>
            <h2>From request to saved work</h2>
            <p>A task moves through OpenFrost’s local queue, one run at a time. The saved artifact keeps its evidence.</p>
          </div>
          <div className="workflow-fields">
            {stages.map((stage, index) => (
              <article className={`workflow-field field-${index + 1}`} key={stage.title} data-reveal>
                <div className="stage-state" data-ui>
                  <span className="state-name">{stage.tag}</span>
                  <strong>{index === 0 ? 'Compare local backup options' : index === 1 ? 'Research brief' : index === 2 ? '4 sources consulted' : 'Brief saved'}</strong>
                  <span className="state-detail">{index === 0 ? 'Added to queue' : index === 1 ? 'Run 8 of 12 steps' : index === 2 ? 'Source list attached' : 'Markdown · citations included'}</span>
                </div>
                <div className="field-copy">
                  <h3>{stage.title}</h3>
                  <p>{stage.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="workflows-detail wrap">
          <div className="section-intro" data-reveal>
            <h2>Three kinds of work</h2>
            <p>One assistant identity. Projects scope the notes and approved context it can use.</p>
          </div>
          <div className="workflow-list">
            {workflows.map((workflow, index) => (
              <article className={`workflow-row workflow-row-${index + 1}`} key={workflow.name} data-reveal>
                <div><h3>{workflow.name}</h3><p>{workflow.detail}</p></div>
                <div className="artifact-fragment" data-ui>
                  <span>{workflow.artifact}</span>
                  <strong>{index === 0 ? 'Recommendation and citations' : index === 1 ? 'Evidence and next steps' : 'Priorities and open questions'}</strong>
                  <small>Saved for review</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="tour-section">
          <div className="tour-layout wrap">
            <div className="tour-copy" data-reveal>
              <h2>The work has a home</h2>
              <p>Queue, project scope, provider settings, and saved results live in the local Control Center.</p>
              <p>Choose a view to inspect a sample interface fragment based on the app’s current screens.</p>
            </div>
            <div className="tour-visual" data-reveal><ProductTour /></div>
          </div>
        </section>

        <section className="privacy-section wrap" id="privacy">
          <div className="privacy-copy" data-reveal>
            <h2>Your runtime stays local</h2>
            <p>The API and web app bind to loopback. Tasks and artifacts are stored on this PC, while model processing uses the provider you configure.</p>
            <p>Only the active project’s granted context and approved global preferences enter a task unless you attach other material.</p>
          </div>
          <div className="data-flow" data-ui data-reveal>
            <div className="flow-node"><strong>This PC</strong><span>Task queue · project files · artifacts</span></div>
            <div className="flow-connector" aria-hidden="true"><span>selected prompt and context</span></div>
            <div className="flow-node provider-node"><strong>Your chosen provider</strong><span>OpenAI · Gemini · OpenRouter</span></div>
            <p>Provider processing is not offline processing.</p>
          </div>
        </section>

        <section className="limits-section">
          <div className="limits-layout wrap">
            <div data-reveal>
              <h2>Runs have limits</h2>
              <p>Each run has a finite step, time, input, and output budget. The current defaults are shown here.</p>
            </div>
            <dl className="limit-list">
              {executionLimits.map(([value, label]) => (
                <div key={label} data-reveal><dt>{value}</dt><dd>{label}</dd></div>
              ))}
            </dl>
          </div>
        </section>

        <section className="download-section wrap" id="download">
          <div className="download-copy" data-reveal>
            <h2>Get OpenFrost</h2>
            <p>Windows is the supported platform today. The project has not published a packaged installer yet.</p>
          </div>
          <div className="download-panel" data-ui data-reveal>
            <div><strong>Build from source</strong><p>Node.js 24–26 and pnpm 10.34.7. Clone the repository, then follow its Quick start.</p></div>
            <a className="primary-link" href={repositoryUrl} target="_blank" rel="noreferrer">Open the repository</a>
            <a className="text-link" href={releasesUrl} target="_blank" rel="noreferrer">Check GitHub Releases</a>
            <p className="release-note">When a Windows installer is published, its version, size, checksum, and signing status belong here.</p>
          </div>
        </section>

        <section className="faq-section wrap" id="faq">
          <div data-reveal><h2>Before you start</h2></div>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <details key={question} data-reveal>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer wrap">
        <a className="footer-mark" href="#top"><Mark /><span>OpenFrost</span></a>
        <p>A local assistant for work.</p>
        <div><a href={repositoryUrl} target="_blank" rel="noreferrer">GitHub</a><a href={releasesUrl} target="_blank" rel="noreferrer">Releases</a><a href="#faq">FAQ</a></div>
        <small>Windows-first · v0.1 in development</small>
      </footer>
    </>
  );
}

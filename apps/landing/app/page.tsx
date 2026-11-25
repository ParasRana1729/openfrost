import Image from 'next/image';
import { HeroScene } from '../components/HeroScene';
import { InstallCommand } from '../components/InstallCommand';
import { MotionLayer } from '../components/MotionLayer';
import { ProductTour } from '../components/ProductTour';
import { TaskPreview } from '../components/TaskPreview';
import { TextScramble } from '../components/TextScramble';
import {
  executionLimits,
  providers,
  recentUpdates,
  releasesUrl,
  repositoryUrl,
  workflows,
} from '../lib/content';

function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="mark" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M14 2.5v23M4.05 8.25l19.9 11.5M4.05 19.75l19.9-11.5" />
      <path d="m14 2.5-2.7 2.8M14 2.5l2.7-2.8M14 25.5l-2.7-2.8m2.7 2.8 2.7-2.8M4.05 8.25l3.85.2m-3.85-.2 1.1 3.7m16.8 7.8-1.1-3.7m1.1 3.7-3.85-.2M4.05 19.75l3.85-.2m-3.85.2 1.1-3.7m16.8-7.8-1.1 3.7m1.1-3.7-3.85.2" />
    </svg>
  );
}

const faqs = [
  [
    'How do I install OpenFrost on Windows?',
    'Run the PowerShell bootstrap command in the Install section above. It clones the repository into %USERPROFILE%\\.openfrost\\source, builds the local API, and installs openfrost.exe via Cargo. Future updates take one command: openfrost update.',
  ],
  [
    'Does local mean offline?',
    'No. The API, task queue, and SQLite database run locally on your machine, but prompts, selected context, and retrieved excerpts are sent to your configured model or search provider for processing.',
  ],
  [
    'Which providers are supported?',
    'OpenAI, Gemini, and OpenRouter adapters are included. One configured provider is active at a time, and you can switch providers or edit the active model inline in the Settings tab.',
  ],
  [
    'What happens when I close the TUI?',
    'Closing the Control Center leaves the local loopback API running in the background so queued tasks and scheduled weekly planning routines finish. Manage it anytime with openfrost status, openfrost logs, or openfrost stop.',
  ],
  [
    'Can it read any folder or run arbitrary shell commands?',
    'No. Project reads require explicitly granted folder roots checked against canonical paths. Arbitrary shell access and operating-system control are outside v0.1.',
  ],
  [
    'How does file export work?',
    'A new Markdown report can be exported to a granted destination only after you review and approve the exact SHA-256-bound proposal in the Tasks tab. OpenFrost never overwrites or deletes user files.',
  ],
] as const;

export default function Home() {
  return (
    <>
      <MotionLayer />
      <header className="site-header wrap">
        <a className="wordmark" href="#top" aria-label="OpenFrost home"><Mark /><span>OpenFrost</span></a>
        <nav aria-label="Main navigation">
          <a href="#updates">Updates</a>
          <a href="#demo">Demo</a>
          <a href="#install">Install</a>
          <a className="nav-github" href={repositoryUrl} target="_blank" rel="noreferrer">Repository ↗</a>
        </nav>
      </header>

      <main id="top">
        <section className="masthead wrap" aria-label="OpenFrost product overview">
          <div className="hero-copy" data-reveal>
            <h1><TextScramble label="AI gets to work.">{'AI GETS\nTO WORK.'}</TextScramble></h1>
            <div className="hero-under">
              <p>A Windows-first local AI assistant for research briefs, project updates, and weekly plans—now with a Rust Control Center TUI.</p>
              <div className="hero-actions">
                <a className="primary-link" href="#install">Install via PowerShell <span aria-hidden="true">↓</span></a>
                <a className="text-link" href={repositoryUrl} target="_blank" rel="noreferrer">Explore the source <span aria-hidden="true">↗</span></a>
              </div>
            </div>
          </div>
          <div className="hero-stage" data-reveal>
            <HeroScene />
          </div>
          <div className="hero-caption"><span>One local assistant. Rust Ratatui TUI over a loopback API.</span><span>Scroll to explore</span></div>
        </section>

        <section className="signal-strip wrap" aria-label="Supported providers">
          <p>One assistant. One active run.</p>
          <div><span>Provider adapters</span>{providers.map((provider) => <strong key={provider}>{provider}</strong>)}</div>
        </section>

        <section className="exchange-section" id="updates">
          <div className="exchange-layout wrap">
            <div className="exchange-intro" data-reveal>
              <h2>What’s<br />new.</h2>
              <p>Recent updates on main: the native terminal Control Center, one-command lifecycle CLI, and simplified loopback trust.</p>
            </div>
            <div className="exchange-list">
              {recentUpdates.map((item) => (
                <article key={item.title} className="exchange-row" data-reveal>
                  <span className="exchange-symbol" aria-hidden="true">→</span>
                  <div><h3>{item.title}</h3><p>{item.detail}</p></div>
                  <span className="exchange-detail">{item.tag}</span>
                </article>
              ))}
              <div className="exchange-footnote">Projects scope context, granted folders, and memory—without creating separate assistant personalities.</div>
            </div>
          </div>
        </section>

        <section className="work-types wrap" id="work">
          <div className="work-heading" data-reveal>
            <h2>Work, kept.</h2>
            <p>Three repeatable workflows that save inspectable Markdown artifacts with evidence and sources.</p>
          </div>
          <div className="work-grid">
            {workflows.map((workflow, index) => (
              <article className={`work-card work-card-${index + 1}`} key={workflow.name} data-reveal>
                <div className="work-card-copy"><h3>{workflow.name}</h3><p>{workflow.detail}</p></div>
                <div className="work-card-artifact" data-ui>
                  <span>{workflow.artifact}</span>
                  <strong>{index === 0 ? 'Recommendation + citations' : index === 1 ? 'Evidence + next steps' : 'Priorities + open questions'}</strong>
                  <small>Saved for review</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="workbench-section" id="demo">
          <div className="product-tour-layout product-tour-lead wrap" data-reveal>
            <div className="tour-heading">
              <h2>Inside the TUI.</h2>
              <p>Real captures from the Ratatui Control Center. Switch views to inspect the Frost Owl boot card, live SSE tool trees, export approvals, and DPAPI settings.</p>
            </div>
            <ProductTour />
          </div>

          <div className="workbench-layout wrap">
            <div className="workbench-copy" data-reveal>
              <h3>Try a sample.</h3>
              <p>Pick a workflow or rewrite the prompt to preview how OpenFrost queues a bounded task. No network request is sent.</p>
              <div className="sample-stamp"><span /> Interactive example · client-side only</div>
            </div>
            <div className="workbench-demo" data-reveal><TaskPreview /></div>
          </div>
        </section>

        <section className="crystal-band wrap" aria-label="Photographs of snow crystals" data-reveal>
          <figure>
            <div className="crystal-photo"><Image src="/images/feathery-snow-crystals-2217830221.jpg" alt="Fine branching snow crystals on a dark glass surface" fill unoptimized sizes="(max-width: 760px) 100vw, 48vw" /></div>
            <figcaption>Feathery crystals · Jason Hollinger</figcaption>
          </figure>
          <figure>
            <div className="crystal-photo"><Image src="/images/snow-crystals.jpg" alt="A single snow crystal catching light against a black background" fill unoptimized sizes="(max-width: 760px) 100vw, 48vw" /></div>
            <figcaption>Snow crystals · ComputerHotline</figcaption>
          </figure>
          <figure>
            <div className="crystal-photo"><Image src="/images/snowflake-flickr-alexey-kljatov.jpg" alt="A sharply defined snowflake photographed against a dark surface" fill unoptimized sizes="(max-width: 760px) 100vw, 48vw" /></div>
            <figcaption>Snowflake · Alexey Kljatov</figcaption>
          </figure>
        </section>

        <section className="boundary-section wrap" id="boundary">
          <div className="boundary-copy" data-reveal>
            <h2>Local on this PC.</h2>
            <p>The Fastify API, SQLite queue, and approved Markdown memory stay on your machine. Only selected prompts, context, and search queries go to your configured provider.</p>
            <p>Loopback binding on 127.0.0.1 replaces local login passwords while keeping Origin guards, folder grant checks, and DPAPI key sealing intact.</p>
          </div>
          <div className="boundary-map" data-ui data-reveal>
            <div className="boundary-node"><span>YOUR PC</span><strong>OpenFrost runtime + TUI</strong><p>SQLite queue · DPAPI secrets · granted folders</p></div>
            <div className="boundary-connector"><i />selected prompt + context<i /></div>
            <div className="boundary-node provider-node"><span>CONFIGURED SERVICE</span><strong>Chosen provider</strong><p>{providers.join(' · ')}</p></div>
            <div className="boundary-note">Exports write new files only after exact SHA-256 proposal approval.</div>
          </div>
        </section>

        <section className="limits-section">
          <div className="limits-layout wrap">
            <div data-reveal><h2>A run has edges.</h2><p>Default execution limits keep every agent run bounded, recoverable, and legible.</p></div>
            <ul className="limit-list">
              {executionLimits.map(([value, label]) => (
                <li key={label} data-reveal><strong>{value} {label}</strong></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="build-section wrap" id="install">
          <div className="build-heading" data-reveal>
            <h2>Install easily.</h2>
            <p>Bootstrap from PowerShell on Windows, then launch the Control Center with <code>openfrost</code> and stay current with <code>openfrost update</code>.</p>
          </div>
          <div className="build-panel" data-ui data-reveal>
            <div className="build-panel-top"><span>POWERSHELL BOOTSTRAP</span><span>WINDOWS</span></div>
            <InstallCommand />
            <div className="build-panel-main">
              <div><strong>Git + Node 24–26</strong><span>Workspace runtime</span></div>
              <b>+</b>
              <div><strong>pnpm + Rust</strong><span>API &amp; TUI toolchain</span></div>
            </div>
            <div className="build-panel-actions">
              <a className="primary-link" href={repositoryUrl} target="_blank" rel="noreferrer">Open repository <span aria-hidden="true">↗</span></a>
              <a className="text-link" href={releasesUrl} target="_blank" rel="noreferrer">Check releases</a>
            </div>
            <p>Already cloned? Run <code>pnpm install &amp;&amp; pnpm run install:cli</code> from the repo root, then launch <code>openfrost</code>.</p>
          </div>
        </section>

        <section className="faq-section wrap" id="faq">
          <div className="faq-heading" data-reveal><h2>Before you begin.</h2></div>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <details key={question} data-reveal>
                <summary>{question}</summary><p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-top wrap"><a className="footer-mark" href="#top"><Mark /><span>OpenFrost</span></a><p>One assistant. Work worth keeping.</p><a className="footer-source" href={repositoryUrl} target="_blank" rel="noreferrer">Source repository ↗</a></div>
        <div className="footer-word wrap" aria-hidden="true">OPENFROST</div>
        <div className="footer-bottom wrap"><span>Windows-first · v0.1 in validation</span><span>Photos: Alexey Kljatov, <a href="https://commons.wikimedia.org/wiki/File:Real_snowflake_-_Flickr_-_Alexey_Kljatov_(6).jpg" target="_blank" rel="noreferrer">CC BY 4.0</a> and <a href="https://commons.wikimedia.org/wiki/File:Snowflake_-_Flickr_-_Alexey_Kljatov.jpg" target="_blank" rel="noreferrer">CC BY 2.0</a>; Jason Hollinger, <a href="https://commons.wikimedia.org/w/index.php?curid=24216163" target="_blank" rel="noreferrer">CC BY 2.0</a>; ComputerHotline, <a href="https://www.flickr.com/photos/36519414@N00/8503744693" target="_blank" rel="noreferrer">CC BY 2.0</a>.</span><a href="#faq">FAQ ↑</a></div>
      </footer>
    </>
  );
}

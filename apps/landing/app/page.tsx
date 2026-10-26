import Image from 'next/image';
import { HeroScene } from '../components/HeroScene';
import { MotionLayer } from '../components/MotionLayer';
import { ProductTour } from '../components/ProductTour';
import { TaskPreview } from '../components/TaskPreview';
import { executionLimits, providers, releasesUrl, repositoryUrl, workflows } from '../lib/content';

function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="mark" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M14 2.5v23M4.05 8.25l19.9 11.5M4.05 19.75l19.9-11.5" />
      <path d="m14 2.5-2.7 2.8M14 2.5l2.7-2.8M14 25.5l-2.7-2.8m2.7 2.8 2.7-2.8M4.05 8.25l3.85.2m-3.85-.2 1.1 3.7m16.8 7.8-1.1-3.7m1.1 3.7-3.85-.2M4.05 19.75l3.85-.2m-3.85.2 1.1-3.7m16.8-7.8-1.1 3.7m1.1-3.7-3.85.2" />
    </svg>
  );
}

const exchanges = [
  { prompt: 'What needs doing?', response: 'A research brief, project update, or weekly plan enters the local task queue.', detail: 'A request with a clear outcome' },
  { prompt: 'What may it use?', response: 'The active workflow applies its limits. Project work reads only files under roots you grant.', detail: 'A bounded run with scoped context' },
  { prompt: 'What remains?', response: 'A saved Markdown artifact with evidence, plus a visible record of the run.', detail: 'Work you can revisit and review' },
] as const;

const faqs = [
  ['Can I download a Windows installer?', 'There is no packaged installer published yet. OpenFrost is available from its source repository; check Releases for future packaged builds.'],
  ['Does local mean offline?', 'No. The app and structured data run locally, but prompts, selected context, and retrieved excerpts are sent to your configured model or search provider for processing.'],
  ['Which providers are supported?', 'OpenAI, Gemini, and OpenRouter adapters are included. One configured provider is active at a time.'],
  ['What happens when I close the browser?', 'The local API runs tasks while the computer is awake and the runtime process is running. Closing the browser does not stop the API task.'],
  ['Can it read any folder or run commands?', 'No. Project reads require explicitly granted folder roots. Arbitrary shell and operating-system control are outside v0.1.'],
  ['How does file export work?', 'A new report can be exported to a granted destination after you review the exact proposal. The destination is checked again when the write runs.'],
] as const;

export default function Home() {
  return (
    <>
      <MotionLayer />
      <header className="site-header wrap">
        <a className="wordmark" href="#top" aria-label="OpenFrost home"><Mark /><span>OpenFrost</span></a>
        <nav aria-label="Main navigation">
          <a href="#work">The work</a>
          <a href="#boundary">Data boundary</a>
          <a href="#build">Build</a>
          <a className="nav-github" href={repositoryUrl} target="_blank" rel="noreferrer">Repository ↗</a>
        </nav>
      </header>

      <main id="top">
        <section className="masthead wrap" aria-label="OpenFrost product overview">
          <div className="hero-copy" data-reveal>
            <h1>AI gets<br />to work.</h1>
            <div className="hero-under">
              <p>Research briefs, project updates, and weekly plans—finished, sourced, and ready to keep.</p>
              <div className="hero-actions">
                <a className="primary-link" href={repositoryUrl} target="_blank" rel="noreferrer">Explore the source <span aria-hidden="true">↗</span></a>
                <a className="text-link" href="#work">See what it does <span aria-hidden="true">↓</span></a>
              </div>
            </div>
          </div>
          <div className="hero-stage" data-reveal>
            <HeroScene />
          </div>
          <div className="hero-caption"><span>A personal AI OS for work with somewhere to go.</span><span>Illustrative workspace · Scroll to explore</span></div>
        </section>

        <section className="signal-strip wrap" aria-label="Supported providers">
          <p>One assistant. One active run.</p>
          <div><span>Provider adapters</span>{providers.map((provider) => <strong key={provider}>{provider}</strong>)}</div>
        </section>

        <section className="exchange-section" id="work">
          <div className="exchange-layout wrap">
            <div className="exchange-intro" data-reveal>
              <h2>Ask.<br /><span className="accent-type">Keep it.</span></h2>
              <p>Projects shape the context. They do not create separate assistant personalities.</p>
            </div>
            <div className="exchange-list">
              {exchanges.map((item) => (
                <article key={item.prompt} className="exchange-row" data-reveal>
                  <span className="exchange-symbol" aria-hidden="true">→</span>
                  <div><h3>{item.prompt}</h3><p>{item.response}</p></div>
                  <span className="exchange-detail">{item.detail}</span>
                </article>
              ))}
              <div className="exchange-footnote">The active project’s granted context stays in view, and every result can be traced to its run.</div>
            </div>
          </div>
        </section>

        <section className="work-types wrap">
          <div className="work-heading" data-reveal>
            <h2>Work, kept.</h2>
            <p>Small, inspectable outputs made to be revisited.</p>
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

        <section className="workbench-section">
          <div className="workbench-layout wrap">
            <div className="workbench-copy" data-reveal>
              <h2>Try a sample.</h2>
              <p>Change the workflow or rewrite the prompt. The preview is illustrative: it does not contact a model or create a task.</p>
              <div className="sample-stamp"><span /> Interactive example · no network request</div>
            </div>
            <div className="workbench-demo" data-reveal><TaskPreview /></div>
          </div>
          <div className="product-tour-layout wrap" data-reveal>
            <div className="tour-heading"><h3>The workspace.</h3><p>Queue, project, provider, and saved history. Illustrative fragments based on the current interface.</p></div>
            <ProductTour />
          </div>
        </section>

        <section className="boundary-section wrap" id="boundary">
          <div className="boundary-copy" data-reveal>
            <h2>Local on this PC.</h2>
            <p>The API, queue, and structured data live on this PC. To produce an answer, selected prompts and context go to the model or search provider you configure.</p>
            <p>Local does not mean offline. The application makes that boundary visible.</p>
          </div>
          <div className="boundary-map" data-ui data-reveal>
            <div className="boundary-node"><span>01 / YOUR PC</span><strong>OpenFrost runtime</strong><p>Queue · project files · artifacts</p></div>
            <div className="boundary-connector"><i />selected prompt + context<i /></div>
            <div className="boundary-node provider-node"><span>02 / CONFIGURED SERVICE</span><strong>Chosen provider</strong><p>{providers.join(' · ')}</p></div>
            <div className="boundary-note">Provider keys are protected with Windows DPAPI. The local UI binds to loopback.</div>
          </div>
        </section>

        <section className="limits-section">
          <div className="limits-layout wrap">
            <div data-reveal><h2>A run has edges.</h2><p>Default execution limits keep a task bounded and legible.</p></div>
            <ul className="limit-list">
              {executionLimits.map(([value, label]) => (
                <li key={label} data-reveal><strong>{value} {label}</strong></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="build-section wrap" id="build">
          <div className="build-heading" data-reveal><h2>Build OpenFrost.</h2><p>There is no packaged installer yet. The source is ready to inspect and run.</p></div>
          <div className="build-panel" data-ui data-reveal>
            <div className="build-panel-top"><span>FROM SOURCE</span><span>LOCAL SETUP</span></div>
            <div className="build-panel-main"><div><strong>Node.js 24–26</strong><span>Runtime</span></div><b>+</b><div><strong>pnpm 10.34.7</strong><span>Package manager</span></div></div>
            <div className="build-panel-actions"><a className="primary-link" href={repositoryUrl} target="_blank" rel="noreferrer">Open repository <span aria-hidden="true">↗</span></a><a className="text-link" href={releasesUrl} target="_blank" rel="noreferrer">Check releases</a></div>
            <p>Follow the repository Quick start to run the local Control Center.</p>
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
        <div className="footer-bottom wrap"><span>Windows-first · In development</span><span>Photos: Alexey Kljatov, <a href="https://commons.wikimedia.org/wiki/File:Real_snowflake_-_Flickr_-_Alexey_Kljatov_(6).jpg" target="_blank" rel="noreferrer">CC BY 4.0</a> and <a href="https://commons.wikimedia.org/wiki/File:Snowflake_-_Flickr_-_Alexey_Kljatov.jpg" target="_blank" rel="noreferrer">CC BY 2.0</a>; Jason Hollinger, <a href="https://commons.wikimedia.org/w/index.php?curid=24216163" target="_blank" rel="noreferrer">CC BY 2.0</a>; ComputerHotline, <a href="https://www.flickr.com/photos/36519414@N00/8503744693" target="_blank" rel="noreferrer">CC BY 2.0</a>.</span><a href="#faq">FAQ ↑</a></div>
      </footer>
    </>
  );
}

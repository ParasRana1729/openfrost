import type { Metadata } from 'next';
import { DownloadAction } from '../components/DownloadAction';
import {
  formatBytes,
  getLatestRelease,
  releasesUrl,
  sourceUrl,
} from '../lib/release';
import { DEFAULT_EXECUTION_LIMITS } from '@openfrost/domain';

export const metadata: Metadata = {
  alternates: process.env.NEXT_PUBLIC_SITE_URL
    ? { canonical: process.env.NEXT_PUBLIC_SITE_URL }
    : undefined,
};

function Flake() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="flake">
      {[0, 60, 120].map((rotation) => (
        <g key={rotation} transform={`rotate(${rotation} 12 12)`}>
          <path d="M12 2.5v19M9.7 4.8 12 2.5l2.3 2.3M9.7 19.2l2.3 2.3 2.3-2.3" />
        </g>
      ))}
    </svg>
  );
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  return `${minutes} min`;
}

function formatDate(date: string | null): string {
  if (!date) return 'Date not listed';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(date),
  );
}

export default async function Home() {
  const release = await getLatestRelease();
  const hasInstaller = Boolean(release?.assetUrl);
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OpenFrost',
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'Windows',
    description:
      'A local assistant for research briefs, project updates, and weekly planning.',
    softwareVersion: release?.version ?? '0.1.0',
    downloadUrl: release?.assetUrl ?? undefined,
    url: process.env.NEXT_PUBLIC_SITE_URL ?? sourceUrl,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
        }}
      />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="OpenFrost home">
          <Flake />
          <span>OpenFrost</span>
        </a>
        <nav aria-label="Main navigation" className="nav-links">
          <a href="#how">How it works</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#privacy">Privacy</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="nav-download" href="#download">
          {hasInstaller ? 'Download' : 'Get started'} <span aria-hidden="true">↗</span>
        </a>
      </header>

      <main id="top">
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="signal-dot" /> A local assistant for finished work</p>
            <h1 id="hero-title">One assistant.<br />Work that <span>gets finished.</span></h1>
            <p className="hero-lede">
              OpenFrost researches the public web or reads project notes you grant,
              runs one task at a time, and saves the result with its sources.
            </p>
            <div className="hero-actions">
              <DownloadAction url={release?.assetUrl ?? null} version={release?.version ?? null} />
              <a className="text-link" href={sourceUrl} target="_blank" rel="noreferrer">
                View on GitHub <span aria-hidden="true">↗</span>
              </a>
            </div>
              <p className="hero-note">
              {hasInstaller
                ? `Windows · ${release?.version} · Source available on GitHub`
                : 'Windows-first · Source available on GitHub · Installer not published yet'}
            </p>
          </div>

            <div className="hero-art" role="img" aria-label="Illustrative view of a completed OpenFrost research brief run">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="ice-core"><Flake /></div>
            <div className="trace-card">
              <div className="trace-head">
                <div><span className="trace-kicker">CURRENT RUN</span><strong>Research brief</strong></div>
                <span className="trace-state"><i /> Saved</span>
              </div>
              <div className="trace-query">Compare note-taking tools for a solo studio</div>
              <ol className="trace-list">
                <li className="done"><span className="trace-marker">✓</span><span>Request received</span><small>09:41:02</small></li>
                <li className="done"><span className="trace-marker">✓</span><span>Public sources reviewed</span><small>6 sources</small></li>
                <li className="done"><span className="trace-marker">✓</span><span>Recommendation drafted</span><small>with citations</small></li>
                <li className="saved"><span className="trace-marker">↳</span><span>Brief saved</span><small>Markdown</small></li>
              </ol>
              <div className="trace-footer"><span>ONE ACTIVE RUN</span><span>LOCAL HISTORY</span></div>
            </div>
            <p className="art-caption">Illustrative run view · one bounded run, saved for review</p>
          </div>
          <a className="scroll-cue" href="#how"><span /> See how it works</a>
        </section>

        <section className="provider-band" aria-label="Supported model providers">
          <div className="wrap provider-inner">
            <p>Choose one provider in the app</p>
            <ul><li>OpenAI</li><li>Google Gemini</li><li>OpenRouter</li></ul>
            <span className="provider-note">Bring your own API key</span>
          </div>
        </section>

        <section className="section wrap" id="how" aria-labelledby="how-title">
          <div className="section-intro">
            <p className="eyebrow">A clear path from request to result</p>
            <h2 id="how-title">Useful work, without losing the thread.</h2>
            <p>OpenFrost keeps the request, progress, sources, and saved result together on your machine.</p>
          </div>
          <div className="steps">
            <article className="step">
              <span className="step-number">01</span>
              <h3>Describe the work</h3>
              <p>Ask for a research brief, a project update, or a weekly plan. Grant project folders when a task needs them.</p>
            </article>
            <article className="step">
              <span className="step-number">02</span>
              <h3>OpenFrost runs one task</h3>
              <p>Progress is recorded as it runs. Other requests wait visibly in the queue, including work waiting for your approval.</p>
            </article>
            <article className="step">
              <span className="step-number">03</span>
              <h3>Review what it made</h3>
              <p>Completed briefs and updates remain in local history with source details, open questions, and the task that produced them.</p>
            </article>
          </div>
          <div className="demo-line" aria-label="Example run: request, queued, sources reviewed, result saved">
            <span>Request</span><i /><span>Queue</span><i /><span>Sources reviewed</span><i /><span>Saved result</span>
          </div>
        </section>

        <section className="story-band" id="capabilities" aria-labelledby="capabilities-title">
          <div className="wrap">
            <div className="section-intro section-intro-wide">
              <p className="eyebrow">One assistant, three useful workflows</p>
              <h2 id="capabilities-title">From open questions to a saved next step.</h2>
            </div>
            <div className="capability-layout">
              <article className="capability capability-large">
                <span className="capability-icon">⌕</span>
                <h3>Research with sources</h3>
                <p>Search the public web, compare options, and save a Markdown brief with citations, uncertainties, and unanswered questions.</p>
                <div className="source-stack"><span>01 · Product documentation</span><span>02 · Independent review</span><span>03 · Pricing page</span></div>
              </article>
              <article className="capability">
                <span className="capability-icon">▤</span>
                <h3>Project updates</h3>
                <p>Read supported text files inside folders you explicitly grant. Get an evidence-backed update with blockers and next steps.</p>
              </article>
              <article className="capability">
                <span className="capability-icon">◷</span>
                <h3>Weekly plans</h3>
                <p>Draft priorities from a project’s granted files and recent saved updates. Schedules are created and confirmed by you.</p>
              </article>
              <article className="capability capability-wide">
                <div><span className="capability-icon">⌂</span><h3>Local history that stays reviewable</h3><p>Tasks, artifacts, approved memory, and routine history are stored on your Windows machine.</p></div>
                <div className="mini-ledger"><span>task_08f2</span><b>completed</b><span>research_brief.md</span><b>saved locally</b><span>sources</span><b>8 references</b></div>
              </article>
            </div>
            <p className="feature-footnote">One assistant and one active run at a time. Projects organize context; they do not create separate assistants.</p>
          </div>
        </section>

        <section className="section wrap privacy-section" id="privacy" aria-labelledby="privacy-title">
          <div className="privacy-copy">
            <p className="eyebrow">Local first, clear about the boundary</p>
            <h2 id="privacy-title">Your machine holds the work. Your chosen provider runs the model.</h2>
            <p>OpenFrost stores structured work in a local SQLite database. Provider keys are protected with Windows DPAPI. Selected prompts, project excerpts, and research requests are sent to the provider you configure.</p>
            <p>There is no OpenFrost-hosted account or cloud database. Local-first does not mean offline: model and search requests need internet access.</p>
            <a className="text-link" href={`${sourceUrl}/blob/main/docs/ai-os-project-spec.md`} target="_blank" rel="noreferrer">Read the product specification ↗</a>
          </div>
          <div className="data-map" aria-label="Data flow from your computer to your selected model provider and back">
            <div className="map-node machine"><span className="node-icon">⌂</span><strong>Your machine</strong><small>Tasks · project files · history</small></div>
            <div className="map-wire"><i /><span>selected prompts and source excerpts</span><i /></div>
            <div className="map-node provider"><span className="node-icon">◇</span><strong>Chosen provider</strong><small>OpenAI · Gemini · OpenRouter</small></div>
            <div className="map-return">Model response returns to the local run</div>
            <div className="vault-note"><span aria-hidden="true">▣</span><span><b>Provider key</b><small>Protected by Windows DPAPI for the current user</small></span></div>
          </div>
        </section>

        <section className="limits-band" aria-labelledby="limits-title">
          <div className="wrap limits-inner">
            <div><p className="eyebrow">Bounded by design</p><h2 id="limits-title">A task has a defined stopping point.</h2></div>
            <dl className="limits-list">
              <div><dt>Maximum tool steps</dt><dd>{DEFAULT_EXECUTION_LIMITS.maxSteps}</dd></div>
              <div><dt>Run time</dt><dd>{formatDuration(DEFAULT_EXECUTION_LIMITS.maxWallClockMs)}</dd></div>
              <div><dt>Request size</dt><dd>{DEFAULT_EXECUTION_LIMITS.maxInputChars.toLocaleString()} chars</dd></div>
            </dl>
            <p className="limits-note">These are per-run defaults. The Control Center shows the active execution limits.</p>
          </div>
        </section>

        <section className="section wrap download-section" id="download" aria-labelledby="download-title">
          <div className="download-panel">
            <div className="download-copy">
              <p className="eyebrow">OpenFrost for Windows</p>
              <h2 id="download-title">Bring your work back to your own machine.</h2>
              {hasInstaller ? (
                <>
                  <p>Download the latest published Windows build. Review the release notes and any published checksum before installing.</p>
                  <DownloadAction url={release?.assetUrl ?? null} version={release?.version ?? null} />
                  <dl className="release-facts">
                    <div><dt>Version</dt><dd>{release?.version}</dd></div>
                    <div><dt>Published</dt><dd>{formatDate(release?.date ?? null)}</dd></div>
                    <div><dt>File</dt><dd>{release?.assetName}{release?.assetSize ? ` · ${formatBytes(release.assetSize)}` : ''}</dd></div>
                    {release?.sha256 && <div className="checksum"><dt>SHA-256</dt><dd>{release.checksumUrl ? <a href={release.checksumUrl}>Open checksum file</a> : release.sha256}</dd></div>}
                  </dl>
                  <a className="text-link" href={release?.notesUrl ?? releasesUrl} target="_blank" rel="noreferrer">Release notes ↗</a>
                  {!release?.sha256 && <p className="small-note">No SHA-256 checksum is published for this installer.</p>}
                  <p className="small-note">If the release is unsigned, Windows SmartScreen may show a warning. Check the release notes before continuing.</p>
                </>
              ) : (
                <>
                  <p>No Windows installer has been published yet. You can still inspect the source and run the local app with the developer toolchain.</p>
                  <a className="button button-primary" href={`${sourceUrl}#readme`} target="_blank" rel="noreferrer">Build from source <span aria-hidden="true">↗</span></a>
                  <a className="release-link" href={releasesUrl} target="_blank" rel="noreferrer">Check GitHub Releases ↗</a>
                  <ul className="source-requirements"><li>Windows 10 or 11</li><li>Node.js 24 LTS and pnpm 10</li><li>An API key from one supported provider</li></ul>
                </>
              )}
            </div>
            <div className="install-aside" id="source">
              <div className="aside-mark"><Flake /></div>
              <h3>Build from source</h3>
              <p>The current repository is the supported way to try OpenFrost while packaged releases are being prepared.</p>
              <ol className="install-steps">
                <li><span>1</span><code>git clone {sourceUrl}.git</code></li>
                <li><span>2</span><code>pnpm install</code></li>
                <li><span>3</span><code>pnpm dev</code></li>
              </ol>
              <a className="text-link" href={`${sourceUrl}#readme`} target="_blank" rel="noreferrer">Setup instructions ↗</a>
            </div>
          </div>
        </section>

        <section className="section wrap faq-section" id="faq" aria-labelledby="faq-title">
          <div className="section-intro"><p className="eyebrow">Before you begin</p><h2 id="faq-title">A few useful details.</h2></div>
          <div className="faq-list">
            <details><summary>What does OpenFrost cost?</summary><p>The repository does not yet define a software license or pricing. You provide your own model provider key; provider pricing and search fees depend on the provider and model you choose.</p></details>
            <details><summary>Does my data leave my machine?</summary><p>Prompts, selected context, and source excerpts are sent to the configured model or search provider to complete a task. Task history and artifacts are stored locally.</p></details>
            <details><summary>Which model providers work?</summary><p>OpenAI, Google Gemini, and OpenRouter are supported. The app uses one active provider at a time.</p></details>
            <details><summary>Does a task stop when I close the browser?</summary><p>No. A task can continue while the PC is awake and the local runtime is running. Sleep, shutdown, or stopping the runtime pauses execution; interrupted work is surfaced for review.</p></details>
            <details><summary>Can I use it on macOS or Linux?</summary><p>The app is Windows-first because provider keys use Windows DPAPI. Other platforms do not have a supported installer; source builds may require platform-specific changes.</p></details>
            <details><summary>Can it change or delete my files?</summary><p>Project workflows read only the supported files in folders you grant. Export is a separate approval-bound action that creates a new file; it does not overwrite or delete existing files.</p></details>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <a className="brand" href="#top"><Flake /><span>OpenFrost</span></a>
          <p>One assistant. Local work. Sources included.</p>
          <nav aria-label="Footer links"><a href={sourceUrl} target="_blank" rel="noreferrer">GitHub</a><a href={`${sourceUrl}/blob/main/README.md`} target="_blank" rel="noreferrer">Setup</a><a href={`${sourceUrl}/blob/main/docs/ai-os-project-spec.md`} target="_blank" rel="noreferrer">Specification</a></nav>
          <span className="footer-version">{release?.version ?? 'v0.1.0'} · Windows first</span>
        </div>
      </footer>
    </>
  );
}

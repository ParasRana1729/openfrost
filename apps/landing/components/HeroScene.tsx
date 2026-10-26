import Image from 'next/image';

export function HeroScene() {
  return (
    <div className="hero-scene" aria-label="Illustrative OpenFrost workspace with a sample task and saved result">
      <div className="hero-crystal-photo">
        <Image
          src="/images/real-snowflake-flickr-alexey-kljatov-6.jpg"
          alt="A real branching snow crystal, photographed against a deep blue background"
          fill
          priority
          unoptimized
          sizes="(max-width: 760px) 70vw, 34vw"
        />
      </div>

      <div className="hero-window" data-ui>
        <div className="hero-window-top"><span>OpenFrost · Control Center</span><span className="hero-window-live"><i /> Local</span></div>
        <div className="hero-window-title"><span>Welcome back</span><strong>Good morning,<br />Paras.</strong></div>
        <div className="hero-window-queue">
          <div className="hero-window-row"><span className="hero-row-icon">R</span><span><strong>Compare backup approaches</strong><small>Research brief · Sample</small></span><b>Ready</b></div>
          <div className="hero-window-row"><span className="hero-row-icon">P</span><span><strong>Northstar project update</strong><small>Markdown · Sample</small></span><b className="hero-saved">Saved</b></div>
        </div>
        <div className="hero-window-bottom"><span>One task runs at a time</span><span>View queue <b>↗</b></span></div>
      </div>

      <div className="hero-float-card hero-float-scope" data-ui><span>Project scope</span><strong>Granted folders only</strong></div>
      <div className="hero-float-card hero-float-artifact" data-ui><span>Saved artifact</span><strong>Research brief.md</strong><p>Sources included</p></div>
    </div>
  );
}

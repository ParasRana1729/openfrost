import Image from 'next/image';
import { withBasePath } from '../lib/content';
import { Tilt } from './Tilt';

export function HeroScene() {
  return (
    <Tilt className="hero-scene" aria-label="OpenFrost Terminal Control Center preview">
      <div className="hero-crystal-photo">
        <Image
          src={withBasePath('/images/real-snowflake-flickr-alexey-kljatov-6.jpg')}
          alt="A real branching snow crystal, photographed against a deep blue background"
          fill
          priority
          unoptimized
          sizes="(max-width: 760px) 70vw, 34vw"
        />
      </div>

      <div className="hero-window hero-window-tui" data-ui>
        <div className="hero-window-shot">
          <Image
            src={withBasePath('/images/tui-assistant.png')}
            alt="OpenFrost Rust Control Center TUI showing a completed research brief, SSE tool timeline, and rendered Markdown table"
            width={1908}
            height={1212}
            priority
            unoptimized
          />
        </div>
      </div>

      <div className="hero-float-card hero-float-scope" data-ui>
        <span>Terminal UI</span>
        <strong>Frost Owl · Glacier Ink</strong>
      </div>
      <div className="hero-float-card hero-float-artifact" data-ui>
        <span>CLI launcher</span>
        <strong>openfrost update</strong>
        <p>Loopback API + DPAPI keys</p>
      </div>
    </Tilt>
  );
}

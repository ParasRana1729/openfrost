import { ImageResponse } from 'next/og';

export const alt = 'OpenFrost, a local AI assistant for work';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-static';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '78px',
        background: '#06090f',
        color: '#eaf1f8',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: '#45c6f2', fontSize: 24, fontWeight: 700 }}>
        OPENFROST
      </div>
      <div style={{ maxWidth: 900, marginTop: 54, fontSize: 86, lineHeight: 1.02, fontWeight: 700, letterSpacing: -3 }}>
        A local AI assistant
      </div>
      <div style={{ maxWidth: 750, marginTop: 26, color: '#a5b7c9', fontSize: 28, lineHeight: 1.4 }}>
        Research, project updates, and weekly plans. Saved with their sources.
      </div>
    </div>,
    { ...size },
  );
}

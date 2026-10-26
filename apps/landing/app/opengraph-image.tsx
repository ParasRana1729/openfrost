import { ImageResponse } from 'next/og';

export const alt = 'OpenFrost — one assistant, work that gets finished';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-static';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '76px 88px',
          color: '#edf5fb',
          background:
            'radial-gradient(ellipse at 78% 36%, rgba(60, 151, 192, .22), transparent 38%), linear-gradient(135deg, #0b1724, #060a12 64%)',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: '#a8eaff', fontSize: 22 }}>
          <span style={{ fontSize: 30 }}>❄</span>
          <span>OpenFrost</span>
        </div>
        <div style={{ marginTop: 70, maxWidth: 930, fontSize: 76, fontWeight: 700, lineHeight: 1.02, letterSpacing: '-3px' }}>
          One assistant. Work that gets finished.
        </div>
        <div style={{ maxWidth: 760, marginTop: 27, color: '#bdcbd7', fontSize: 27, lineHeight: 1.35 }}>
          A local assistant for research briefs, project updates, and weekly plans.
        </div>
        <div style={{ position: 'absolute', right: 80, bottom: 46, color: '#73d4f5', fontSize: 18 }}>
          Windows first · Local history · Sources included
        </div>
      </div>
    ),
    size,
  );
}

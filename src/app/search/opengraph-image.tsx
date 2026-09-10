import { ImageResponse } from 'next/og';

export const alt = 'XoomPark — Search the live network';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '76px',
          background: '#d7f9ff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: 5, color: '#0e1c36' }}>
            XOOMPARK
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16, fontWeight: 600, letterSpacing: 4, color: 'rgba(14,28,54,0.65)', textTransform: 'uppercase' }}>
            <div style={{ display: 'flex', width: 12, height: 12, borderRadius: 999, background: '#0e1c36' }} />
            Live network
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 80, fontWeight: 500, lineHeight: 1.02, letterSpacing: -3, color: '#0e1c36' }}>
            Search the
          </div>
          <div style={{ display: 'flex', fontSize: 80, fontWeight: 500, lineHeight: 1.02, letterSpacing: -3, color: '#1a3a7a' }}>
            live network.
          </div>
          <div style={{ display: 'flex', marginTop: 26, fontSize: 24, color: 'rgba(14,28,54,0.65)', maxWidth: 820 }}>
            Charging, wash, and service capacity for AV fleets — browse by city, searchable by location.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 9 }}>
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              style={{ display: 'flex', width: 11, height: 11, borderRadius: 999, background: i % 3 === 0 ? '#0e1c36' : '#afcbff' }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}

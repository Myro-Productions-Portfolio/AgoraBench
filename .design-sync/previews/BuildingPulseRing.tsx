import React from 'react';
import { BuildingPulseRing } from 'agora-bench';

// The pulse is a 1.4s one-shot (opacity 0.7 → 0) keyed on pulse.triggeredAt — a
// static prop would be invisible by screenshot time. The live map re-triggers a
// pulse on every activity event (useAgentMap.triggerPulse), so these cells do the
// same: re-key the pulse on an interval so a fresh ring is always mid-animation.
function RepulsingRing({ buildingId, color }: { buildingId: string; color: string }) {
  const [n, setN] = React.useState(1);
  React.useEffect(() => {
    const t = setInterval(() => setN((v) => v + 1), 400);
    return () => clearInterval(t);
  }, []);
  return <BuildingPulseRing pulse={{ buildingId, color, triggeredAt: n }} />;
}

// Map-tile stand-in replicating CapitolMapPage's building button chrome so the
// ring has the footprint it wraps in the app (ring is absolute inset-0).
function BuildingTile({
  color,
  name,
  type,
  children,
}: {
  color: string;
  name: string;
  type: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ padding: 36, background: '#1A1B1E', borderRadius: 8, display: 'inline-block' }}>
      <div
        style={{
          position: 'relative',
          width: 190,
          height: 140,
          borderRadius: 4,
          background: `linear-gradient(160deg, ${color}1E 0%, ${color}09 100%)`,
          border: `1px solid ${color}3E`,
          boxShadow: '0 3px 14px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        {children}
        <div style={{ fontSize: '0.7rem', letterSpacing: '0.04em', color, textShadow: '0 1px 5px rgba(0,0,0,0.95)' }}>
          {name}
        </div>
        <div
          style={{
            fontSize: '0.45rem',
            letterSpacing: '0.2em',
            color: `${color}66`,
            marginTop: 2,
            textTransform: 'uppercase',
            fontFamily: 'monospace',
          }}
        >
          {type}
        </div>
      </div>
    </div>
  );
}

/* Gold pulse — an agent just cast a floor vote (agent:vote → Capitol) */
export const VoteActivityPulse = () => (
  <BuildingTile color="#C9B99B" name="Capitol Building" type="Legislative">
    <RepulsingRing buildingId="capitol" color="#B8956A" />
  </BuildingTile>
);

/* Green pulse — bill:resolved passed (Capitol + Archives flash green) */
export const BillPassedPulse = () => (
  <BuildingTile color="#72767D" name="National Archives" type="Records">
    <RepulsingRing buildingId="archives" color="#4CAF50" />
  </BuildingTile>
);

/* Red pulse — bill:resolved failed the floor vote */
export const BillFailedPulse = () => (
  <BuildingTile color="#C9B99B" name="Capitol Building" type="Legislative">
    <RepulsingRing buildingId="capitol" color="#F44336" />
  </BuildingTile>
);

/* pulse === undefined — building at rest, ring renders nothing (by design) */
export const IdleNoPulse = () => (
  <BuildingTile color="#3A6B3A" name="Election Center" type="Democracy">
    <BuildingPulseRing pulse={undefined} />
  </BuildingTile>
);

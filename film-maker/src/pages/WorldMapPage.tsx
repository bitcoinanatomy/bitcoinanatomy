import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/ui';
import { BEAT_COLOR, BEAT_LABEL } from '../model/arc';
import type { Character, ProjectData, World } from '../model/schema';
import { useData } from '../store/store';

/**
 * The whole story in one diagram: the Bitcoin world (the miner's node — its districts around the
 * core — floating in the network void) beside the human world, joined through the core. Characters
 * sit in their home location; story relationships are drawn between them. Pick an episode to see
 * who and where it uses.
 */

const VW = 1400;
const VH = 860;
const NODE = { x: 440, y: 440, r: 330 };
const CORE = { x: NODE.x, y: NODE.y, r: 96 };
const HUMAN = { x: 930, y: 40, w: 440, h: 780 };

interface Zone { id: string; name: string; world: World; x: number; y: number; w: number; h: number; round?: boolean }

/** lay out environments as zones: node districts around the core, core at the centre, void outside the node, human on the right */
function zonesFor(data: ProjectData): Zone[] {
  const envs = Object.values(data.environments).filter((e) => e.world);
  const by = (w: World) => envs.filter((e) => e.world === w).sort((a, b) => a.id.localeCompare(b.id));
  const zones: Zone[] = [];
  const nodeEnvs = by('node');
  nodeEnvs.forEach((e, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, nodeEnvs.length)) * Math.PI * 2 + Math.PI / nodeEnvs.length;
    const w = 210;
    const h = 130;
    zones.push({ id: e.id, name: e.name, world: 'node', x: NODE.x + Math.cos(a) * 205 - w / 2, y: NODE.y + Math.sin(a) * 205 - h / 2, w, h });
  });
  by('core').forEach((e, i) => zones.push({ id: e.id, name: e.name, world: 'core', x: CORE.x - CORE.r + i * 8, y: CORE.y - CORE.r, w: CORE.r * 2, h: CORE.r * 2, round: true }));
  const voidSlots = [{ x: 18, y: 18 }, { x: VW - HUMAN.w - 270 - 60, y: VH - 160 }, { x: 18, y: VH - 160 }, { x: VW - HUMAN.w - 330, y: 18 }];
  by('void').forEach((e, i) => zones.push({ id: e.id, name: e.name, world: 'void', ...voidSlots[i % voidSlots.length], w: 250, h: 130 }));
  const hum = by('human');
  hum.forEach((e, i) => {
    const h = (HUMAN.h - 70) / Math.max(1, hum.length) - 18;
    zones.push({ id: e.id, name: e.name, world: 'human', x: HUMAN.x + 20, y: HUMAN.y + 52 + i * (h + 18), w: HUMAN.w - 40, h });
  });
  return zones;
}

const isDark = (z: Zone) => z.world === 'void' || z.world === 'human';

/** avatar radius: coins by brightness/size, others by role */
function radius(c: Character) {
  if (c.id === 'coinbase') return 22;
  if (c.tags.includes('coin')) return c.id === 'bit' ? 16 : c.id === 'pip' || c.id === 'mili' ? 7 : 10;
  return 11;
}
function avatarStyle(c: Character, dark: boolean) {
  if (c.tags.includes('villain')) return { fill: '#000', stroke: '#fff', text: dark ? '#ddd' : '#111' };
  if (c.tags.includes('human')) return { fill: '#3a3a3a', stroke: '#8a8a8a', text: '#ccc' };
  if (c.tags.includes('crew')) return { fill: dark ? '#111' : '#fff', stroke: dark ? '#fff' : '#555', text: dark ? '#ddd' : '#222' };
  return { fill: '#fff', stroke: dark ? '#fff' : '#999', text: dark ? '#eee' : '#111' }; // coins glow
}

export function WorldMapPage() {
  const data = useData();
  const navigate = useNavigate();
  const [ep, setEp] = useState<string>();
  const [rels, setRels] = useState(true);
  const zones = useMemo(() => zonesFor(data), [data]);
  const zoneById = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z])), [zones]);

  const cast = useMemo(() => Object.values(data.characters).filter((c) => !c.tags.includes('extra')), [data]);

  // who/where each episode uses (from its shots)
  const usage = useMemo(() => {
    const out: Record<string, { chars: Set<string>; envs: Set<string> }> = {};
    for (const id of data.project.episodes) {
      const u = { chars: new Set<string>(), envs: new Set<string>() };
      for (const scId of data.episodes[id]?.scenes ?? []) {
        const sc = data.scenes[scId];
        if (!sc) continue;
        if (sc.environmentId) u.envs.add(sc.environmentId);
        for (const sh of sc.shots) {
          sh.characters.forEach((c) => u.chars.add(c));
          if (sh.environmentId) u.envs.add(sh.environmentId);
        }
      }
      out[id] = u;
    }
    return out;
  }, [data]);

  // place each character inside its home zone (a small grid), or at its world's default spot
  const pos = useMemo(() => {
    const groups: Record<string, Character[]> = {};
    for (const c of cast) {
      const z = (c.home && zoneById[c.home]) || zones.find((zz) => zz.world === c.world);
      if (!z) continue;
      (groups[z.id] ??= []).push(c);
    }
    const out: Record<string, { x: number; y: number; z: Zone }> = {};
    for (const [zid, list] of Object.entries(groups)) {
      const z = zoneById[zid];
      const cols = 2;
      const cw = z.w / cols;
      list.forEach((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = z.round ? z.x + z.w / 2 + (col - 0.5) * 70 : z.x + cw * (col + 0.5);
        const y = z.round ? z.y + 50 + row * 52 : z.y + 52 + row * 46;
        out[c.id] = { x, y, z };
      });
    }
    return out;
  }, [cast, zones, zoneById]);

  const used = ep ? usage[ep] : undefined;
  const dimChar = (id: string) => (used ? !used.chars.has(id) : false);
  const dimZone = (id: string) => (used ? !used.envs.has(id) : false);
  const portalFrom = zones.find((z) => z.world === 'core');
  const portalTo = zoneById.garage ?? zones.find((z) => z.world === 'human');
  const epObj = ep ? data.episodes[ep] : undefined;

  return (
    <>
      <Header crumbs={[{ label: 'World map' }]}>
        <button className={`btn sm ${rels ? 'on' : ''}`} onClick={() => setRels(!rels)}>Relationships</button>
      </Header>
      <div className="page">
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          <button className={`btn sm ${!ep ? 'on' : ''}`} onClick={() => setEp(undefined)}>Whole season</button>
          {data.project.episodes.map((id) => {
            const e = data.episodes[id];
            if (!e) return null;
            return <button key={id} className={`btn sm ${ep === id ? 'on' : ''}`} onClick={() => setEp(ep === id ? undefined : id)}>{e.number}. {e.title}</button>;
          })}
        </div>
        <div className="muted" style={{ minHeight: 20, marginBottom: 8 }}>
          {epObj ? <>{epObj.arc.beat && <span className="plot-beat" style={{ color: BEAT_COLOR[epObj.arc.beat], borderColor: BEAT_COLOR[epObj.arc.beat], marginLeft: 0, marginRight: 8 }}>{BEAT_LABEL[epObj.arc.beat]}</span>}{epObj.logline || epObj.synopsis}</> : data.project.season.logline}
        </div>
        <div className="card worldmap">
          <svg viewBox={`0 0 ${VW} ${VH}`} width="100%">
            <defs>
              <radialGradient id="wm-node" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#dfe2e6" />
              </radialGradient>
              <filter id="wm-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
            </defs>

            {/* the network void, with other nodes — each holds the same coins */}
            <rect x={0} y={0} width={HUMAN.x - 20} height={VH} rx={10} fill="#000" />
            {Array.from({ length: 34 }, (_, i) => {
              const x = 30 + ((i * 197) % (HUMAN.x - 80));
              const y = 30 + ((i * 131) % (VH - 60));
              const d = Math.hypot(x - NODE.x, y - NODE.y);
              if (d < NODE.r + 30) return null;
              return <g key={i}><circle cx={x} cy={y} r={4 + (i % 4)} fill="none" stroke="#fff" strokeOpacity={0.5} /><circle cx={x} cy={y} r={1.4} fill="#fff" /><line x1={x} y1={y} x2={NODE.x} y2={NODE.y} stroke="#fff" strokeOpacity={0.05} /></g>;
            })}
            <text x={24} y={VH / 2} className="wm-world dark" transform={`rotate(-90 24 ${VH / 2})`} textAnchor="middle">NETWORK VOID · THOUSANDS OF NODES, THE SAME COINS IN EACH</text>

            {/* the miner's node: a city of light around the core */}
            <circle cx={NODE.x} cy={NODE.y} r={NODE.r} fill="url(#wm-node)" stroke="#fff" strokeWidth={2} />
            <text x={NODE.x} y={NODE.y - NODE.r + 26} textAnchor="middle" className="wm-world">THE MINER’S NODE — BITCOIN WORLD</text>
            {/* the human world */}
            <rect x={HUMAN.x} y={HUMAN.y} width={HUMAN.w} height={HUMAN.h} rx={10} fill="#060606" stroke="#222" />
            <text x={HUMAN.x + HUMAN.w / 2} y={HUMAN.y + 30} textAnchor="middle" className="wm-world dark">HUMAN WORLD — ONLY BITCOIN THINGS GIVE OFF LIGHT</text>

            {/* zones */}
            {zones.map((z) => {
              const dark = isDark(z);
              const op = dimZone(z.id) ? 0.25 : 1;
              return (
                <g key={z.id} opacity={op} className="wm-zone" onDoubleClick={() => navigate(`/environments/${z.id}`)}>
                  {z.round ? (
                    <circle cx={z.x + z.w / 2} cy={z.y + z.h / 2} r={z.w / 2} fill="#f6f7f8" stroke="#888" strokeDasharray="3 3" />
                  ) : (
                    <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={8} fill={dark ? (z.world === 'void' ? '#0b0b0b' : '#0e0e0e') : '#fafbfc'} stroke={dark ? '#333' : '#c9ccd1'} />
                  )}
                  <text x={z.round ? z.x + z.w / 2 : z.x + 10} y={z.round ? z.y + 26 : z.y + 18} textAnchor={z.round ? 'middle' : 'start'} className={`wm-zone-name ${dark ? 'dark' : ''}`}>{z.name.toUpperCase()}</text>
                </g>
              );
            })}
            {/* the core holds the timechain: a little helix */}
            {portalFrom && (
              <path d={Array.from({ length: 40 }, (_, i) => `${i ? 'L' : 'M'}${CORE.x + Math.sin(i * 0.55) * 22},${CORE.y - 50 + i * 3.6}`).join(' ')} fill="none" stroke="#999" strokeWidth={1.2} opacity={0.6} />
            )}

            {/* the portal: through the core to the node box in the garage */}
            {portalFrom && portalTo && (
              <g className="wm-portal">
                <path d={`M${CORE.x + CORE.r},${CORE.y} C ${CORE.x + 330},${CORE.y - 40} ${portalTo.x - 160},${portalTo.y + portalTo.h / 2} ${portalTo.x},${portalTo.y + portalTo.h / 2}`} fill="none" stroke="#fff" strokeWidth={2} strokeDasharray="2 6" filter="url(#wm-glow)" />
                <path d={`M${CORE.x + CORE.r},${CORE.y} C ${CORE.x + 330},${CORE.y - 40} ${portalTo.x - 160},${portalTo.y + portalTo.h / 2} ${portalTo.x},${portalTo.y + portalTo.h / 2}`} fill="none" stroke="#fff" strokeWidth={1} strokeDasharray="2 6" />
                <text x={(CORE.x + portalTo.x) / 2 + 60} y={CORE.y - 40} textAnchor="middle" className="wm-rel-label light">portal: the core ↔ the node box</text>
              </g>
            )}

            {/* relationships */}
            {rels && cast.flatMap((c) => c.relations.map((r) => {
              const a = pos[c.id];
              const b = pos[r.to];
              if (!a || !b) return null;
              const dim = used && !(used.chars.has(c.id) && used.chars.has(r.to));
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2 - Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
              const ly = (a.y + b.y) / 2 - Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.18) / 2;
              return (
                <g key={`${c.id}-${r.to}-${r.label}`} opacity={dim ? 0.12 : 0.85}>
                  <path d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`} fill="none" stroke="#888" strokeWidth={1} />
                  <text x={mx} y={ly} textAnchor="middle" className={`wm-rel-label ${Math.hypot(mx - NODE.x, ly - NODE.y) < NODE.r ? 'light' : ''}`}>{r.label}</text>
                </g>
              );
            }))}

            {/* characters */}
            {cast.map((c) => {
              const p = pos[c.id];
              if (!p) return null;
              const dark = isDark(p.z);
              const st = avatarStyle(c, dark);
              const r = radius(c);
              return (
                <g key={c.id} opacity={dimChar(c.id) ? 0.18 : 1} className="wm-char" onClick={() => navigate(`/characters/${c.id}`)}>
                  <title>{`${c.name} — ${c.role}\n${c.description}`}</title>
                  {c.tags.includes('coin') && <circle cx={p.x} cy={p.y} r={r + 4} fill="#fff" opacity={0.6} filter="url(#wm-glow)" />}
                  <circle cx={p.x} cy={p.y} r={r} fill={st.fill} stroke={st.stroke} strokeWidth={1.4} />
                  <text x={p.x} y={p.y + r + 13} textAnchor="middle" className="wm-name" fill={st.text}>{c.name}</text>
                  {c.tags.includes('s2') && <text x={p.x} y={p.y + r + 24} textAnchor="middle" className="wm-tag" fill={st.text}>season 2</text>}
                </g>
              );
            })}
          </svg>
          <div className="legend" style={{ padding: '10px 14px' }}>
            <span><i style={{ background: '#fff', boxShadow: '0 0 6px #fff' }} />coin (size = value)</span>
            <span><i style={{ background: '#fff', border: '1px solid #555' }} />node crew</span>
            <span><i style={{ background: '#000', border: '1px solid #fff' }} />antagonist</span>
            <span><i style={{ background: '#3a3a3a' }} />human</span>
            <span className="grow" />
            <span>click a character to open it · double-click a place · pick an episode to see who and where it uses</span>
          </div>
        </div>
      </div>
    </>
  );
}

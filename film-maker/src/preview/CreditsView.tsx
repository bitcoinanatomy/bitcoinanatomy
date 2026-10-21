/** Renders intro/outro credits at a local time: timed title cards plus an optional scrolling roll. */
import { fillCredit, type CreditVars } from '../model/credits';
import type { Credits } from '../model/schema';

export { creditVars, fillCredit, type CreditVars } from '../model/credits';

const opacityAt = (t: number, start: number, dur: number, fade: number) => {
  const local = t - start;
  if (local < 0 || local > dur) return 0;
  const f = Math.min(fade, dur / 2);
  if (f <= 0) return 1;
  return Math.min(1, local / f, (dur - local) / f);
};

export function CreditsView({ credits, time, vars }: { credits: Credits; time: number; vars: CreditVars }) {
  const roll = credits.roll;
  const rollP = roll ? (time - roll.start) / roll.duration : -1;
  // fade the whole thing in from / out to black at the edges
  const edge = opacityAt(time, 0, credits.duration, Math.min(0.4, credits.fade));
  return (
    <div className="credits" style={{ background: credits.background, color: credits.color }}>
      <div className="credits-inner" style={{ opacity: edge }}>
        {roll && rollP >= 0 && rollP <= 1 && (
          <div className="credits-roll" style={{ top: `${(1 - rollP) * 100}%`, transform: `translateY(-${rollP * 100}%)` }}>
            {roll.sections.map((s, i) => (
              <div key={i} className="credits-section">
                <div className="credits-heading">{fillCredit(s.heading, vars)}</div>
                {s.names.map((n, j) => <div key={j} className="credits-name">{fillCredit(n, vars)}</div>)}
              </div>
            ))}
          </div>
        )}
        {credits.cards.map((c) => {
          const o = opacityAt(time, c.start, c.duration, credits.fade);
          if (o <= 0) return null;
          return (
            <div key={c.id} className={`credits-card align-${c.align}`} style={{ opacity: o, transform: `translateY(${(1 - o) * 6}px)` }}>
              {c.lines.map((l, i) => <div key={i} className={`credit-line size-${l.size}`}>{fillCredit(l.text, vars)}</div>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

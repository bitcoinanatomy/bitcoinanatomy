import { useCallback, useEffect, useRef } from 'react';
import { Header } from '../components/ui';
import { sampleCamera } from '../model/timeline';
import { LOOK_LABEL, LOOKS, useLook } from '../preview/look';
import { SceneView } from '../preview/SceneView';
import { SHOT_CHARACTER, SHOT_DEMOS, SHOT_ENV, type ShotDemo } from '../preview/shotDemos';
import { useData } from '../store/store';

function LookToggle() {
  const [look, setLook] = useLook();
  return (
    <div className="seg" title="Preview art direction">
      {LOOKS.map((k) => (
        <button key={k} type="button" className={look === k ? 'on' : ''} onClick={() => setLook(k)}>{LOOK_LABEL[k]}</button>
      ))}
    </div>
  );
}

interface LiveCard {
  demo: ShotDemo;
  canvas: HTMLCanvasElement;
  t0: number;
}

/** One looping study. Frames are blitted from the page's single WebGL context. */
function ShotCard({ demo, register }: { demo: ShotDemo; register: (demo: ShotDemo, canvas: HTMLCanvasElement, on: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = canvas.current!;
    const io = new IntersectionObserver(([entry]) => register(demo, node, entry?.isIntersecting ?? false), { rootMargin: '120px' });
    io.observe(node);
    return () => {
      io.disconnect();
      register(demo, node, false);
    };
  }, [demo, register]);

  return (
    <article className="tile" style={{ cursor: 'default' }}>
      <div className="viewer" style={{ aspectRatio: '16/9' }}>
        <canvas className="gl" ref={canvas} />
      </div>
      <div className="body">
        <div className="title">{demo.name}</div>
        <div className="desc">{demo.note}</div>
        <div className="meta">
          <span className="tag">{demo.lens}</span>
          <span className="mono">{demo.duration}s</span>
        </div>
      </div>
    </article>
  );
}

export function ShotsPage() {
  const data = useData();
  const [look] = useLook();
  const who = data.characters[SHOT_CHARACTER]?.name ?? SHOT_CHARACTER;
  const where = data.environments[SHOT_ENV]?.name ?? SHOT_ENV;
  const live = useRef(new Map<string, LiveCard>());

  const register = useCallback((demo: ShotDemo, canvas: HTMLCanvasElement, on: boolean) => {
    const cur = live.current.get(demo.id);
    if (on) {
      if (cur?.canvas === canvas) return;
      live.current.set(demo.id, { demo, canvas, t0: performance.now() / 1000 });
    } else if (cur?.canvas === canvas) live.current.delete(demo.id);
  }, []);

  useEffect(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:360px;pointer-events:none';
    document.body.appendChild(host);
    const view = new SceneView(host);
    view.setPilot(false);
    view.setLoop(false);
    view.renderer.setPixelRatio(1);
    let stop = false;
    let raf = 0;
    const boot = (async () => {
      view.setLook(look);
      await view.setContent(data, {
        envId: SHOT_ENV,
        assets: [],
        characters: [SHOT_CHARACTER],
        positions: { [SHOT_CHARACTER]: { position: [0, 0, 0], rotationY: 0 } },
      });
      if (stop) return;
      const frame = () => {
        if (stop) return;
        raf = requestAnimationFrame(frame);
        const now = performance.now() / 1000;
        for (const { demo, canvas, t0 } of live.current.values()) {
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          if (!w || !h) continue;
          if (host.clientWidth !== w || host.clientHeight !== h) {
            host.style.width = `${w}px`;
            host.style.height = `${h}px`;
            view.resize();
          }
          const t = ((now - t0) % demo.duration + demo.duration) % demo.duration;
          view.setPerformance({ positions: demo.positions, expressions: demo.expressions, poses: demo.poses });
          view.setShotTime(t);
          view.setCamera(sampleCamera(demo.camera, t), true);
          view.render(now);
          const buf = view.renderer.domElement;
          if (canvas.width !== buf.width || canvas.height !== buf.height) {
            canvas.width = buf.width;
            canvas.height = buf.height;
          }
          canvas.getContext('2d')?.drawImage(buf, 0, 0);
        }
      };
      raf = requestAnimationFrame(frame);
    })();
    void boot;
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      view.dispose();
      host.remove();
    };
  }, [data, look]);

  return (
    <>
      <Header crumbs={[{ label: 'Shots' }]}>
        <LookToggle />
      </Header>
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>Shots</h1>
            <p>
              Twenty camera studies, all on {who} in the {where}. Cranes, orbits, pans, a dolly zoom,
              runs, a bird's-eye drop, a slider reveal, and a long-lens approach. Each card loops.
            </p>
          </div>
        </div>
        <div className="grid lg">
          {SHOT_DEMOS.map((demo) => <ShotCard key={demo.id} demo={demo} register={register} />)}
        </div>
      </div>
    </>
  );
}

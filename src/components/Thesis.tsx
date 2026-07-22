import { useEffect, useRef } from "react";

const FOCUS = [
  { n: "01", name: <>Agent OS + New Hardware</> },
  { n: "02", name: <>Agent-Native Applications + Vertical Agents</> },
  { n: "03", name: <>Agent Infrastructure</> },
  { n: "↯", name: <>Wildcard &mdash; <span style={{ fontWeight: 500, color: "var(--tx)" }}>anything radically disruptive</span></> },
];

const PLANETS = [
  { title: "Global Resources", sub: "Cross-border networks & market access from day one" },
  { title: "Team Recruitment", sub: "Talent pipeline for critical early hires" },
  { title: "Dynamic Strategy", sub: "Frontier intelligence into actionable decisions" },
  { title: "Fundraising", sub: "Warm intros to co-investors & follow-on capital" },
  { title: "Inspire Co-creation", sub: "Ideate, challenge, and build from signal zero" },
  { title: "Long-term Companionship", sub: "Through pivots, dark months & second winds" },
  { title: "Expert Network", sub: "Frontier AI researchers & domain leads" },
];

const NODE_POS = [
  [340, 110], [520, 197], [564, 391], [440, 547], [240, 547], [116, 391], [160, 197],
] as const;

function Cosmos() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ct = ref.current;
    if (!ct) return;
    const place = () => {
      const ps = ct.querySelectorAll<HTMLElement>(".di-planet");
      const sz = ct.offsetWidth;
      if (sz < 400) { ps.forEach((p) => (p.style.cssText = "")); return; }
      const r = sz * 0.338, n = ps.length;
      ps.forEach((p, i) => {
        const a = (i / n) * 2 * Math.PI - Math.PI / 2;
        p.style.left = `${sz / 2 + r * Math.cos(a) - 70}px`;
        p.style.top = `${sz / 2 + r * Math.sin(a) - 44}px`;
        p.style.position = "absolute";
      });
    };
    const t = window.setTimeout(place, 50);
    window.addEventListener("resize", place);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", place); };
  }, []);

  return (
    <div className="di-cosmos" ref={ref}>
      <svg className="di-cosmos-bg" viewBox="0 0 680 680">
        {NODE_POS.map(([x, y]) => (
          <line key={`l${x}-${y}`} x1="340" y1="340" x2={x} y2={y} stroke="rgba(201,168,76,.12)" strokeWidth="0.5" />
        ))}
        <circle cx="340" cy="340" r="230" stroke="rgba(201,168,76,.42)" fill="none" strokeWidth="1.2" strokeDasharray="4 9">
          <animateTransform attributeName="transform" type="rotate" from="0 340 340" to="360 340 340" dur="28s" repeatCount="indefinite" />
        </circle>
        <circle cx="340" cy="340" r="155" stroke="rgba(201,168,76,.2)" fill="none" strokeWidth="0.8" strokeDasharray="2 8">
          <animateTransform attributeName="transform" type="rotate" from="360 340 340" to="0 340 340" dur="42s" repeatCount="indefinite" />
        </circle>
        {NODE_POS.map(([x, y]) => (
          <circle key={`n${x}-${y}`} cx={x} cy={y} r="3.5" fill="rgba(201,168,76,.8)" />
        ))}
      </svg>
      <div className="di-cosmos-center">
        <div className="di-cl-wrap">
          <div className="di-cl-ring"><img src="/images/extracted/nav.png" alt="Creekstone" loading="lazy" decoding="async" /></div>
        </div>
      </div>
      {PLANETS.map((p) => (
        <div className="di-planet" key={p.title}>
          <div className="di-p-title">{p.title}</div>
          <div className="di-p-sub">{p.sub}</div>
        </div>
      ))}
    </div>
  );
}

export default function Thesis() {
  return (
    <section id="thesis">
      <div className="t-inner">
        <div className="sl fi">04 · Investment Thesis</div>
        <div className="t-layout">
          <div className="t-left">
            <h2 className="t-h2 fi">Betting on<br /><span className="gg">the Edge.</span></h2>
            <p className="t-body fi d1">
              The next wave of builders aren't iterating on the old stack — they're
              replacing it with agents. We are{" "}
              <b style={{ color: "var(--tx)", fontWeight: 500 }}>100% agent-native</b>{" "}
              in conviction: every company we back is either building agent
              infrastructure, operating as an agent-first product, or using agents
              as its core competitive moat.
            </p>
          </div>
          <div className="t-right fi d2">
            <div className="flc">
              {FOCUS.map((f) => (
                <div className="flc-item" key={f.n}>
                  <span className="flc-n">{f.n}</span>
                  <div><div className="flc-name">{f.name}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="tm-bottom fi d3">
          <div className="tm-tagline">We don't just invest. <span className="gg">We co-build.</span></div>
          <Cosmos />
          <div className="t-phi">
            <span className="t-phi-phrase"><b>Earliest</b> Discovery.</span>
            <span className="t-phi-sep">·</span>
            <span className="t-phi-phrase"><b>Deepest</b> Exploration.</span>
            <span className="t-phi-sep">·</span>
            <span className="t-phi-phrase"><b>Longest</b> Partnership.</span>
            <span className="t-phi-inf">—&thinsp;<span className="t-phi-arr">→</span>&thinsp;<span className="t-phi-oo">∞</span></span>
          </div>
        </div>
      </div>
    </section>
  );
}

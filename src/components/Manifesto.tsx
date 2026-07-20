const RULES = [
  { dim: "// People", n: "// 01", en: <><b>Young. Ambitious.</b> Small Ego.</>, cls: "rule fi" },
  { dim: "// People", n: "// 02", en: <><b>Broad Karma.</b> A Complete Worldview.</>, cls: "rule fi d1" },
  { dim: "// Mission", n: "// 03", en: <><b>Built for Agents.</b> Built for the top&nbsp;1% of humans.</>, cls: "rule fi d2" },
  { dim: "// Mission", n: "// 04", en: <><b>Recursively Native.</b> Dynamically Evolving.</>, cls: "rule fi d3" },
];

export default function Manifesto() {
  return (
    <section id="manifesto">
      <div className="m-inner">
        <div className="sl fi">02 · Manifesto</div>
        <div className="m-big fi d1">
          We don't bet on <em>experience.</em><br />We bet on <em>native variables.</em>
        </div>
        <div className="rules">
          {RULES.map((r) => (
            <div className={r.cls} key={r.n}>
              <div className="r-dim">{r.dim}</div>
              <div className="r-n">{r.n}</div>
              <div className="r-en">{r.en}</div>
            </div>
          ))}
        </div>
        <div className="m-note fi d4">
          <p>
            We are <em>China's most radical early-stage AI Native investor.</em>{" "}
            The best founders arrive after the old rules were written — they build
            as if the prior world never existed. We call this the{" "}
            <em>native variable advantage.</em> We've spent years learning how to
            find it first.
          </p>
        </div>
      </div>
    </section>
  );
}

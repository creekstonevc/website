import StaggeredText from "@/components/react-bits/staggered-text";

const QUOTES = [
  { text: "They are different than every investor I have ever seen. They are more like co-founders for us.", av: "av-lw", ph: "LW", name: "Leah Wang", co: "Founder, Machine Pulse" },
  { text: "If I had to choose one institution to have on my board, Creekstone would unequivocally be the one and only answer.", av: "av-lm", ph: "LM", name: "Leon Ming", co: "Founder, Youware" },
  { text: "Creekstone stands out as a pioneer with sharp, native AI investment intelligence. Poised to become a leading force in the AI revolution.", av: "av-cp", ph: "CP", name: "Chris Pan", co: "Founder, Odysslife" },
  { text: "Not just a check, but a true partner. When I felt lost, they helped me find my bearings. It's rare to find investors who genuinely roll up their sleeves alongside you.", av: "av-pc", ph: "PC", name: "Peter Chen", co: "Founder, Mem-U" },
];

const SIGNALS = [
  { sig: "SIGNAL.01", tag: "NATIVE", title: "creekstone.signal — native", emit: "native", q: "\"We refuse the domestication of old experience. We only back the 1% native variables that dare to recalculate the world.\"", sq: "\"Specific knowledge is knowledge you cannot be trained for. If society can train you, it can replace you.\"", attr: "— Naval Ravikant" },
  { sig: "SIGNAL.02", tag: "DELIVERY", title: "creekstone.signal — delivery", emit: "delivery", q: "\"Interaction is no longer the destination. Delivery is.\"", sq: "\"The hottest new programming language is English.\"", attr: "— Andrej Karpathy" },
  { sig: "SIGNAL.03", tag: "VERTICAL", title: "creekstone.signal — vertical", emit: "vertical", q: "\"Going brutally vertical is the only way out.\"", sq: "\"Competition is for losers. If you want to create and capture lasting value, build a monopoly.\"", attr: "— Peter Thiel · Zero to One" },
  { sig: "SIGNAL.04", tag: "LEGACY", title: "creekstone.signal — legacy", emit: "legacy", q: "\"Your legacy system is someone else's native home.\"", sq: "\"No man ever steps in the same river twice, for it's not the same river and he's not the same man.\"", attr: "— Heraclitus · ~500 BC" },
  { sig: "SIGNAL.05", tag: "MOAT", title: "creekstone.signal — moat", emit: "moat", q: "\"The real moat is not code — it is every dynamic evolution driven by the cognitive core.\"", sq: "\"What I cannot create, I do not understand.\"", attr: "— Richard Feynman · Caltech Blackboard" },
  { sig: "SIGNAL.06", tag: "CONTEXT", title: "creekstone.signal — context", emit: "context", q: "\"Context is not a feature. Context is civilization.\"", sq: "\"The limits of my language are the limits of my world.\"", attr: "— Ludwig Wittgenstein · 1921" },
  { sig: "SIGNAL.07", tag: "AGENT", title: "creekstone.signal — agent", emit: "agent", q: "\"The future Agent is not a dialogue box. The final form of Agent is the disappearing UI — Proactive Sensing.\"", sq: "\"The medium is the message.\"", attr: "— Marshall McLuhan · 1964" },
  { sig: "SIGNAL.08", tag: "CO-FOUNDER", title: "creekstone.signal — co-founder", emit: "co-founder", q: "\"We don't preach from the high ground. We evolve alongside you in the mud — as co-founders.\"", sq: "\"One must still have chaos in oneself to be able to give birth to a dancing star.\"", attr: "— Friedrich Nietzsche · 1883" },
];

export default function Voices() {
  return (
    <section id="quotes">
      <div className="q-inner">
        <div className="sl fi">06 · Voices</div>

        <div className="qa-label fi d1">FOUNDERS SAY</div>
        <div className="qa-grid fi d2">
          {QUOTES.map((q) => (
            <div className="qcard" key={q.name}>
              <span className="qmark">"</span>
              <StaggeredText text={q.text} as="p" className="qtext" segmentBy="words" delay={26} blur />
              <div className="qauth">
                <div className="q-av" id={q.av}>
                  <img src={`/images/extracted/${q.av}.png`} alt="" style={{ objectPosition: "center top" }} loading="lazy" decoding="async" />
                  <span className="q-av-ph">{q.ph}</span>
                </div>
                <div>
                  <div className="qname">{q.name}</div>
                  <div className="qco">{q.co}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="echo-label fi d3">ECHO <span className="echo-sub">回音</span></div>
        <div className="echo-grid fi d4">
          {SIGNALS.map((s) => (
            <div className="ec" key={s.sig}>
              <div className="ec-hdr"><span className="ec-sig">{s.sig}</span><span className="ec-tag">{s.tag}</span></div>
              <div className="ec-code">
                <div className="ec-code-bar">
                  <div className="ec-dot r"></div><div className="ec-dot y"></div><div className="ec-dot gg"></div>
                  <span className="ec-code-title">{s.title}</span>
                </div>
                <div className="ec-code-inner">
                  <div className="ec-code-prompt">$ thesis.emit("{s.emit}")</div>
                  <p className="ec-code-q">{s.q}</p>
                </div>
                <div className="ec-code-foot">// creekstone<span className="ec-cur"></span></div>
              </div>
              <div className="ec-scroll">
                <p className="ec-scroll-q">{s.sq}</p>
                <div className="ec-scroll-attr">{s.attr}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

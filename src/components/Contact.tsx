import { lazy, Suspense, useState } from "react";
import StaggeredText from "@/components/react-bits/staggered-text";

const SilkWaves = lazy(() => import("@/components/react-bits/silk-waves"));

const EMAIL = "claw@creekstonevc.com";

export default function Contact() {
  const [value, setValue] = useState("");
  const [placeholder, setPlaceholder] = useState("Tell us what you're building...");
  const [sent, setSent] = useState(false);

  const sendTerm = () => {
    const v = value.trim();
    if (!v) return;
    window.location.href = `mailto:${EMAIL}?subject=Founder Inquiry&body=${encodeURIComponent(v)}`;
    setSent(true);
    setValue("");
    setPlaceholder("Opening your email client...");
  };

  return (
    <section id="contact">
      <div className="contact-bg">
        <Suspense fallback={null}>
        <SilkWaves
          speed={0.45}
          scale={2.2}
          opacity={0.3}
          brightness={0.85}
          colors={["#060606", "#0c0a05", "#191307", "#2a1f0c", "#3c2d10", "#5a4009", "#8b6914", "#c9a84c"]}
        />
        </Suspense>
      </div>
      <div className="ct-inner">
        <div>
          <div className="sl fi">08 · Contact</div>
          <h2 className="ct-h2 fi d1">Get in<br /><span className="gg">Touch.</span></h2>
          <div className="ct-motto fi d2">
            <StaggeredText text="We respond fast. We decide faster." as="span" segmentBy="words" delay={90} blur />
          </div>
          <p className="ct-sub fi d3">
            If you're building something that didn't exist before, skip the deck and
            tell us what you're building. We're always open to the next native variable.
          </p>
          <div className="clinks fi d4">
            <a href={`mailto:${EMAIL}`} className="clink">
              <span className="cl-ico">@</span><span className="cl-txt">{EMAIL}</span>
            </a>
            <a href="https://www.xiaoyuzhoufm.com/podcast/69be621998de88d406855f6e" target="_blank" rel="noreferrer" className="clink">
              <span className="cl-ico">▶</span><span className="cl-txt">Throw a Stone 投石问溪 — 小宇宙</span>
            </a>
            <a href="https://xhslink.com/m/4I9vVzP12DE" target="_blank" rel="noreferrer" className="clink">
              <span className="cl-ico">◆</span><span className="cl-txt">小红书 — Creekstone</span>
            </a>
            <a href="#" className="clink" style={{ cursor: "default" }}>
              <span className="cl-ico">◉</span><span className="cl-txt">WeChat Official Account — Creekstone</span>
            </a>
          </div>
        </div>
        <div className="fi d3">
          <div className="terminal">
            <div className="t-bar">
              <div className="t-dot r"></div><div className="t-dot y"></div><div className="t-dot g"></div>
              <span className="t-title">creekstone-agent — connect@nexus-i</span>
            </div>
            <div className="t-body">
              <div><span className="t-pr">creekstone</span><span className="t-at">@</span><span className="t-ho">nexus</span><span style={{ color: "var(--tx4)" }}>:~$ </span><span className="t-cmd">./connect --mode founder</span></div>
              <div className="t-out">Initializing Creekstone Agent...</div>
              <div className="t-out">▸ Loading investment thesis          ✓</div>
              <div className="t-out">▸ Authenticating founder profile     ✓</div>
              <div className="t-out ok">✓ Ready. We're listening.</div>
              <div style={{ marginTop: 10 }}><span className="t-pr">creekstone</span><span className="t-at">@</span><span className="t-ho">nexus</span><span style={{ color: "var(--tx4)" }}>:~$ </span><span className="t-cmd">query --fund nexus-i --status open</span></div>
              <div className="t-out">Fund         : Nexus Fund I</div>
              <div className="t-out">Stage        : Pre-Seed → Seed</div>
              <div className="t-out">Focus        : Agent OS · Vertical Agents</div>
              <div className="t-out">Geography    : China → Global</div>
              <div className="t-out ok">Status       : ACTIVE — Currently investing</div>
              {sent && <div className="t-out ok">✓ Opening email client — {EMAIL}</div>}
              <div style={{ marginTop: 10 }}><span className="t-pr">creekstone</span><span className="t-at">@</span><span className="t-ho">nexus</span><span style={{ color: "var(--tx4)" }}>:~$ </span><span className="t-cur"></span></div>
            </div>
            <div className="t-form">
              <span className="t-fp">founder@startup:~$ </span>
              <input
                className="t-in"
                type="text"
                placeholder={placeholder}
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendTerm(); }}
              />
              <button className="t-snd" onClick={sendTerm}>SEND →</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

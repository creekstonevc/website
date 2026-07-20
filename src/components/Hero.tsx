import { useEffect, useState } from "react";
import HeroCanvas from "./HeroCanvas";

const PHRASES = [
  "scanning 200+ signals / week",
  "pattern: ai-native, post-1995",
  "native variable: detected",
  "running: founder_match.exec()",
  "agents will eat software",
  "thesis: 100% agent-native",
  "portfolio: self-evolving",
  "output: conviction = true",
  "next bet: initializing...",
  "china → global: confirmed",
];

function Typewriter() {
  const [text, setText] = useState("");
  useEffect(() => {
    let pi = 0, ci = 0, fwd = true, timer = 0;
    const tick = () => {
      const p = PHRASES[pi];
      if (fwd) {
        if (ci < p.length) { setText(p.slice(0, ++ci)); timer = window.setTimeout(tick, 48 + Math.random() * 28); }
        else { fwd = false; timer = window.setTimeout(tick, 1600); }
      } else {
        if (ci > 0) { setText(p.slice(0, --ci)); timer = window.setTimeout(tick, 24); }
        else { fwd = true; pi = (pi + 1) % PHRASES.length; timer = window.setTimeout(tick, 280); }
      }
    };
    timer = window.setTimeout(tick, 1300);
    return () => window.clearTimeout(timer);
  }, []);
  return <span className="ht-t">{text}</span>;
}

export default function Hero() {
  return (
    <section id="hero">
      <HeroCanvas />
      <div className="hero-grid"></div>
      <div className="hero-c">
        <div className="hero-brand-stack">
          <div className="hero-logo-wrap">
            <img className="hero-logo" src="/images/extracted/nav.png" alt="Creekstone" />
          </div>
          <div className="hero-brand-txt">
            <div className="hero-brandname">Creekstone Ventures</div>
            <div className="hero-brand-sub">// Not a fund. A genesis caller.</div>
          </div>
        </div>
        <div className="hero-text">
          <div className="hero-we"><div className="hw-line"></div><span className="hw-inner">WE</span><div className="hw-line"></div></div>
          <span className="hero-word hw1 gg">CREATE</span>
          <div className="hero-gap"></div>
          <div className="hero-we hero-we2"><div className="hw-line"></div><span className="hw-inner">WE</span><div className="hw-line"></div></div>
          <span className="hero-word hw2 gg">SPARK</span>
        </div>
        <p className="hero-tag">Building China's Founders Fund</p>
        <div className="hero-term">
          <span className="ht-p">&gt;&nbsp;</span><Typewriter /><span className="ht-c">█</span>
        </div>
        <div className="hero-cta">
          <a href="#portfolio" className="btn btn-g"><span>Portfolio →</span></a>
          <a href="#perspectives" className="btn btn-o"><span>Our Perspective</span></a>
        </div>
      </div>
      <div className="hero-scroll"><div className="hs-bar"></div><span className="hs-txt">Scroll</span></div>
    </section>
  );
}

const COMPANIES = [
  { href: "https://www.youware.com/", logo: "logo-youware", name: "Youware", cat: "AI Creative Platform", desc: "AI-powered fashion & creative platform. One of the fastest-growing AI consumer companies from China.", stage: "Seed → Series A", founder: "Leon Ming", d: "" },
  { href: "https://www.odyss.life/", logo: "logo-odysslife", name: "Odysslife", cat: "Supply Chain Intelligence", desc: "Next-gen AI-powered supply chain platform. Deep tech meets global operations excellence.", stage: "Seed → Pre-A++", founder: "Chris Pan", d: "d1" },
  { href: "#", logo: "logo-kaleidoscope", name: "Kaleidoscope", cat: "Immersive AI Experience", desc: "Redefining human-intelligence interaction through immersive AI platforms.", stage: "Seed → Series A", founder: "Qiuqiu", d: "d2" },
  { href: "https://www.verdent.ai/", logo: "logo-verdent", name: "Verdent", cat: "Agent-Native IDE", desc: "The development environment built natively for the agent era. Code with intelligence.", stage: "Seed → Pre-A+", founder: "Zhijie", d: "d3" },
  { href: "https://mizzen.top/", logo: "logo-mizzen", name: "Mizzen AI", cat: "Enterprise Intelligence", desc: "Connecting frontier AI capability with real enterprise transformation outcomes.", stage: "Seed → Pre-A", founder: "Keqiang", d: "" },
  { href: "https://memu.pro/", logo: "logo-memu", name: "Mem-U", cat: "Memory-Augmented AI", desc: "Building the persistent memory layer for AI agents and human-AI collaboration.", stage: "Seed → Pre-A", founder: "Peter Chen", d: "d1" },
  { href: "https://xmax.ai/", logo: "logo-xmax", name: "Xmax", cat: "Productivity Suite", desc: "Next-generation productivity infrastructure rebuilt for the distributed AI era.", stage: "Seed → Pre-A+", founder: "Jiaxin", d: "d2" },
  { href: "https://app.karpo.ai/", logo: "logo-machinepulse", name: "Machine Pulse", cat: "Operational Intelligence", desc: "Turning machine data into strategic decisions in real time. AI at the operational layer.", stage: "Seed → Pre-A", founder: "Leah Wang", d: "d3" },
  { href: "https://www.recursive.com/", logo: "logo-rsi", name: "RSI", cat: "Frontier AI Research", desc: "Recursive self-improvement architectures at the frontier of AGI research.", stage: "Strategic", founder: "Yuandong Tian", d: "" },
  { href: "https://www.airjelly.ai/", logo: "logo-airjelly", name: "AirJelly", cat: "AI-Native Productivity", desc: "Always watching, always learning. AI that lives on your desktop and remembers everything.", stage: "Portfolio · Active", founder: "Baite Huang", d: "d1" },
];

export default function Portfolio() {
  return (
    <section id="portfolio">
      <div className="port-inner">
        <div className="sl fi">05 · Portfolio</div>
        <div className="port-grid">
          {COMPANIES.map((c) => (
            <a href={c.href} target="_blank" rel="noreferrer" className={`pc fi ${c.d}`} key={c.name}>
              <span className="pc-arr">↗</span>
              <div className="pc-logo" id={c.logo}>
                <img src={`/images/extracted/${c.logo}.png`} alt={c.name.toLowerCase()} loading="lazy" decoding="async" />
              </div>
              <div className="pc-name">{c.name}</div>
              <div className="pc-cat">{c.cat}</div>
              <div className="pc-desc">{c.desc}</div>
              <div className="pc-stage">{c.stage}</div>
              <div className="pc-founder">{c.founder}</div>
            </a>
          ))}
          <div className="port-fill fi d2"><div className="pf-i"><div className="pf-n">MORE</div><div className="pf-p">+</div></div></div>
          <div className="port-fill fi d3"></div>
        </div>
        <div className="port-note fi d4">
          <span className="pn-i">// NOTE</span>
          <p className="pn-t">Portfolio links open as companies launch publicly. Descriptions reflect current positioning and are subject to update.</p>
        </div>
      </div>
    </section>
  );
}

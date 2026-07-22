const TEAM = [
  {
    id: "tavtr-lz", img: "tavtr-lz.jpg", initials: "LZ", name: "Luhuan Zhong", role: "Investor", d: "",
    bio: [
      "8-year VC veteran with full-cycle investment experience spanning angel to IPO. Deep roots in China's startup ecosystem — known for finding the most ambitious founders before the market does.",
      "Directly involved in helping founders raise $150M+ across the past decade. Founders describe her support as \"co-founder level\" — quick to decide, relentless in execution.",
    ],
  },
  {
    id: "tavtr-yl", img: "tavtr-yl.jpg", initials: "YL", name: "Yihao Li", role: "Investor", d: "d1",
    bio: [
      "Former founder and active operator deeply embedded in China's entrepreneurial circles. Brings builder intuition to every investment — understands the founding journey from the inside.",
      "Specializes in product discovery, growth strategy, and long-term founder partnerships. Known for spotting company-market fit signals before they're obvious to anyone else.",
    ],
  },
  {
    id: "tavtr-gz", img: "tavtr-gz.jpg", initials: "GZ", name: "Gary Zhang", role: "Investor", d: "d2",
    bio: [
      "Drives the intelligence and research layer at Creekstone. Focused on signal detection, founder sourcing, and the analytical infrastructure that keeps us at the frontier of AI investment intelligence.",
      "Builder of Creekstone's proprietary sourcing system and automated research platform. The best investments are found before anyone else is looking.",
    ],
  },
];

export default function Team() {
  return (
    <section id="team">
      <div className="tm-inner">
        <div className="sl fi">08 · Team</div>
        <div className="tm-grid">
          {TEAM.map((m) => (
            <div className={`tcard fi ${m.d}`} key={m.id}>
              <span className="tc-htag">HOVER</span>
              <div className="tc-hdr">
                <div className="tavtr" id={m.id}>
                  <img src={`/images/extracted/${m.img}`} className="loaded" alt="" loading="lazy" decoding="async" />
                  <span className="tavtr-i">{m.initials}</span>
                </div>
                <div className="tname">{m.name}</div>
                <div className="trole">{m.role}</div>
                <div className="tdiv"></div>
              </div>
              <div className="tbio">
                {m.bio.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

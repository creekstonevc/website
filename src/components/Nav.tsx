import { useEffect, useState } from "react";

const LINKS = [
  ["/agent/", "Agent"],
  ["#manifesto", "Manifesto"],
  ["#thesis", "Thesis"],
  ["#portfolio", "Portfolio"],
  ["#quotes", "Voices"],
  ["#perspectives", "Perspectives"],
  ["#team", "Team"],
  ["#contact", "Contact"],
];

export default function Nav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 60);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <nav className={solid ? "solid" : ""}>
      <a href="#hero" className="nl">
        <img src="/images/extracted/nav.png" alt="Creekstone" />
        <span>Creekstone Ventures</span>
      </a>
      <ul className="nr">
        {LINKS.map(([href, label]) => (
          <li key={href}>
            <a href={href}>{label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

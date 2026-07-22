import AgentChat from "./components/AgentChat";
import { useFadeIn } from "./hooks/useFadeIn";

export default function AgentPage() {
  useFadeIn();
  return (
    <div className="agp">
      <nav className="solid agp-nav">
        <a href="/" className="nl">
          <img src="/images/extracted/nav.png" alt="Creekstone" />
          <span>Creekstone Ventures</span>
        </a>
        <a href="/" className="agp-back">← Back to site</a>
      </nav>
      <AgentChat standalone />
    </div>
  );
}

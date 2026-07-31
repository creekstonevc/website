import Image from "next/image";

const agentPrompts = [
  "Pitch it.",
  "Question it.",
  "Challenge it.",
] as const;

export function AgentTeaser() {
  return (
    <section
      id="ai-vc-agent"
      className="agent-flagship transition-section chapter-panel"
      data-chapter="Agent Runtime"
      aria-labelledby="agent-flagship-title"
    >
      <span
        id="thesis"
        className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
        aria-hidden="true"
      />
      <div className="agent-curtains" aria-hidden="true">
        <span className="agent-curtain agent-curtain-top" />
        <span className="agent-curtain agent-curtain-bottom" />
      </div>

      <div className="agent-field" aria-hidden="true">
        <span className="agent-field-axis agent-field-axis-a" />
        <span className="agent-field-axis agent-field-axis-b" />
        <span className="agent-field-node agent-field-node-a" />
        <span className="agent-field-node agent-field-node-b" />
        <span className="agent-field-coordinate">CRK / INTELLIGENCE NODE 001</span>
      </div>

      <div className="agent-index" aria-hidden="true">
        <span>Creekstone / Agent Runtime</span>
        <span>Signal locked · 001</span>
      </div>

      <div className="agent-stage">
        <div className="agent-copy">
          <h2 id="agent-flagship-title" className="agent-title">
            <span className="agent-title-mask">
              <span className="agent-title-line">World&apos;s First</span>
            </span>
            <span className="agent-title-mask">
              <span className="agent-title-line agent-title-line-gold">
                AI VC
              </span>
            </span>
            <span className="agent-title-mask agent-title-mask-last">
              <span className="agent-title-line">
                Agent.
              </span>
            </span>
          </h2>

          <p className="agent-intro">
            Yihao&apos;s AI avatar — trained on how we think, invest, and
            co-build.
          </p>

        </div>

        <div className="agent-core" aria-hidden="true">
          <span className="agent-core-ring agent-core-ring-a" />
          <span className="agent-core-ring agent-core-ring-b" />
          <span className="agent-core-cross agent-core-cross-x" />
          <span className="agent-core-cross agent-core-cross-y" />
          <span className="agent-core-label">Live model / founder signal</span>
        </div>

        <figure className="agent-portrait-shell">
          <span className="agent-file-tab" aria-hidden="true">
            Identity / 001
          </span>
          <div className="agent-portrait-cut">
            <Image
              className="agent-portrait"
              src="/yihao-agent.jpg"
              alt="Yihao Li"
              fill
              sizes="(max-width: 720px) 72vw, 32vw"
              priority
            />
          </div>
          <figcaption className="agent-portrait-meta">
            <span className="agent-online">
              <span aria-hidden="true" />
              Agent online
            </span>
            <strong>Yihao Li</strong>
            <small>Investor · AI Avatar</small>
          </figcaption>
          <span className="agent-portrait-registration" aria-hidden="true">
            YH.AI / 001
          </span>
        </figure>

        <div className="agent-console">
          <div className="agent-console-bar">
            <span className="agent-console-status">
              <span aria-hidden="true" />
              Creekstone / live
            </span>
            <span>Encrypted founder channel</span>
          </div>

          <div className="agent-console-body">
            <div className="agent-transcript">
              <span className="agent-transcript-role">YIHAO.AI</span>
              <p>
                全球第一个 AI 风险投资人，在线。
                <br />
                Tell me what you&apos;re building.
              </p>
            </div>

            <div className="agent-console-actions">
              <div className="agent-verbs" aria-label="Ways to engage the agent">
                {agentPrompts.map((prompt) => (
                  <span key={prompt}>{prompt}</span>
                ))}
              </div>
              <a
                className="agent-enter"
                href="/agent/"
              >
                <span>Enter live agent</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M7 17 17 7M8 7h9v9" />
                </svg>
              </a>
            </div>
          </div>

          <span className="agent-console-scan" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

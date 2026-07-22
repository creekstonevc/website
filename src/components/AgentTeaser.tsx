export default function AgentTeaser() {
  return (
    <section id="agent-teaser">
      <div className="ag-inner">
        <div className="sl fi">02 · Flagship</div>
        <h2 className="ag-h2 fi d1">World's First <span className="gg">AI VC Agent.</span></h2>
        <p className="ag-sub fi d2">
          Yihao's AI avatar — trained on how we think, invest, and co-build.
          Pitch it, question it, challenge it. <span className="ag-sub-cn">全球第一个 AI 风险投资人，在线。</span>
        </p>
        <div className="agt-row fi d3">
          <a href="/agent/" className="agt-card">
            <div className="agt-av">
              <img src="/images/extracted/tavtr-yl.jpg" alt="Yihao Li" />
              <span className="agt-av-dot"></span>
            </div>
            <div className="agt-meta">
              <div className="ag-live"><span className="ag-dot"></span>AGENT ONLINE</div>
              <div className="agt-name">Yihao.AI</div>
              <div className="agt-sub">Ask about thesis, founders, or pitch your build — replies in real time.</div>
            </div>
            <span className="agt-go">CHAT&nbsp;→</span>
          </a>
        </div>
      </div>
    </section>
  );
}

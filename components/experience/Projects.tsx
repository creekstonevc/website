export function Projects() {
  return (
    <section
      id="projects-section"
      className="team-section relative h-[100svh] min-h-[100svh] w-full z-20 overflow-hidden font-space text-white border-t border-white/20 chapter-panel"
      data-chapter="Team"
      style={{ perspective: "1200px" }}
    >
      <span
        id="team"
        className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
        aria-hidden="true"
      />
      <div className="crt-scanlines" aria-hidden="true" />

      <div className="team-chapter-header">
        <h2>
          TEAM
        </h2>
        <p>Select a VC card</p>
      </div>

      <div
        id="game-board"
        className="team-game-board"
      >
        <div
          id="play-slot"
          className="team-deploy-slot"
        >
          <span>
            Deploy
            <br />
            credential
          </span>
        </div>

        <div
          id="card-details"
          className="team-profile-panel"
        >
          <span
            id="detail-tag"
            className="team-profile-role"
          />
          <h3
            id="detail-title"
            className="team-profile-name"
          />
          <p
            id="detail-focus"
            className="team-profile-focus"
          />
          <div className="team-profile-copy">
            <p id="detail-desc" />
            <p id="detail-desc-secondary" />
          </div>

          <div className="hidden" aria-hidden="true">
            <button
              id="check-detail-btn"
              className="verify-chip"
              disabled
              tabIndex={-1}
              type="button"
            >
              <span className="verify-chip-light" />
              <span id="check-detail-label">CHECK</span>
            </button>
          </div>

          <button
            id="return-btn"
            className="team-return-button"
            type="button"
          >
            Return to team
          </button>
        </div>
      </div>

      <div id="detail-glass-overlay" aria-hidden="true" data-archived-detail="true">
        <div className="detail-glass-backdrop" />
        <div className="detail-glass-noise" />
        <div className="detail-scan-beam" id="detail-scan-beam" />
        <div id="detail-pulse-field" />
        <div id="detail-ghost-layer" />
        <div id="detail-grid">
          <div className="detail-panel flex flex-col">
            <div className="detail-label">Narrative Log</div>
            <h3
              id="dg-title"
              className="text-3xl md:text-5xl font-black uppercase leading-none mb-4 drop-shadow-[2px_2px_0px_#fff] text-black"
            />
            <p
              id="dg-story"
              className="text-sm md:text-base leading-relaxed text-gray-200 font-space mb-5"
            />
            <div className="detail-label">Key Highlights</div>
            <ul
              id="dg-highlights"
              className="text-sm leading-relaxed text-gray-200 space-y-2 font-space flex-1"
            />
          </div>
          <div className="flex flex-col gap-4">
            <div className="detail-panel">
              <div className="detail-label">Tech Stack</div>
              <div id="dg-stack" className="flex flex-wrap gap-2" />
            </div>
            <div className="detail-panel flex-1 flex flex-col">
              <div className="detail-label">
                Accomplishments &amp; Milestones
              </div>
              <div
                id="dg-accomplishments"
                className="relative flex-1 min-h-[280px] md:min-h-[350px] mt-4"
              />
            </div>
            <div className="flex justify-start">
              <button id="close-detail-btn" className="cursor-pointer" type="button">
                Close Detail Mode
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

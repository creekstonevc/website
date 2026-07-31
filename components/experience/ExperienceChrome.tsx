import Image from "next/image";
import type { CSSProperties } from "react";

const loaderParticleRings = [
  { name: "inner", count: 11 },
  { name: "middle", count: 15 },
  { name: "outer", count: 19 },
] as const;

export function ExperienceChrome() {
  return (
    <>
      <div
        id="global-bg"
        className="fixed top-0 left-0 w-full h-full"
        style={{ zIndex: -20, backgroundColor: "#f3efe5" }}
      />

      <div
        id="loader"
        role="status"
        aria-live="polite"
        aria-label="Loading Creekstone Ventures"
      >
        <div className="loader-frame" aria-hidden="true">
          <span className="loader-frame-line loader-frame-line-left" />
          <span className="loader-frame-line loader-frame-line-right" />
          <span className="loader-frame-index">CRK / VC</span>
          <span className="loader-frame-status">FOUNDERS&apos; FIELD · OPENING</span>
        </div>

        <div className="loader-content">
          <div className="loader-mark-stage">
            <div className="loader-particle-system" aria-hidden="true">
              {loaderParticleRings.map((ring, ringIndex) => (
                <div
                  className={`loader-particle-ring loader-particle-ring-${ring.name}`}
                  key={ring.name}
                >
                  <div className="loader-particle-track">
                    {Array.from({ length: ring.count }, (_, particleIndex) => (
                      <span
                        className="loader-particle"
                        key={particleIndex}
                        style={
                          {
                            "--particle-angle": `${(particleIndex / ring.count) * 360}deg`,
                            "--particle-delay": `${-(
                              (particleIndex * 0.17 + ringIndex * 0.29) %
                              1.9
                            )}s`,
                            "--particle-size": `${1.5 + ((particleIndex + ringIndex) % 3) * 0.75}px`,
                          } as CSSProperties
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Image
              className="loader-mark loader-mark-echo"
              src="/creekstone-mark.png"
              alt=""
              width={252}
              height={145}
              priority
              aria-hidden="true"
            />
            <Image
              className="loader-mark loader-mark-primary"
              src="/creekstone-mark.png"
              alt=""
              width={252}
              height={145}
              priority
              aria-hidden="true"
            />
          </div>

          <div className="loader-wordmark-clip">
            <div className="loader-wordmark">
              <span className="loader-name">Creekstone</span>
              <span className="loader-company">Ventures</span>
            </div>
          </div>

          <div className="loader-progress" aria-hidden="true">
            <span className="loader-progress-fill" />
          </div>
          <p className="loader-thesis">Building China&apos;s Founders Fund.</p>
        </div>
      </div>

      <div className="noise-overlay" aria-hidden="true" />
      <div className="cursor-dot" id="cursor-dot" aria-hidden="true" />
      <div className="cursor-ring" id="cursor-ring" aria-hidden="true" />

      <aside
        id="chapter-progress"
        className="chapter-progress"
        aria-label="Page chapter progress"
      >
        <div className="chapter-progress-current">
          <span id="chapter-progress-number">01</span>
          <span className="chapter-progress-total">/ 05</span>
        </div>
        <div className="chapter-progress-track" aria-hidden="true">
          <span className="chapter-progress-fill" />
          <span className="chapter-progress-pulse" />
        </div>
        <div className="chapter-progress-copy" aria-live="polite">
          <span id="chapter-progress-label">Origin</span>
          <span className="chapter-progress-next">
            Next / <strong id="chapter-progress-next">Agent Runtime</strong>
          </span>
        </div>
        <div className="chapter-progress-distance" aria-hidden="true">
          <strong id="chapter-progress-percent">000</strong>
          <span>% left</span>
        </div>
      </aside>

      <div id="webgl-container" aria-hidden="true" />
    </>
  );
}

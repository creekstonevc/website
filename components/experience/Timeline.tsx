import Image from "next/image";

import { portfolioCompanies } from "@/lib/content";
import type { PortfolioCompany } from "@/lib/types";

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M6.25 13.75 13.75 6.25M7.5 6.25h6.25V12.5" />
    </svg>
  );
}

function FounderVoice({ company }: { company: PortfolioCompany }) {
  if (!company.voice) return null;

  return (
    <aside
      className="portfolio-founder-voice"
      aria-label={`Voice from ${company.founder}`}
    >
      <span className="portfolio-voice-pin" aria-hidden="true">
        <i />
      </span>
      <span className="portfolio-voice-label">Founder voice</span>
      <blockquote>{company.voice.text}</blockquote>
      <footer>
        <Image
          src={company.voice.avatar}
          alt=""
          width={48}
          height={48}
          sizes="48px"
          unoptimized
        />
        <span>
          <strong>{company.founder}</strong>
          <small>{company.voice.role}</small>
        </span>
      </footer>
    </aside>
  );
}

function PortfolioNode({
  company,
  index,
}: {
  company: PortfolioCompany;
  index: number;
}) {
  const sequence = String(index + 1).padStart(2, "0");
  const position =
    company.side === "bottom"
      ? "translate-y-[18vh] md:translate-y-[22vh]"
      : "-translate-y-[18vh] md:-translate-y-[22vh]";

  return (
    <article
      className={`timeline-node portfolio-node flex-shrink-0 relative w-[82vw] max-w-[780px] md:w-[66vw] lg:w-[58vw] ${company.voice ? "has-founder-voice" : ""} ${position}`}
      data-timeline-index={index}
      data-side={company.side}
      aria-label={`${company.name}, ${company.category}`}
    >
      <div className="portfolio-card-shell">
        <div className="portfolio-card-scan" aria-hidden="true" />

        <header className="portfolio-card-header">
          <span className="portfolio-card-sequence">{sequence} / 10</span>
          <span className="portfolio-card-stage">{company.stage}</span>
          {company.href ? (
            <a
              className="portfolio-card-link"
              href={company.href}
              target="_blank"
              rel="noreferrer"
              aria-label={`Visit ${company.name}`}
            >
              <ExternalLinkIcon />
            </a>
          ) : (
            <span className="portfolio-card-link portfolio-card-link-disabled" aria-hidden="true">
              <ExternalLinkIcon />
            </span>
          )}
        </header>

        <div className="portfolio-card-body">
          <div
            className="portfolio-logo-stage"
            data-surface={company.logoSurface}
            data-company={company.name}
          >
            <span className="portfolio-logo-index" aria-hidden="true">
              CRK / {sequence}
            </span>
            {company.logo ? (
              <Image
                className="portfolio-company-logo"
                src={company.logo}
                alt={`${company.name} logo`}
                width={400}
                height={160}
                sizes="(max-width: 768px) 48vw, 300px"
                unoptimized
              />
            ) : (
              <span className="portfolio-company-wordmark">
                {company.name === "Kaleidoscope" ? (
                  <>
                    Kaleido
                    <br />
                    scope
                  </>
                ) : (
                  company.name.replace(" ", "")
                )}
              </span>
            )}
          </div>

          <div className="portfolio-card-copy">
            <p className="portfolio-card-category">{company.category}</p>
            <h3>{company.name}</h3>
            <p className="portfolio-card-description">{company.description}</p>
          </div>
        </div>

        <footer className="portfolio-card-footer">
          <span>Founder</span>
          <strong>{company.founder}</strong>
          <span className="portfolio-card-status">
            <i aria-hidden="true" />
            Creekstone portfolio
          </span>
        </footer>
      </div>

      <FounderVoice company={company} />

      <div className="portfolio-node-rail" aria-hidden="true">
        <span />
      </div>
    </article>
  );
}

export function Timeline() {
  return (
    <section
      className="portfolio-timeline overflow-hidden relative z-20 will-change-transform chapter-panel"
      id="timeline-container"
      data-chapter="Portfolio"
      aria-label="Creekstone portfolio"
    >
      <span
        id="portfolio"
        className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
        aria-hidden="true"
      />
      <span
        id="quotes"
        className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
        aria-hidden="true"
      />
      <div className="portfolio-counter" aria-hidden="true">
        <div className="portfolio-counter-window" id="portfolio-counter-window">
          <div className="portfolio-counter-reel" id="portfolio-counter-reel">
            {portfolioCompanies.map((_, index) => (
              <span className="portfolio-counter-number" key={index}>
                {index + 1}
              </span>
            ))}
          </div>
        </div>
        <span className="portfolio-counter-caption">Investments / 10</span>
      </div>

      <div className="portfolio-timeline-atmosphere" aria-hidden="true" />
      <div className="portfolio-timeline-axis" aria-hidden="true" />

      <div
        className="flex flex-nowrap items-center h-screen px-[9vw] relative z-10 w-max gap-[13vw] md:gap-[9vw]"
        id="horizontal-wrap"
      >
        <div className="portfolio-timeline-intro flex-shrink-0 w-[72vw] md:w-[48vw]">
          <p>Portfolio</p>
          <h2>
            BUILT WITH
            <br />
            CONVICTION.
          </h2>
          <div className="portfolio-intro-note">
            <span>10 companies</span>
            <span>Agent-native by design</span>
          </div>
        </div>

        {portfolioCompanies.map((company, index) => (
          <PortfolioNode company={company} index={index} key={company.name} />
        ))}

        <div className="portfolio-timeline-outro flex-shrink-0 w-[54vw] md:w-[38vw]">
          <span>10 / 10</span>
          <p>Found early.<br />Built together.</p>
        </div>
        <div className="flex-shrink-0 w-[12vw]" aria-hidden="true" />
      </div>
    </section>
  );
}

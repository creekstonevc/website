import Image from "next/image";

export function Hero() {
  return (
    <>
      <section
        id="hero"
        className="hero-section creekstone-hero chapter-panel"
        data-chapter="Origin"
        aria-labelledby="creekstone-hero-title"
      >
        <span
          id="manifesto"
          className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
          aria-hidden="true"
        />
        <div className="creekstone-signal-field" aria-hidden="true">
          <span className="creekstone-signal-axis" />
          <span className="creekstone-signal-horizon creekstone-signal-horizon-left" />
          <span className="creekstone-signal-horizon creekstone-signal-horizon-right" />
          <span className="creekstone-signal-marker creekstone-signal-marker-a" />
          <span className="creekstone-signal-marker creekstone-signal-marker-b" />
          <span className="creekstone-signal-marker creekstone-signal-marker-c" />
          <span className="creekstone-corner creekstone-corner-top-left" />
          <span className="creekstone-corner creekstone-corner-bottom-right" />
        </div>

        <header className="creekstone-hero-header">
          <a
            className="creekstone-hero-brand"
            href="#top"
            aria-label="Creekstone Ventures home"
          >
            <span className="creekstone-hero-brand-mark">
              <Image
                src="/creekstone-mark.png"
                alt=""
                width={252}
                height={145}
                priority
                aria-hidden="true"
              />
            </span>
            <span className="creekstone-hero-brand-copy">
              <strong>Creekstone Ventures</strong>
              <small>Agent Native · Founder Friendly</small>
            </span>
          </a>

          <div className="creekstone-hero-geography">
            <span>China → Global</span>
            <span>Early-stage AI Native</span>
          </div>
        </header>

        <div className="creekstone-hero-center">
          <h1 id="creekstone-hero-title" className="creekstone-hero-title">
            <span className="creekstone-hero-word creekstone-hero-create">
              <span className="creekstone-hero-we">We</span>
              <span>Create</span>
            </span>
            <span className="creekstone-hero-word creekstone-hero-spark">
              <span className="creekstone-hero-we">We</span>
              <span>Spark</span>
            </span>
          </h1>
          <p className="creekstone-hero-tagline">
            Building China&apos;s Founders Fund.
          </p>
        </div>

        <div className="creekstone-hero-footer">
          <div className="creekstone-hero-manifesto">
            <p>
              We don&apos;t bet on <em>experience.</em>
              <br />
              We bet on <em>native variables.</em>
            </p>
            <div className="creekstone-hero-principles" aria-label="Founder principles">
              <span>Young. Ambitious.</span>
              <span>Small Ego.</span>
            </div>
          </div>

          <a className="creekstone-hero-scroll" href="#ai-vc-agent">
            <span>Meet the Agent</span>
            <span className="creekstone-hero-scroll-line" aria-hidden="true" />
            <small>Creekstone&apos;s live intelligence</small>
          </a>
        </div>
      </section>
    </>
  );
}

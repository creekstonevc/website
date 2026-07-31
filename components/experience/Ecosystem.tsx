import { perspectiveItems } from "@/lib/content";

const contactLinks = [
  {
    label: "Email",
    value: "claw@creekstonevc.com",
    href: "mailto:claw@creekstonevc.com",
  },
  {
    label: "Podcast",
    value: "Throw a Stone 投石问溪 / 小宇宙",
    href: "https://www.xiaoyuzhoufm.com/podcast/69be621998de88d406855f6e",
  },
  {
    label: "Xiaohongshu",
    value: "小红书 / Creekstone",
    href: "https://xhslink.com/m/4I9vVzP12DE",
  },
] as const;

export function Ecosystem() {
  const initialPerspective = perspectiveItems[0];

  return (
    <footer
      id="ecosystem-section"
      className="perspectives-contact-section relative z-20 h-[100svh] min-h-[100svh] overflow-hidden chapter-panel"
      data-chapter="Perspectives and Contact"
    >
      <div className="perspectives-contact-stage">
        <header id="perspectives" className="perspective-chapter-head">
          <h2>PERSPECTIVES.</h2>
          <p>Portfolio updates, essays, and conversations from Creekstone.</p>
        </header>

        <div
          id="aw-container"
          className="perspective-node-field"
          aria-label="Creekstone perspectives"
        >
          <div id="aw-wrapper" className="perspective-node-wrapper" />
        </div>

        <div
          id="perspective-preview"
          className="perspective-preview"
          aria-live="polite"
        >
          <span id="perspective-preview-source">
            {initialPerspective.source} / {initialPerspective.category}
          </span>
          <h3 id="perspective-preview-title">{initialPerspective.title}</h3>
        </div>

        <aside id="contact" className="contact-signal-panel">
          <div className="contact-signal-copy">
            <h2>Get in touch.</h2>
            <strong>We respond fast. We decide faster.</strong>
            <p>
              If you&apos;re building something that didn&apos;t exist before,
              skip the deck and tell us what you&apos;re building. We&apos;re
              always open to the next native variable.
            </p>
          </div>

          <form
            id="contact-founder-form"
            className="contact-founder-form"
            action="mailto:claw@creekstonevc.com"
            method="get"
          >
            <label htmlFor="contact-founder-message">
              Tell us what you&apos;re building
            </label>
            <div>
              <input
                id="contact-founder-message"
                name="body"
                type="text"
                autoComplete="off"
                placeholder="Your founder note"
              />
              <button type="submit">Send inquiry</button>
            </div>
            <p id="contact-founder-status" aria-live="polite" />
          </form>

          <nav className="contact-signal-links" aria-label="Creekstone contact links">
            {contactLinks.map((link) => (
              <a
                href={link.href}
                key={link.label}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noreferrer" : undefined}
              >
                <span>{link.label}</span>
                <strong>{link.value}</strong>
              </a>
            ))}
            <span className="contact-signal-static">
              <span>WeChat</span>
              <strong>WeChat Official Account / Creekstone</strong>
            </span>
          </nav>
        </aside>
      </div>

      <div className="creekstone-final-footer">
        <div className="creekstone-final-signature">
          <strong>© 2026 Creekstone Ventures</strong>
          <span>Agent Native / Founder Friendly</span>
          <span>China to Global</span>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#hero">Origin</a>
          <a href="#portfolio">Portfolio</a>
          <a href="#team">Team</a>
          <a href="#contact">Contact</a>
          <a href="#top">Back to origin</a>
        </nav>
      </div>
    </footer>
  );
}

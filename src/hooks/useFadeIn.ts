import { useEffect } from "react";

/**
 * Replicates the original site's scroll-reveal: every `.fi` element gets `.v`
 * when it enters the viewport, with timed fallbacks so nothing stays hidden.
 */
export function useFadeIn() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".fi"));
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("v");
        });
      },
      { threshold: 0, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => obs.observe(el));
    const showAll = () => els.forEach((el) => el.classList.add("v"));
    const t1 = window.setTimeout(showAll, 800);
    window.addEventListener("load", () => window.setTimeout(showAll, 400));
    return () => {
      obs.disconnect();
      window.clearTimeout(t1);
    };
  }, []);
}

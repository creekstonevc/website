"use client";

import { useEffect } from "react";
import { perspectiveItems, projects, teamMembers } from "@/lib/content";

type ExperienceWindow = Window &
  typeof globalThis & {
    gsap?: unknown;
    ScrollTrigger?: unknown;
    THREE?: unknown;
    Lenis?: unknown;
    __PORTFOLIO_DATA__?: typeof projects;
    __TEAM_DATA__?: typeof teamMembers;
    __PERSPECTIVES_DATA__?: typeof perspectiveItems;
    __CREEKSTONE_RUNTIME_STARTED__?: boolean;
    __CREEKSTONE_RUNTIME_LOADING__?: boolean;
  };

export function RuntimeLoader() {
  useEffect(() => {
    const experienceWindow = window as ExperienceWindow;
    if (
      experienceWindow.__CREEKSTONE_RUNTIME_STARTED__ ||
      experienceWindow.__CREEKSTONE_RUNTIME_LOADING__
    ) {
      return;
    }

    experienceWindow.__CREEKSTONE_RUNTIME_LOADING__ = true;

    void Promise.all([
      import("gsap"),
      import("gsap/ScrollTrigger"),
      import("three"),
      import("@studio-freight/lenis"),
    ])
      .then(([gsapModule, scrollTriggerModule, threeModule, lenisModule]) => {
        experienceWindow.gsap = gsapModule.gsap;
        experienceWindow.ScrollTrigger = scrollTriggerModule.ScrollTrigger;
        experienceWindow.THREE = threeModule;
        experienceWindow.Lenis = lenisModule.default;
        experienceWindow.__PORTFOLIO_DATA__ = projects;
        experienceWindow.__TEAM_DATA__ = teamMembers;
        experienceWindow.__PERSPECTIVES_DATA__ = perspectiveItems;

        if (!document.querySelector('script[data-portfolio-runtime="true"]')) {
          const script = document.createElement("script");
          script.src = "/portfolio-runtime.js?v=20260731-mobile-polish";
          script.async = true;
          script.dataset.portfolioRuntime = "true";
          script.onload = () => {
            experienceWindow.__CREEKSTONE_RUNTIME_LOADING__ = false;
          };
          script.onerror = () => {
            experienceWindow.__CREEKSTONE_RUNTIME_LOADING__ = false;
          };
          document.body.appendChild(script);
        }
      })
      .catch(() => {
        experienceWindow.__CREEKSTONE_RUNTIME_LOADING__ = false;
      });
  }, []);

  return null;
}

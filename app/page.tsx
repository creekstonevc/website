import { AgentTeaser } from "@/components/experience/AgentTeaser";
import { Ecosystem } from "@/components/experience/Ecosystem";
import { ExperienceChrome } from "@/components/experience/ExperienceChrome";
import { Hero } from "@/components/experience/Hero";
import { Projects } from "@/components/experience/Projects";
import { RuntimeLoader } from "@/components/experience/RuntimeLoader";
import { Timeline } from "@/components/experience/Timeline";

export default function Home() {
  return (
    <>
      <ExperienceChrome />
      <main id="top" className="relative z-10">
        <Hero />
        <AgentTeaser />
        <Timeline />
        <Projects />
        <Ecosystem />
      </main>
      <RuntimeLoader />
    </>
  );
}

import Nav from "./components/Nav";
import Hero from "./components/Hero";
import AgentTeaser from "./components/AgentTeaser";
import Manifesto from "./components/Manifesto";
import Thesis from "./components/Thesis";
import Portfolio from "./components/Portfolio";
import Voices from "./components/Voices";
import Perspectives from "./components/Perspectives";
import Team from "./components/Team";
import Contact from "./components/Contact";
import Footer from "./components/Footer";
import { useFadeIn } from "./hooks/useFadeIn";

export default function App() {
  useFadeIn();
  return (
    <>
      <Nav />
      <Hero />
      <AgentTeaser />
      <Manifesto />
      <Thesis />
      <Portfolio />
      <Voices />
      <Perspectives />
      <Team />
      <Contact />
      <Footer />
    </>
  );
}

import { useEffect } from 'react'
import Lenis from 'lenis'
import { gsap, ScrollTrigger } from './hooks/useGsap'

import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Marquee from './components/Marquee'
import Stats from './components/Stats'
import InvestmentFocus from './components/InvestmentFocus'
import Team from './components/Team'
import Portfolio from './components/Portfolio'
import CoInvestors from './components/CoInvestors'
import MemuDetail from './components/MemuDetail'
import Contact from './components/Contact'
import Footer from './components/Footer'

export default function App() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    lenis.on('scroll', ScrollTrigger.update)

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000)
    })
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(lenis.raf)
      lenis.destroy()
    }
  }, [])

  return (
    <>
      <div className="grain" />
      <Navbar />
      <Hero />
      <Marquee />
      <Stats />
      <InvestmentFocus />
      <Marquee text="AI Innovation • Visionary Founders • Seed to Series A •" />
      <Team />
      <Portfolio />
      <CoInvestors />
      <MemuDetail />
      <Contact />
      <Footer />
    </>
  )
}

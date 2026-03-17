import { useEffect, useRef } from 'react'
import { coinvestorLogos } from '../data/portfolio'
import { gsap } from '../hooks/useGsap'
import './CoInvestors.css'

export default function CoInvestors() {
  const section = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.coinv__header .reveal', { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, stagger: 0.1, ease: 'power3.out', scrollTrigger: { trigger: section.current, start: 'top 75%', once: true } })
      gsap.fromTo('.coinv__item', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 1, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: '.coinv__logos', start: 'top 85%', once: true } })
    }, section)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={section} className="coinv">
      <div className="coinv__header">
        <span className="section-label reveal">Co-investors</span>
        <h2 className="section-heading reveal">
          We invest alongside<br /><em>world-class</em> partners
        </h2>
      </div>

      <div className="coinv__logos">
        {coinvestorLogos.map((src, i) => (
          <div className="coinv__item" key={i}>
            <img src={src} alt="Co-investor" loading="lazy" />
          </div>
        ))}
      </div>
    </section>
  )
}

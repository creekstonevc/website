import { useEffect, useRef } from 'react'
import { focusAreas } from '../data/stats'
import { gsap } from '../hooks/useGsap'
import './InvestmentFocus.css'

function Ring({ pct, delay }) {
  const circle = useRef(null)
  const numVal = parseInt(pct)
  const circumference = 2 * Math.PI * 54

  useEffect(() => {
    const el = circle.current
    if (!el) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { strokeDashoffset: circumference },
        {
          strokeDashoffset: circumference - (circumference * numVal) / 100,
          duration: 2,
          delay,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        },
      )
    })
    return () => ctx.revert()
  }, [circumference, numVal, delay])

  return (
    <svg className="focus__ring" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="54" className="focus__ring-bg" />
      <circle
        ref={circle}
        cx="60"
        cy="60"
        r="54"
        className="focus__ring-fill"
        strokeDasharray={circumference}
        strokeDashoffset={circumference}
      />
    </svg>
  )
}

export default function InvestmentFocus() {
  const section = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.focus__card',
        { y: 80, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1.2,
          stagger: 0.12,
          ease: 'power3.out',
          scrollTrigger: { trigger: section.current, start: 'top 70%', once: true },
        },
      )
    }, section)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={section} className="focus">
      <div className="focus__header reveal">
        <span className="section-label">Strategy</span>
        <h2 className="section-heading">
          Betting on the Chinese<br />
          <em>AI Application</em> Boom
        </h2>
      </div>

      <div className="focus__grid">
        {focusAreas.map((area, i) => (
          <div className="focus__card" key={area.title}>
            <div className="focus__ring-wrap">
              <Ring pct={area.percentage} delay={i * 0.1} />
              <span className="focus__pct">{area.percentage}</span>
            </div>
            <h3 className="focus__title">{area.title}</h3>
          </div>
        ))}
      </div>
    </section>
  )
}

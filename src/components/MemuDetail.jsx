import { useEffect, useRef } from 'react'
import { memuData } from '../data/memu'
import { gsap } from '../hooks/useGsap'
import './MemuDetail.css'

export default function MemuDetail() {
  const section = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.memu .reveal',
        { y: 60, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.2, stagger: 0.1, ease: 'power3.out', scrollTrigger: { trigger: section.current, start: 'top 70%', once: true } },
      )
    }, section)
    return () => ctx.revert()
  }, [])

  return (
    <section id="memu-detail" ref={section} className="memu">
      <div className="memu__layout">
        <div className="memu__left">
          <span className="section-label reveal">Featured</span>
          <div className="memu__brand reveal">
            <img src={memuData.logo} alt="MEMU" loading="lazy" className="memu__logo" />
            <div>
              <h2 className="memu__name">{memuData.name}</h2>
              <p className="memu__tagline">{memuData.tagline}</p>
            </div>
          </div>

          <div className="memu__stats reveal">
            {memuData.metrics.map((m) => (
              <div className="memu__stat" key={m.label}>
                <span className="memu__stat-val">{m.value}</span>
                <span className="memu__stat-lbl">{m.label}</span>
              </div>
            ))}
          </div>

          <div className="memu__cta reveal">
            <a href={memuData.website} target="_blank" rel="noopener noreferrer" className="btn-outline">
              Visit Website &rarr;
            </a>
          </div>
        </div>

        <div className="memu__right">
          <div className="memu__block reveal">
            <h4>About</h4>
            <p>{memuData.about}</p>
          </div>

          <div className="memu__block reveal">
            <h4>Key Features</h4>
            <ul>
              {memuData.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>

          <div className="memu__block reveal">
            <h4>Founder</h4>
            <p>
              <strong>{memuData.founder.name}</strong> — {memuData.founder.bio}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

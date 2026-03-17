import { useEffect, useRef } from 'react'
import { team } from '../data/team'
import { gsap } from '../hooks/useGsap'
import './Team.css'

export default function Team() {
  const section = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.team__header .reveal',
        { y: 60, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.2, stagger: 0.1, ease: 'power3.out', scrollTrigger: { trigger: section.current, start: 'top 75%', once: true } },
      )

      gsap.fromTo(
        '.team__card',
        { y: 100, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.4, stagger: 0.2, ease: 'power3.out', scrollTrigger: { trigger: '.team__grid', start: 'top 80%', once: true } },
      )

      gsap.fromTo(
        '.team__img-wrap img',
        { scale: 1.3 },
        { scale: 1, duration: 1.8, stagger: 0.2, ease: 'power2.out', scrollTrigger: { trigger: '.team__grid', start: 'top 80%', once: true } },
      )
    }, section)
    return () => ctx.revert()
  }, [])

  return (
    <section id="team" ref={section} className="team">
      <div className="team__header">
        <span className="section-label reveal">Leadership</span>
        <h2 className="section-heading reveal">
          Experienced investors with deep<br />
          <em>AI ecosystem</em> connections
        </h2>
      </div>

      <div className="team__grid">
        {team.map((m) => (
          <div className="team__card" key={m.name}>
            <div className="team__img-wrap">
              <img src={m.image} alt={m.name} loading="lazy" />
            </div>
            <div className="team__info">
              <span className="team__role">{m.role}</span>
              <h3 className="team__name">{m.name}</h3>
              <p className="team__bio">{m.bio}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

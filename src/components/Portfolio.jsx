import { useEffect, useRef, useCallback } from 'react'
import { portfolio } from '../data/portfolio'
import { gsap } from '../hooks/useGsap'
import './Portfolio.css'

function Card({ item }) {
  const card = useRef(null)

  const handleMove = useCallback((e) => {
    const el = card.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    el.style.transform = `perspective(800px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg)`
  }, [])

  const handleLeave = useCallback(() => {
    const el = card.current
    if (!el) return
    el.style.transform = ''
  }, [])

  const handleClick = () => {
    if (item.link) document.querySelector(item.link)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div
      ref={card}
      className={`port__card ${item.link ? 'port__card--link' : ''}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={item.link ? handleClick : undefined}
    >
      <div className="port__card-inner">
        <div className="port__top">
          <div className="port__name-block">
            {item.logo && <img src={item.logo} alt="" className="port__logo" loading="lazy" />}
            <div>
              <h3 className="port__name">{item.name}</h3>
              <p className="port__founder">{item.founder}</p>
            </div>
          </div>
          <div className="port__metrics">
            <div className="port__metric">
              <span className="port__metric-val">{item.moic}</span>
              <span className="port__metric-lbl">MOIC</span>
            </div>
            <div className="port__metric">
              <span className="port__metric-val">{item.irrValue}</span>
              <span className="port__metric-lbl">{item.irrLabel}</span>
            </div>
          </div>
        </div>
        <div className="port__divider" />
        <p className="port__quote">{item.quote}</p>
      </div>
    </div>
  )
}

export default function Portfolio() {
  const section = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.port__header .reveal', { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, stagger: 0.1, ease: 'power3.out', scrollTrigger: { trigger: section.current, start: 'top 75%', once: true } })
      gsap.fromTo('.port__card', { y: 100, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, stagger: 0.1, ease: 'power3.out', scrollTrigger: { trigger: '.port__grid', start: 'top 85%', once: true } })
    }, section)
    return () => ctx.revert()
  }, [])

  return (
    <section id="portfolio" ref={section} className="port">
      <div className="port__header">
        <span className="section-label reveal">Portfolio</span>
        <h2 className="section-heading reveal">
          Partnering with exceptional1<br />
          founders from <em>day one</em>
        </h2>
      </div>

      <div className="port__grid">
        {portfolio.map((item) => (
          <Card key={item.name} item={item} />
        ))}
      </div>
    </section>
  )
}

import { useEffect, useRef } from 'react'
import { gsap } from '../hooks/useGsap'
import './Hero.css'

export default function Hero() {
  const hero = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

      tl.fromTo('.hero__label', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 1, delay: 0.3 })
        .fromTo('.hero__title .word', { y: '110%', rotateX: -30 }, { y: '0%', rotateX: 0, duration: 1.4, stagger: 0.08 }, '-=0.6')
        .fromTo('.hero__sub', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 1 }, '-=0.8')
        .fromTo('.hero__cta', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 1 }, '-=0.6')
        .fromTo('.hero__scroll', { opacity: 0 }, { opacity: 1, duration: 1 }, '-=0.4')

      gsap.to('.hero__bg', {
        yPercent: 15,
        ease: 'none',
        scrollTrigger: { trigger: hero.current, start: 'top top', end: 'bottom top', scrub: 0.5 },
      })

      gsap.to('.hero__overlay', {
        opacity: 0.8,
        scrollTrigger: { trigger: hero.current, start: 'top top', end: 'bottom top', scrub: 0.5 },
      })
    }, hero)

    return () => ctx.revert()
  }, [])

  const words = 'Creekstone Nexus Fund I'.split(' ')

  return (
    <section ref={hero} className="hero">
      <div className="hero__bg-wrap">
        <div className="hero__bg" />
        <div className="hero__overlay" />
      </div>

      <div className="hero__content">
        <span className="hero__label">We Creates &bull; We Spark</span>

        <h1 className="hero__title">
          {words.map((w, i) => (
            <span className="word-wrap" key={i}>
              <span className="word">{w}</span>
            </span>
          ))}
        </h1>

        <p className="hero__sub">
          Building China&apos;s Founders Fund — Investing in disruptive AI
          innovation and young visionary founders reshaping the future.
        </p>

        <a href="#about" className="btn-primary hero__cta" onClick={(e) => { e.preventDefault(); document.querySelector('#about')?.scrollIntoView({ behavior: 'smooth' }) }}>
          <span className="btn-fill" />
          <span>Explore the Fund</span>
          <span>&rarr;</span>
        </a>
      </div>

      <div className="hero__scroll">
        <div className="hero__scroll-line" />
        <span>Scroll</span>
      </div>
    </section>
  )
}

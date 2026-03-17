import { useEffect, useRef } from 'react'
import { gsap } from '../hooks/useGsap'
import './Contact.css'

export default function Contact() {
  const section = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.contact .reveal',
        { y: 80, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.4, stagger: 0.12, ease: 'power3.out', scrollTrigger: { trigger: section.current, start: 'top 70%', once: true } },
      )
    }, section)
    return () => ctx.revert()
  }, [])

  return (
    <section id="contact" ref={section} className="contact">
      <div className="contact__inner">
        <span className="section-label reveal">Connect</span>
        <h2 className="contact__heading reveal">
          Interested in<br />Creekstone Nexus Fund&nbsp;I?
        </h2>
        <p className="contact__desc reveal">
          We&apos;re always looking to connect with exceptional founders and forward-thinking investors.
        </p>
        <div className="reveal">
          <a href="mailto:contact@creekstone.vc" className="btn-primary">
            <span className="btn-fill" />
            <span>Get in Touch</span>
            <span>&rarr;</span>
          </a>
        </div>
      </div>
    </section>
  )
}

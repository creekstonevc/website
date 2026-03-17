import { useEffect, useRef } from 'react'
import { gsap } from '../hooks/useGsap'
import './Navbar.css'

const links = [
  { href: '#about', label: 'About' },
  { href: '#team', label: 'Teams' },
  { href: '#portfolio', label: 'Portfolio' },
  { href: '#contact', label: 'Contact' },
]

export default function Navbar() {
  const nav = useRef(null)

  useEffect(() => {
    const el = nav.current
    gsap.fromTo(el, { y: -100, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, delay: 0.5, ease: 'power3.out' })

    let lastY = 0
    const onScroll = () => {
      const y = window.scrollY
      el.classList.toggle('nav--hidden', y > lastY && y > 200)
      el.classList.toggle('nav--solid', y > 80)
      lastY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const go = (e, href) => {
    e.preventDefault()
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <nav ref={nav} className="nav">
      <a href="#" className="nav__logo">CREEKSTONE</a>
      <ul className="nav__links">
        {links.map(({ href, label }) => (
          <li key={href}>
            <a href={href} onClick={(e) => go(e, href)}>{label}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

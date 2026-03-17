import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export function useReveal(selector = '.reveal', stagger = 0.12) {
  const scope = useRef(null)

  useEffect(() => {
    if (!scope.current) return

    const els = scope.current.querySelectorAll(selector)
    if (!els.length) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        els,
        { y: 60, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1.2,
          stagger,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: scope.current,
            start: 'top 80%',
            once: true,
          },
        },
      )
    }, scope)

    return () => ctx.revert()
  }, [selector, stagger])

  return scope
}

export function useParallax(selector, speed = 0.15) {
  const scope = useRef(null)

  useEffect(() => {
    if (!scope.current) return
    const el = scope.current.querySelector(selector)
    if (!el) return

    const ctx = gsap.context(() => {
      gsap.to(el, {
        yPercent: speed * 100,
        ease: 'none',
        scrollTrigger: {
          trigger: scope.current,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
        },
      })
    }, scope)

    return () => ctx.revert()
  }, [selector, speed])

  return scope
}

export function useCounter(selector = '.counter-value') {
  const scope = useRef(null)

  useEffect(() => {
    if (!scope.current) return
    const els = scope.current.querySelectorAll(selector)
    if (!els.length) return

    const ctx = gsap.context(() => {
      els.forEach((el) => {
        const raw = el.dataset.value || el.textContent
        const numMatch = raw.match(/[\d.]+/)
        if (!numMatch) return

        const target = parseFloat(numMatch[0])
        const prefix = raw.slice(0, raw.indexOf(numMatch[0]))
        const suffix = raw.slice(raw.indexOf(numMatch[0]) + numMatch[0].length)
        const hasDecimal = numMatch[0].includes('.')

        el.textContent = prefix + '0' + suffix

        const obj = { val: 0 }
        gsap.to(obj, {
          val: target,
          duration: 2,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 85%',
            once: true,
          },
          onUpdate: () => {
            el.textContent =
              prefix +
              (hasDecimal ? obj.val.toFixed(1) : Math.round(obj.val)) +
              suffix
          },
        })
      })
    }, scope)

    return () => ctx.revert()
  }, [selector])

  return scope
}

export { gsap, ScrollTrigger }

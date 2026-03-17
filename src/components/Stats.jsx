import { stats } from '../data/stats'
import { useReveal, useCounter } from '../hooks/useGsap'
import './Stats.css'

export default function Stats() {
  const revealRef = useReveal('.stats__item', 0.15)
  const counterRef = useCounter()

  const setRefs = (el) => {
    revealRef.current = el
    counterRef.current = el
  }

  return (
    <section id="about" ref={setRefs} className="stats">
      <div className="stats__header">
        <span className="section-label reveal">Performance</span>
        <h2 className="section-heading reveal">
          Consistently backing the best founders<br />
          with <em>exceptional</em> follow-on rates
        </h2>
      </div>

      <div className="stats__grid">
        {stats.map((s) => (
          <div className="stats__item reveal" key={s.label}>
            <div className="stats__number counter-value" data-value={s.number}>
              {s.number}
            </div>
            <div className="stats__divider" />
            <p className="stats__label">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

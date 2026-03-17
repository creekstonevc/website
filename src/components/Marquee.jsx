import './Marquee.css'

export default function Marquee({ text = 'We Create • We Spark • We Invest •' }) {
  const items = Array(8).fill(text)

  return (
    <div className="marquee">
      <div className="marquee__track">
        {items.map((t, i) => (
          <span key={i} className="marquee__item">{t}&nbsp;</span>
        ))}
      </div>
    </div>
  )
}

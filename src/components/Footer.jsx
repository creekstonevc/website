import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__left">
          <span className="footer__logo">CREEKSTONE</span>
          <p className="footer__copy">&copy; 2025 Creekstone Capital. All rights reserved.</p>
        </div>
        <p className="footer__legal">
          This material does not constitute an offer to sell or solicitation to purchase limited partnership interests.
        </p>
      </div>
    </footer>
  )
}

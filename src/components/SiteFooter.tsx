const TECH_STACK = [
  'Next.js App Router',
  'React 19',
  'TypeScript',
  'Supabase',
  'Google Cloud Vision',
  'Vertex AI',
  'Google Cloud Text-to-Speech',
]

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__row">
          <span>© 2026 JustinTagarda</span>
          <span aria-hidden="true" className="site-footer__bullet">
            •
          </span>
          <a className="site-footer__link" href="mailto:justintagarda@gmail.com">
            justintagarda@gmail.com
          </a>
        </div>
        <div className="site-footer__row site-footer__row--stack">
          <span className="site-footer__label">Tech stack:</span>
          <span>{TECH_STACK.join(' • ')}</span>
        </div>
      </div>
    </footer>
  )
}

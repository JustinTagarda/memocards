import type { Metadata } from 'next'
import { SiteFooter } from '../components/SiteFooter'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'MemoCards',
  description: 'Private flashcards with spaced repetition, audio, and explanation-based study flows.',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="site-frame">
            <div className="site-content">{children}</div>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  )
}

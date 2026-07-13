import type { Metadata } from 'next'
import { SiteFooter } from '../components/SiteFooter'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'MemoCards',
  description:
    'Private flashcards with spaced repetition, Quick Add, OCR, lesson generation, audio, and answer evaluation.',
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

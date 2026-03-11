export function isEmbeddedBrowser(userAgent: string) {
  const normalized = userAgent.toLowerCase()

  return [
    'fban',
    'fbav',
    'fb_iab',
    'messenger',
    'instagram',
    'line/',
    'micromessenger',
    'snapchat',
    'linkedinapp',
    'twitter',
    'reddit',
  ].some((marker) => normalized.includes(marker))
}

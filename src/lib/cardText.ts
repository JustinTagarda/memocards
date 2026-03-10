import type { Card } from '../types/models'

export type CardAudioSide = 'prompt' | 'answer'

export function getCardPrompt(card: Card) {
  switch (card.type) {
    case 'basic':
      return card.front || card.prompt
    case 'term':
      return card.front || card.prompt
    case 'multiple_choice':
      return card.prompt
    case 'explanation':
      return card.prompt
  }
}

export function getCardAnswer(card: Card) {
  switch (card.type) {
    case 'basic':
      return card.back || card.answer
    case 'term':
      return card.back || card.answer
    case 'multiple_choice':
      return card.answer
    case 'explanation':
      return card.expectedAnswer.canonical || card.answer
  }
}

export function getCardSearchText(card: Card) {
  return [
    card.front,
    card.back,
    card.prompt,
    card.answer,
    card.explanation,
    card.expectedAnswer.canonical,
    ...card.expectedAnswer.keywords,
    ...card.tags,
    ...card.choices.map((choice) => choice.text),
  ]
    .join(' ')
    .toLowerCase()
}

export function getCardAudioText(card: Card, side: CardAudioSide) {
  return side === 'prompt' ? getCardPrompt(card) : getCardAnswer(card)
}

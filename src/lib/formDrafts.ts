import type { Card, CardDraft, Deck, DeckDraft } from '../types/models'

export function deckToDraft(deck: Deck): DeckDraft {
  return {
    title: deck.title,
    description: deck.description,
    folderId: deck.folderId,
    tags: [...deck.tags],
    preferences: {
      defaultMode: deck.preferences.defaultMode,
      shuffleByDefault: deck.preferences.shuffleByDefault,
      autoPlayAudio: deck.preferences.autoPlayAudio,
      dailyGoal: deck.preferences.dailyGoal,
      entryDefaults: {
        cardType: deck.preferences.entryDefaults.cardType,
        tags: [...deck.preferences.entryDefaults.tags],
      },
    },
  }
}

export function cardToDraft(card: Card): CardDraft {
  return {
    type: card.type,
    front: card.front,
    back: card.back,
    prompt: card.prompt,
    answer: card.answer,
    explanation: card.explanation,
    choices: card.choices.map((choice) => ({ ...choice })),
    expectedAnswer: {
      canonical: card.expectedAnswer.canonical,
      acceptedVariants: [...card.expectedAnswer.acceptedVariants],
      keywords: [...card.expectedAnswer.keywords],
      rubric: card.expectedAnswer.rubric,
    },
    tags: [...card.tags],
    isFavorite: card.isFavorite,
  }
}

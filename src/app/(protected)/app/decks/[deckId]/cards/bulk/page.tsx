import { redirect } from 'next/navigation'

export default function BulkCardRoute({ params }: { params: { deckId: string } }) {
  redirect(`/app/decks/${params.deckId}/questions/generate`)
}

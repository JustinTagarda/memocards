'use client'

import { History } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useRecentActivity, useRecentSessions } from '../hooks/useMemoCards'
import { formatSmartDate } from '../lib/utils'

export function ActivityPage() {
  const { user } = useAuth()
  const { data: activity, loading: activityLoading } = useRecentActivity(user?.id)
  const { data: sessions, loading: sessionsLoading } = useRecentSessions(user?.id)

  if (!user) {
    return null
  }

  return (
    <div className="page-stack">
      <section className="hero-panel hero-panel--feature activity-page__hero">
        <div className="hero-panel__copy">
          <p className="eyebrow">Activity</p>
          <h1>Recent study and latest activity</h1>
          <p>Review your latest study sessions and activity updates in one place.</p>
        </div>
      </section>

      <section className="activity-grid">
        <article className="side-panel side-panel--compact">
          <div className="panel-heading">
            <strong>Recent study</strong>
            <History size={16} />
          </div>
          <div className="list-stack">
            {sessionsLoading && <p className="hint-text">Loading recent sessions...</p>}
            {!sessionsLoading && sessions.length === 0 && <p className="hint-text">Your recent sessions will show here.</p>}
            {sessions.map((session) => (
              <div key={session.id} className="activity-item">
                <strong>{session.deckTitle}</strong>
                <small>
                  {session.cardsStudied} cards · {session.mode} · {formatSmartDate(session.endedAt)}
                </small>
              </div>
            ))}
          </div>
        </article>

        <article className="side-panel side-panel--compact">
          <div className="panel-heading">
            <strong>Latest activity</strong>
          </div>
          <div className="list-stack">
            {activityLoading && <p className="hint-text">Loading recent activity...</p>}
            {!activityLoading && activity.length === 0 && <p className="hint-text">Activity will show up after your first study session.</p>}
            {activity.map((item) => (
              <div key={item.id} className="activity-item">
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  )
}

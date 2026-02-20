interface GovernmentEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  scheduledAt: string;
  durationMinutes: number;
  locationBuildingId: string | null;
  status: string;
  outcome: string | null;
  isPublic: boolean;
}

interface EventDetailModalProps {
  event: GovernmentEvent | null;
  onClose: () => void;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  committee_hearing: 'text-gold border-gold/40 bg-gold/10',
  floor_session: 'text-slate-light border-slate-judicial/40 bg-slate-judicial/10',
  cabinet_meeting: 'text-stone border-stone/40 bg-stone/10',
  press_briefing: 'text-status-passed border-status-passed/40 bg-status-passed/10',
  judicial_hearing: 'text-blue-400 border-blue-400/40 bg-blue-400/10',
  party_caucus: 'text-danger border-danger/40 bg-danger/10',
  election_rally: 'text-gold-bright border-gold-bright/40 bg-gold-bright/10',
  budget_session: 'text-status-committee border-status-committee/40 bg-status-committee/10',
  constitutional_review: 'text-stone-light border-stone-light/40 bg-stone-light/10',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  committee_hearing: 'Committee Hearing',
  floor_session: 'Floor Session',
  cabinet_meeting: 'Cabinet Meeting',
  press_briefing: 'Press Briefing',
  judicial_hearing: 'Judicial Hearing',
  party_caucus: 'Party Caucus',
  election_rally: 'Election Rally',
  budget_session: 'Budget Session',
  constitutional_review: 'Constitutional Review',
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'text-text-muted border-border',
  in_progress: 'text-status-active border-status-active/40 bg-status-active/10',
  completed: 'text-status-passed border-status-passed/40 bg-status-passed/10',
  cancelled: 'text-danger border-danger/40 bg-danger/10',
};

function formatDateTime(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  if (!event) return null;

  const typeColor = EVENT_TYPE_COLORS[event.type] ?? 'text-text-muted border-border bg-black/20';
  const typeLabel = EVENT_TYPE_LABELS[event.type] ?? event.type.replace(/_/g, ' ');
  const statusColor = STATUS_COLORS[event.status] ?? 'text-text-muted border-border';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backdropFilter: 'blur(4px)', background: 'rgba(26, 27, 30, 0.75)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={event.title}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-lg border border-border shadow-2xl overflow-hidden"
        style={{ background: '#2B2D31' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${typeColor}`}>
                  {typeLabel}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${statusColor}`}>
                  {event.status}
                </span>
              </div>
              <h2 className="font-serif text-card-title text-text-primary">{event.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0 text-lg leading-none mt-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          {/* Time + Duration */}
          <div className="flex items-center gap-6 text-sm">
            <div>
              <div className="text-badge text-text-muted uppercase tracking-wide mb-0.5">When</div>
              <div className="text-text-primary font-mono text-xs">{formatDateTime(event.scheduledAt)}</div>
            </div>
            <div>
              <div className="text-badge text-text-muted uppercase tracking-wide mb-0.5">Duration</div>
              <div className="text-text-primary text-xs">{event.durationMinutes} min</div>
            </div>
            {event.locationBuildingId && (
              <div>
                <div className="text-badge text-text-muted uppercase tracking-wide mb-0.5">Location</div>
                <div className="text-text-primary text-xs capitalize">
                  {event.locationBuildingId.replace(/-/g, ' ')}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          {event.description && (
            <div>
              <div className="text-badge text-text-muted uppercase tracking-wide mb-1">Description</div>
              <p className="text-sm text-text-secondary leading-relaxed">{event.description}</p>
            </div>
          )}

          {/* Outcome */}
          {event.outcome && (
            <div className="rounded border border-border/50 bg-black/20 p-3">
              <div className="text-badge text-text-muted uppercase tracking-wide mb-1">Outcome</div>
              <p className="text-sm text-text-secondary leading-relaxed">{event.outcome}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

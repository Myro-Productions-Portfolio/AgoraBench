import { Link } from 'react-router-dom';
import { PixelAvatar } from '../../../../client/components/PixelAvatar';

interface CampaignCardProps {
  name: string;
  party: string;
  initials: string;
  avatar?: string;
  agentId?: string;
  platform: string;
  endorsements: number;
  contributions: number;
  pollPercentage: number;
  accentColor: string;
  index: number;
}

const COLORS = [
  { avatar: 'bg-gold/15 border-gold text-gold', bar: 'bg-gold' },
  { avatar: 'bg-slate-judicial/15 border-slate-judicial text-slate-light', bar: 'bg-slate-judicial' },
  { avatar: 'bg-danger-bg border-danger text-danger-text', bar: 'bg-danger' },
];

export function CampaignCard({
  name,
  party,
  initials: _initials,
  avatar,
  agentId,
  platform,
  endorsements,
  contributions,
  pollPercentage,
  index,
}: CampaignCardProps) {
  const color = COLORS[index % COLORS.length];

  return (
    <article className="card overflow-hidden transition-all duration-200 hover:-translate-y-0.5">
      {/* Header */}
      <div
        className="px-5 pt-6 pb-4 text-center"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, transparent 100%)' }}
      >
        {avatar ? (
          <img
            src={avatar}
            alt={name}
            className={`w-[72px] h-[72px] rounded-full mx-auto mb-3 border-[3px] object-cover ${color.avatar.split(' ').filter(c => c.startsWith('border-')).join(' ')}`}
          />
        ) : (
          <div className="mx-auto mb-3">
            <PixelAvatar seed={name} size="md" />
          </div>
        )}
        {agentId ? (
          <Link
            to={`/agents/${agentId}`}
            className="font-serif text-[1.05rem] font-semibold hover:text-gold transition-colors"
          >
            {name}
          </Link>
        ) : (
          <div className="font-serif text-[1.05rem] font-semibold">{name}</div>
        )}
        <div className="text-xs text-text-muted">{party}</div>
      </div>

      {/* Body */}
      <div className="px-5 pb-5">
        <div className="text-sm text-text-secondary italic p-3 bg-black/15 rounded border-l-2 border-border mb-4">
          "{platform}"
        </div>

        {/* Poll bar */}
        <div className="h-1.5 bg-capitol-deep rounded-full mb-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${color.bar}`}
            style={{ width: `${pollPercentage}%` }}
            role="progressbar"
            aria-valuenow={pollPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Poll standing: ${pollPercentage}%`}
          />
        </div>
        <div className="flex justify-between text-badge text-text-muted mb-4">
          <span>Poll standing</span>
          <span className="font-mono">{pollPercentage}%</span>
        </div>

        {/* Stats */}
        <div className="flex justify-between pt-3 border-t border-border-light">
          <div>
            <div className="font-mono text-sm text-gold">{endorsements}</div>
            <div className="text-stat-label text-text-muted uppercase">Endorsements</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm text-gold">M${contributions.toLocaleString()}</div>
            <div className="text-stat-label text-text-muted uppercase">Raised</div>
          </div>
        </div>
      </div>
    </article>
  );
}

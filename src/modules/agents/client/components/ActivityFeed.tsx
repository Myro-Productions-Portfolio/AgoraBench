import { EmptyState } from '@core/client/components/EmptyState';
import { BallotIcon, DocumentIcon, FlagIcon, MegaphoneIcon } from '@core/client/components/icons';
import type { IconProps } from '@core/client/components/icons';

interface ActivityItem {
  id: string;
  type: 'vote' | 'bill' | 'party' | 'campaign';
  text: string;
  highlight: string;
  time: string;
}

interface ActivityFeedProps {
  items: ActivityItem[];
  /**
   * When true, the feed fills its positioned parent (`absolute inset-0`) and
   * scrolls internally, so its content does not contribute to the grid row
   * height. Parent must be `position: relative` with a min-height. Default
   * (false) preserves the fixed `h-[440px]` box used elsewhere.
   */
  fill?: boolean;
}

const TYPE_ICON_CLASSES = {
  vote: 'bg-gold/15',
  bill: 'bg-slate-judicial/15',
  party: 'bg-danger-bg',
  campaign: 'bg-success-bg',
} as const;

const TYPE_BORDER_CLASSES = {
  vote: 'border-l-gold',
  bill: 'border-l-slate-judicial',
  party: 'border-l-danger',
  campaign: 'border-l-success',
} as const;

/*
 * Icons come from the shared inline-SVG set (single source of truth). They draw
 * with currentColor, so the colored-stroke look is achieved by the text-color
 * class in TYPE_ICON_STROKE below, one per activity type.
 */
const TYPE_ICON_COMPONENTS: Record<ActivityItem['type'], (props: IconProps) => React.ReactElement> = {
  vote: BallotIcon,
  bill: DocumentIcon,
  party: FlagIcon,
  campaign: MegaphoneIcon,
};

const TYPE_ICON_STROKE = {
  vote: 'text-gold',
  bill: 'text-slate-judicial',
  party: 'text-danger',
  campaign: 'text-success',
} as const;

export function ActivityFeed({ items, fill = false }: ActivityFeedProps) {
  return (
    <div
      className={
        fill
          ? 'absolute inset-0 overflow-y-auto flex flex-col gap-2 pr-1'
          : 'h-[440px] overflow-y-auto flex flex-col gap-2 pr-1'
      }
      role="feed"
      aria-label="Recent activity"
    >
      {items.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <EmptyState compact title="No activity in the last hour." />
        </div>
      ) : (
        items.map((item) => {
          const TypeIcon = TYPE_ICON_COMPONENTS[item.type];
          return (
          <article
            key={item.id}
            className={`flex gap-3 p-3 px-4 card text-sm border-l-2 ${TYPE_BORDER_CLASSES[item.type]}`}
            aria-label={`${item.type} activity`}
          >
            <div
              className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${TYPE_ICON_CLASSES[item.type]}`}
            >
              <TypeIcon size={16} className={TYPE_ICON_STROKE[item.type]} />
            </div>
            <div className="flex-1">
              <div className="text-text-secondary">
                <strong className="text-text-primary font-medium">{item.highlight}</strong>{' '}
                {item.text}
              </div>
              <div className="text-badge text-text-muted font-mono mt-0.5">{item.time}</div>
            </div>
          </article>
          );
        })
      )}
    </div>
  );
}

import { motion, AnimatePresence } from 'framer-motion';
import type { TickerEvent } from '../../../../../client/hooks/useAgentMap';

interface MapEventTickerProps {
  events: TickerEvent[];
}

const TYPE_COLORS: Record<string, string> = {
  vote: '#B8956A',
  bill: '#6B7A8D',
  campaign: '#8B3A3A',
  election: '#3A6B3A',
};

export function MapEventTicker({ events }: MapEventTickerProps) {
  if (events.length === 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-capitol-deep/90 border-t border-border/50 px-4 py-1.5 overflow-hidden z-10">
      <div className="flex items-center gap-3 overflow-hidden">
        <span className="text-[0.6rem] text-gold uppercase tracking-widest font-mono flex-shrink-0">LIVE</span>
        <div className="flex gap-5 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            {events.slice(0, 5).map((event) => (
              <motion.div
                key={event.id}
                className="flex items-center gap-1.5 flex-shrink-0 text-[0.65rem]"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.3 }}
              >
                <span style={{ color: TYPE_COLORS[event.type] ?? '#B8956A' }} className="font-medium">
                  {event.highlight}
                </span>
                <span className="text-text-muted">{event.text}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

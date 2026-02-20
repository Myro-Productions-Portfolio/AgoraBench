import { motion, AnimatePresence } from 'framer-motion';
import type { SpeechBubble as SpeechBubbleType } from '@core/client/hooks/useAgentMap';

interface SpeechBubbleProps {
  bubble: SpeechBubbleType;
}

export function SpeechBubble({ bubble }: SpeechBubbleProps) {
  const truncated = bubble.text.length > 120 ? bubble.text.slice(0, 117) + '...' : bubble.text;

  return (
    <AnimatePresence>
      <motion.div
        key={bubble.id}
        className="absolute z-30 pointer-events-none"
        style={{
          bottom: '100%',
          left: '50%',
          marginBottom: '4px',
          translateX: '-50%',
          transformOrigin: 'bottom center',
        }}
        initial={{ scale: 0, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0, opacity: 0, y: 8 }}
        transition={{ type: 'spring', stiffness: 350, damping: 22 }}
      >
        {/* Bubble body */}
        <div
          className="relative bg-capitol-elevated border border-border rounded-xl px-3 py-2 max-w-[180px] text-[0.65rem] text-text-primary leading-relaxed shadow-lg"
        >
          {truncated}

          {/* Tail — spiky pointer pointing down toward the avatar */}
          <svg
            className="absolute left-1/2 -translate-x-1/2 top-full"
            width="14"
            height="8"
            viewBox="0 0 14 8"
            fill="none"
          >
            <path
              d="M0 0 L7 8 L14 0"
              fill="#3E4147"
              stroke="#4E5058"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

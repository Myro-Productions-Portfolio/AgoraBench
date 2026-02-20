import { motion, AnimatePresence } from 'framer-motion';
import type { BuildingPulse } from '../../../../../core/client/hooks/useAgentMap';

interface BuildingPulseRingProps {
  pulse: BuildingPulse | undefined;
}

export function BuildingPulseRing({ pulse }: BuildingPulseRingProps) {
  return (
    <AnimatePresence>
      {pulse && (
        <motion.div
          key={pulse.triggeredAt}
          className="absolute inset-0 rounded pointer-events-none"
          initial={{ opacity: 0.7, scale: 1 }}
          animate={{ opacity: 0, scale: 1.35 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: 'easeOut' }}
          style={{
            border: `2px solid ${pulse.color}`,
            boxShadow: `0 0 16px ${pulse.color}66`,
          }}
        />
      )}
    </AnimatePresence>
  );
}

import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';

interface DetectionScoreboardProps {
  count: number;
  visibleVehicles: number;
  processing: boolean;
  roundId?: string | null;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

export function DetectionScoreboard({ count, visibleVehicles, processing, roundId }: DetectionScoreboardProps) {
  const reduceMotion = useReducedMotion();
  const countTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.34, ease: EASE_OUT_EXPO };

  return (
    <m.aside
      className={`count-hud ${processing ? 'is-live' : ''}`}
      initial={false}
      animate={{ opacity: processing ? 1 : 0.82, scale: processing && !reduceMotion ? 1 : 0.985 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE_OUT_EXPO }}
      aria-label={`${count} vehicles crossed in the current round`}
    >
      <div className="scoreboard-heading">
        <span className="scoreboard-signal"><i /> {processing ? 'LIVE COUNT' : 'ROUND COUNT'}</span>
        <span>{String(visibleVehicles).padStart(2, '0')} TRACKED</span>
      </div>
      <div className="scoreboard-rule" />
      <span className="scoreboard-label">VEHICLES CROSSED</span>
      <span className="scoreboard-count-label">COUNT</span>
      <div className="scoreboard-number" aria-live="polite" aria-atomic="true">
        <AnimatePresence initial={false} mode="popLayout">
          <m.strong
            key={count}
            initial={reduceMotion ? false : { opacity: 0.35, y: 12, scale: 0.82, filter: 'brightness(1.8)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'brightness(1)' }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -9, scale: 1.08 }}
            transition={countTransition}
          >
            {String(count).padStart(2, '0')}
          </m.strong>
        </AnimatePresence>
        <AnimatePresence>
          {count > 0 && (
            <m.span
              key={`reward-${count}`}
              className="scoreboard-reward"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -6, scale: 0.8 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: [0, 1, 1, 0], x: [0, 7, 10, 14], scale: [0.8, 1, 1, 0.96] }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.48, ease: EASE_OUT_EXPO }}
            >
              +1
            </m.span>
          )}
        </AnimatePresence>
      </div>
      <div className="scoreboard-footer">
        <span>CURRENT ROUND</span>
        <b>{roundId ? `#${roundId}` : 'LOCAL'}</b>
      </div>
      <AnimatePresence>
        {count > 0 && !reduceMotion && (
          <m.div
            key={`score-glow-${count}`}
            className="scoreboard-glow"
            initial={{ opacity: 0.8, scale: 0.82 }}
            animate={{ opacity: 0, scale: 1.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
          />
        )}
      </AnimatePresence>
    </m.aside>
  );
}

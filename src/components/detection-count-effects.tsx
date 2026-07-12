import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';

export interface DetectionCountRipple {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DetectionCountEffectsProps {
  width: number;
  height: number;
  ripples: DetectionCountRipple[];
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

export function DetectionCountEffects({ width, height, ripples }: DetectionCountEffectsProps) {
  const reduceMotion = useReducedMotion();
  return (
    <svg className="detection-fx-layer" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <AnimatePresence initial={false}>
        {ripples.map(ripple => {
          const padding = Math.max(8, Math.min(ripple.width, ripple.height) * 0.08);
          const centerX = ripple.x + ripple.width / 2;
          const centerY = ripple.y + ripple.height / 2;
          return (
            <m.g key={ripple.key}>
              <m.rect
                x={ripple.x - padding}
                y={ripple.y - padding}
                width={ripple.width + padding * 2}
                height={ripple.height + padding * 2}
                rx={Math.max(4, padding / 2)}
                fill="rgba(72, 255, 139, .12)"
                stroke="#48ff8b"
                vectorEffect="non-scaling-stroke"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                initial={reduceMotion ? { opacity: 0.7 } : { opacity: 0.95, scale: 0.82, strokeWidth: 5 }}
                animate={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.24, strokeWidth: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0.12 : 0.62, ease: EASE_OUT_EXPO }}
              />
              {!reduceMotion && (
                <m.circle
                  cx={centerX}
                  cy={centerY}
                  r={Math.max(10, Math.min(ripple.width, ripple.height) * 0.16)}
                  fill="none"
                  stroke="#d7ff45"
                  vectorEffect="non-scaling-stroke"
                  initial={{ opacity: 0.9, scale: 0.4, strokeWidth: 4 }}
                  animate={{ opacity: 0, scale: 2.8, strokeWidth: 1 }}
                  transition={{ duration: 0.58, ease: EASE_OUT_EXPO }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                />
              )}
            </m.g>
          );
        })}
      </AnimatePresence>
    </svg>
  );
}

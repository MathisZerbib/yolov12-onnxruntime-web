"use client";

import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import { GlobeLive } from "./globe-live";

interface ScrollGlobeProps {
  className?: string;
  startScale?: number;
  endScale?: number;
  scrollRange?: number;
  onLocationClick?: (locationId: string) => void;
}

export default function ScrollGlobe({
  className = "",
  startScale = 1,
  endScale = 5,
  scrollRange = 1000,
  onLocationClick,
}: ScrollGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollY } = useScroll();

  const scale = useSpring(
    useTransform(scrollY, [0, scrollRange], [startScale, endScale]),
    { stiffness: 60, damping: 28, mass: 0.6 }
  );

  const opacity = useTransform(scrollY, [0, scrollRange * 0.3, scrollRange], [1, 1, 0.85]);

  const borderRadius = useTransform(scrollY, [0, scrollRange], ["50%", "0%"]);

  const shadowOpacity = useTransform(scrollY, [0, scrollRange * 0.5], [1, 0]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${className}`}
      style={{ height: `${scrollRange + 100}vh` }}
    >
      <div className="sticky top-0 h-screen w-full overflow-hidden flex items-center justify-center">
        {/* Ambient radial glow behind globe */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: useTransform(scrollY, [0, scrollRange * 0.4, scrollRange], [0.3, 0.6, 0.1]),
            background: "radial-gradient(circle at center, rgba(245,158,11,0.12) 0%, rgba(0,0,0,0) 70%)",
          }}
        />

        {/* Globe wrapper */}
        <motion.div
          className="relative"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            x: "-50%",
            y: "-50%",
            scale,
            opacity,
            borderRadius,
            filter: useTransform(shadowOpacity, (v) => `drop-shadow(0 0 ${24 * v}px rgba(0,0,0,${0.4 * v}))`),
            willChange: "transform, opacity, border-radius, filter",
          }}
        >
          <div className="w-125 h-125 md:w-150 md:h-150">
            <GlobeLive onLocationClick={onLocationClick} />
          </div>
        </motion.div>

        {/* Scroll progress indicator */}
        <motion.div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          style={{
            opacity: useTransform(scrollY, [0, scrollRange * 0.2, scrollRange * 0.5], [1, 0.6, 0]),
          }}
        >
          <span className="text-[10px] font-bold tracking-[0.2em] text-neutral-500 uppercase">
            Scroll to expand
          </span>
          <motion.svg
            className="w-4 h-4 text-neutral-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </motion.svg>
        </motion.div>
      </div>
    </div>
  );
}

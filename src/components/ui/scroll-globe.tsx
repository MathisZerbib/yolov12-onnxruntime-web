"use client";

import { GlobeLive } from "./globe-live";

interface ScrollGlobeProps {
  className?: string;
  onLocationClick?: (locationId: string) => void;
}

export default function ScrollGlobe({
  className = "",
  onLocationClick,
}: ScrollGlobeProps) {
  return (
    <div className={`relative w-full ${className}`}>
      <div className="flex items-center justify-center py-4">
        <div className="w-[300px] h-[300px] sm:w-[380px] sm:h-[380px] md:w-[440px] md:h-[440px]">
          <GlobeLive onLocationClick={onLocationClick} />
        </div>
      </div>
    </div>
  );
}
import { Detection } from '@/lib/types';

export interface StreamConfig {
  name: string;
  url: string;
  label?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface TrafficConfig {
  vehicleClasses: string[];
  roiPts: Point[];
}

const DEFAULT_TRAFFIC_CONFIG: TrafficConfig = {
  vehicleClasses: ['bicycle', 'car', 'motorcycle', 'bus', 'truck'],
  roiPts: [
    { x: 0, y: 0.25 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0.25 },
  ],
};

interface TrackEntry {
  id: number;
  cx: number;
  cy: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  className: string;
  confidence: number;
  width: number;
  height: number;
  lastSeen: number;
  insideZone: boolean;
  seenOutside: boolean;
  enteredZone: boolean;
  counted: boolean;
}

export class TrafficCounter {
  private tracks = new Map<number, TrackEntry>();
  private nextId = 0;
  private vehicleClasses: Set<number> = new Set();
  private config: TrafficConfig;
  private totalCount = 0;
  private frameCount = 0;

  constructor(config: Partial<TrafficConfig> = {}) {
    this.config = { ...DEFAULT_TRAFFIC_CONFIG, ...config };
  }

  configure(config: Partial<TrafficConfig>) {
    this.config = { ...this.config, ...config };
    this.reset();
  }

  setClassNames(classNames: string[] | Record<number, string>) {
    this.vehicleClasses.clear();
    
    const names: Record<number, string> = Array.isArray(classNames)
      ? classNames.reduce((acc, name, idx) => ({ ...acc, [idx]: name }), {} as Record<number, string>)
      : classNames;
    
    for (const [idStr, name] of Object.entries(names)) {
      const id = parseInt(idStr);
      if (this.config.vehicleClasses.some(vc => name.toLowerCase() === vc.toLowerCase() || name.toLowerCase().includes(vc.toLowerCase()))) {
        this.vehicleClasses.add(id);
      }
    }
  }

  update(detections: Detection[], width: number, height: number): TrackEntry[] {
    this.frameCount++;

    const vehicleDetections = detections.filter(d => {
      const cv = d.class;
      const hasClass = this.config.vehicleClasses.some(vc => 
        cv.toLowerCase() === vc.toLowerCase() || cv.toLowerCase().includes(vc.toLowerCase())
      );
      return hasClass;
    });

    // Compute centroids for detections
    const detCentroids = vehicleDetections.map(d => ({
      cx: d.x + d.width / 2,
      cy: d.y + d.height / 2,
      detection: d,
    }));

    const now = Date.now();
    const activeTracks = new Map<number, TrackEntry>();
    
    for (const [id, track] of this.tracks) {
      if (now - track.lastSeen < 2000) {
        activeTracks.set(id, track);
      }
    }

    // Predict next position for each active track using constant velocity model
    const dt = 1 / 30; // assume ~30fps time step
    const predicted = new Map<number, { cx: number; cy: number }>();
    
    for (const [id, track] of activeTracks) {
      const predCx = track.cx + track.vx * dt;
      const predCy = track.cy + track.vy * dt;
      predicted.set(id, { cx: predCx, cy: predCy });
    }

    const remainingTracks = new Map(activeTracks);
    const remainingDetCentroids = [...detCentroids];
    const matches = new Map<number, { trackId: number; det: typeof detCentroids[0] }>();

    // Greedy matching: for each detection, find closest PREDICTED track position
    for (const det of remainingDetCentroids) {
      let bestId = -1;
      let bestDist = Infinity;
      
      for (const [trackId] of remainingTracks) {
        const pred = predicted.get(trackId)!;
        const dx = pred.cx - det.cx;
        const dy = pred.cy - det.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const threshold = Math.max(width, height) * 0.15;
        
        if (dist < threshold && dist < bestDist) {
          bestDist = dist;
          bestId = trackId;
        }
      }
      
      if (bestId >= 0) {
        matches.set(det.detection.x * 100 + det.detection.y, { trackId: bestId, det });
        remainingTracks.delete(bestId);
      }
    }

    // Keep count geometry on the current detection. Smoothing the centroid makes
    // fast vehicles cross late, even when the rendered box is frame-synchronized.
    for (const match of matches.values()) {
      const track = activeTracks.get(match.trackId);
      if (track) {
        track.px = track.cx;
        track.py = track.cy;
        track.cx = match.det.cx;
        track.cy = match.det.cy;
        track.vx = track.vx * 0.25 + ((track.cx - track.px) / dt) * 0.75;
        track.vy = track.vy * 0.25 + ((track.cy - track.py) / dt) * 0.75;
        track.lastSeen = now;
        track.confidence = match.det.detection.confidence;
        track.width = match.det.detection.width;
        track.height = match.det.detection.height;
        const inside = this.isPointInRoi(track.cx, track.cy, width, height);
        if (!track.counted) {
          if (inside && !track.insideZone && track.seenOutside) track.enteredZone = true;
          if (!inside && track.insideZone && track.enteredZone) {
            track.counted = true;
            this.totalCount++;
          }
          if (!inside && !track.enteredZone) track.seenOutside = true;
        }
        track.insideZone = inside;
      }
    }

    // Create new tracks for unmatched detections
    for (let i = 0; i < remainingDetCentroids.length; i++) {
      const det = remainingDetCentroids[i];
      const isMatched = [...matches.values()].some(m => 
        m.det.detection.x === det.detection.x && m.det.detection.y === det.detection.y
      );
      
      if (!isMatched) {
      const startsInside = this.isPointInRoi(det.cx, det.cy, width, height);
      const newTrack: TrackEntry = {
        id: this.nextId++,
        cx: det.cx,
        cy: det.cy,
        px: det.cx,
        py: det.cy,
        vx: 0,
        vy: 0,
        className: det.detection.class,
        confidence: det.detection.confidence,
        width: det.detection.width,
        height: det.detection.height,
        lastSeen: now,
        insideZone: startsInside,
        seenOutside: !startsInside,
        enteredZone: false,
        counted: false,
      };
        activeTracks.set(newTrack.id, newTrack);
        this.tracks.set(newTrack.id, newTrack);
      }
    }

    // Clean up old tracks
    const result: TrackEntry[] = [];
    for (const track of activeTracks.values()) {
      if (now - track.lastSeen < 2000) {
        result.push(track);
      } else {
        this.tracks.delete(track.id);
      }
    }
    this.tracks.clear();
    for (const track of result) {
      this.tracks.set(track.id, track);
    }

    return result;
  }

  getTotalCount(): number {
    return this.totalCount;
  }

  getConfig(): TrafficConfig {
    return this.config;
  }

  isVehicleClass(className: string): boolean {
    return this.config.vehicleClasses.some(vc =>
      className.toLowerCase() === vc.toLowerCase() || className.toLowerCase().includes(vc.toLowerCase())
    );
  }

  isPointInRoi(x: number, y: number, width: number, height: number): boolean {
    const pts = this.config.roiPts;
    const px = x / width;
    const py = y / height;
    let inside = false;
    
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  reset() {
    this.tracks.clear();
    this.nextId = 0;
    this.totalCount = 0;
    this.frameCount = 0;
  }
}

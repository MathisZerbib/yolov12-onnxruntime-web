import { describe, expect, it } from 'vitest';
import { TrafficCounter } from '@/lib/traffic-counter';
import type { Detection } from '@/lib/types';

function detection(y: number, className = 'car'): Detection {
  return { x: 45, y, width: 10, height: 10, confidence: 0.9, class: className };
}

describe('TrafficCounter', () => {
  it('counts a vehicle once after it enters and leaves the zone', () => {
    const counter = new TrafficCounter();
    counter.update([detection(5)], 100, 100);
    counter.update([detection(15)], 100, 100);
    counter.update([detection(25)], 100, 100);
    counter.update([detection(25)], 100, 100);
    counter.update([detection(25)], 100, 100);
    counter.update([detection(15)], 100, 100);
    counter.update([detection(25)], 100, 100);
    counter.update([detection(15)], 100, 100);

    expect(counter.getTotalCount()).toBe(1);
    expect(counter.consumeCountEvents()).toEqual([
      expect.objectContaining({ id: 0, className: 'car', width: 10, height: 10 }),
    ]);
    expect(counter.consumeCountEvents()).toEqual([]);
  });

  it('ignores non-vehicle detections and recognizes configured vehicle names', () => {
    const counter = new TrafficCounter();
    expect(counter.isVehicleClass('delivery truck')).toBe(true);
    expect(counter.isVehicleClass('person')).toBe(false);
    expect(counter.update([detection(20, 'person')], 100, 100)).toEqual([]);
  });

  it('supports polygon hit testing and resets all state', () => {
    const counter = new TrafficCounter({ roiPts: [
      { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.75 },
    ] });
    expect(counter.isPointInRoi(50, 50, 100, 100)).toBe(true);
    expect(counter.isPointInRoi(10, 10, 100, 100)).toBe(false);
    counter.update([detection(20)], 100, 100);
    counter.reset();
    expect(counter.getTotalCount()).toBe(0);
    expect(counter.consumeCountEvents()).toEqual([]);
  });

  it('resets tracking when the zone configuration changes', () => {
    const counter = new TrafficCounter();
    counter.update([detection(5)], 100, 100);
    counter.configure({ roiPts: [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0, y: 0.5 },
    ] });
    expect(counter.getConfig().roiPts[2]).toEqual({ x: 1, y: 0.5 });
    expect(counter.getTotalCount()).toBe(0);
  });
});

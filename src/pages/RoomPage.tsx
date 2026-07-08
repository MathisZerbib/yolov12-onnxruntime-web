import { useParams, useNavigate } from 'react-router-dom';
import { useRef, useState, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { ROOMS } from '@/lib/globe-markers';
import { BET_TYPES, GAME_CONFIG } from '@/config/game-config';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Square, Loader2 } from 'lucide-react';
import { ObjectDetector } from '@/lib/object-detector';
import { DetectionOverlay } from '@/components/detection-overlay';
import { Detection } from '@/lib/types';
import { TrafficCounter } from '@/lib/traffic-counter';

export default function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const room = ROOMS.find(r => r.id === roomId);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const counterRef = useRef<TrafficCounter>(new TrafficCounter());
  const animRef = useRef<number>(null);
  const processingRef = useRef(false);
  const detectorRef = useRef<ObjectDetector | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [count, setCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [selectedType, setSelectedType] = useState<number>(BET_TYPES[0].id);
  const [modelLoading, setModelLoading] = useState(true);
  const [detectorReady, setDetectorReady] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);

  useEffect(() => {
    if (!room) return;
    const video = videoRef.current;
    if (!video) return;

    setIsReady(false);
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(room.streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsReady(true);
      });
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = room.streamUrl;
      video.addEventListener('loadedmetadata', () => setIsReady(true), { once: true });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [room]);

  useEffect(() => {
    let cancelled = false;
    const detector = new ObjectDetector();
    detector.initialize()
      .then(() => {
        if (cancelled) {
          detector.dispose();
          return;
        }
        detectorRef.current = detector;
        if (detector.getMetadata()) {
          counterRef.current.setClassNames(detector.getMetadata()!.classes);
        }
        setDetectorReady(true);
      })
      .catch((err) => {
        console.error('Failed to initialize detector on room page:', err);
      })
      .finally(() => {
        if (!cancelled) setModelLoading(false);
      });
    return () => {
      cancelled = true;
      if (detectorRef.current) {
        detectorRef.current.dispose();
        detectorRef.current = null;
      }
    };
  }, []);

  const loop = useCallback(async (detector: ObjectDetector) => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    const frame = frameRef.current;
    if (!video || !overlay || !frame || !detector || !processingRef.current) return;

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const ctx = frame.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        frame.width = w;
        frame.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        try {
          const imageData = ctx.getImageData(0, 0, w, h);
          const newDetections = await detector.detectObjects(imageData, 0.25);
          counterRef.current.update(newDetections, w, h);
          setCount(counterRef.current.getTotalCount());
          setDetections(newDetections);
          drawCountingLine(overlay, w, h);
        } catch (_e) {
          // ignore
        }
      }
    }
    animRef.current = requestAnimationFrame(() => loop(detector));
  }, []);

  function drawCountingLine(canvas: HTMLCanvasElement, w: number, h: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = Math.max(1, w * 0.003);
    const lineY = 0.75 * h;
    ctx.setLineDash([Math.max(4, w * 0.01), Math.max(2, w * 0.005)]);
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(w, lineY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const startProcessing = useCallback(async () => {
    const detector = detectorRef.current;
    if (!detector || !detector.isReady()) return;
    processingRef.current = true;
    setProcessing(true);
    loop(detector);
  }, [loop]);

  const stopProcessing = useCallback(() => {
    processingRef.current = false;
    setProcessing(false);
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl font-bold">Room not found</p>
          <Button onClick={() => navigate('/traffic')} className="mt-4">Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="absolute top-4 left-4 z-50">
        <Button variant="outline" onClick={() => navigate('/traffic')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>
      <div className="relative w-full h-screen">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain bg-black"
          autoPlay
          muted
          playsInline
        />
        <canvas ref={overlayRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
        {isReady && detections.length > 0 && (
          <DetectionOverlay
            detections={detections}
            videoWidth={videoRef.current?.videoWidth || 1280}
            videoHeight={videoRef.current?.videoHeight || 720}
            className="absolute inset-0 object-contain"
          />
        )}
        <canvas ref={frameRef} className="hidden" aria-hidden="true" />

        {(!isReady || modelLoading) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-30 gap-3">
            <Loader2 className="h-10 w-10 text-white animate-spin" />
            <p className="text-white text-sm font-medium">
              {modelLoading ? 'Loading detection model…' : 'Connecting to stream…'}
            </p>
          </div>
        )}

        {/* HUD */}
        <div className="absolute top-4 right-4 z-40 flex flex-col items-end gap-2">
          <div className="bg-black/70 backdrop-blur text-white text-xs px-2 py-1 rounded">
            {room.name} - {room.location}
          </div>
          <div className="bg-black/70 backdrop-blur text-white text-xs px-2 py-1 rounded">
            {room.viewers.toLocaleString()} viewers
          </div>
        </div>

        {/* Betting overlay */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 w-full max-w-3xl px-4">
          <div className="bg-black/75 backdrop-blur rounded-xl border border-white/10 p-4">
            <div className="flex flex-wrap gap-2">
              {BET_TYPES.map(bt => (
                <button
                  key={bt.id}
                  onClick={() => setSelectedType(bt.id)}
                  className={`px-3 py-2 rounded-lg border ${selectedType === bt.id ? 'ring-2 ' + bt.ringSelected : ''} ${bt.borderClass} ${bt.bgClass} ${bt.colorClass}`}
                >
                  <div className="text-xs font-bold">{bt.name}</div>
                  <div className="text-[10px] opacity-80">{bt.multDisplay}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="number"
                step="0.001"
                min={GAME_CONFIG.BETTING.MIN_ETH}
                max={GAME_CONFIG.BETTING.MAX_ETH}
                className="bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-sm w-24"
                placeholder="ETH"
              />
              <Button size="sm" className="bg-white/10 border border-white/20 text-white">Place Bet</Button>
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-white/70">
              <span>Min: {GAME_CONFIG.BETTING.MIN_ETH} ETH</span>
              <span>House edge: {(1 - GAME_CONFIG.BETTING.HOUSE_EDGE) * 100}%</span>
              <span>Max: {GAME_CONFIG.BETTING.MAX_ETH} ETH</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex gap-2">
          <span className="text-xs bg-red-600/90 text-white px-2 py-1 rounded">COUNT: {count}</span>
        </div>

        {!processing && isReady && detectorReady && (
          <div className="absolute bottom-32 left-0 right-0 flex justify-center z-40">
            <Button onClick={startProcessing} className="bg-white/10 border border-white/20 text-white">
              <Play className="h-4 w-4 mr-1" /> Start Detect
            </Button>
          </div>
        )}
        {processing && (
          <div className="absolute bottom-32 left-0 right-0 flex justify-center z-40">
            <Button onClick={stopProcessing} className="bg-white/10 border border-white/20 text-white">
              <Square className="h-4 w-4 mr-1" /> Stop Detect
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
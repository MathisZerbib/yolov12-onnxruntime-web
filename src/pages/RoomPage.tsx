import { useParams, useNavigate } from 'react-router-dom';
import { useRef, useState, useEffect, useCallback } from 'react';
import type Hls from 'hls.js';
import { ROOMS } from '@/lib/globe-markers';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Square, Loader2, Radio, ShieldCheck, Crosshair, Volume2 } from 'lucide-react';
import { WalletButton } from '@/components/wallet-button';
import { publishInferenceManifest } from '@/lib/inference-manifest';
import { AUTH_API_URL } from '@/lib/wagmi';
import { getSharedDetector, ObjectDetector } from '@/lib/object-detector';
import { Detection } from '@/lib/types';
import { TrafficCounter } from '@/lib/traffic-counter';
import type { DetectionZone } from '@/config/detection-zone';
import { useRoomMarket } from '@/lib/room-market';
import { DetectionScoreboard } from '@/components/detection-scoreboard';
import { DetectionCountEffects, type DetectionCountRipple } from '@/components/detection-count-effects';
import { LazyMotion, domAnimation } from 'motion/react';
import { RoomBettingConsole } from '@/components/room-betting-console';

export default function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const room = ROOMS.find(r => r.id === roomId);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const synchronizedRef = useRef<HTMLCanvasElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const counterRef = useRef<TrafficCounter>(new TrafficCounter());
  const animRef = useRef<number>(null);
  const processingRef = useRef(false);
  const autoStartRequestedRef = useRef(false);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const lastUiUpdateRef = useRef(0);
  const roundStartedAtRef = useRef<Date | null>(null);
  const roomLeaseRef = useRef<string | null>(null);
  const roundZoneRef = useRef<DetectionZone | null>(null);
  const rippleTimersRef = useRef<number[]>([]);

  const [isReady, setIsReady] = useState(false);
  const [count, setCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [modelLoading, setModelLoading] = useState(true);
  const [detectorReady, setDetectorReady] = useState(false);
  const [detectorAttempt, setDetectorAttempt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [synchronizedFrameReady, setSynchronizedFrameReady] = useState(false);
  const [roomLeaseError, setRoomLeaseError] = useState('');
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [detectionError, setDetectionError] = useState('');
  const [visibleVehicles, setVisibleVehicles] = useState(0);
  const [detectionZone, setDetectionZone] = useState<DetectionZone | null>(null);
  const [zoneLoading, setZoneLoading] = useState(true);
  const [detectionSurface, setDetectionSurface] = useState({ width: 1280, height: 720 });
  const [countRipples, setCountRipples] = useState<DetectionCountRipple[]>([]);
  const [personalRunEndsAt, setPersonalRunEndsAt] = useState<number | null>(null);
  const [personalFinalCount, setPersonalFinalCount] = useState<number | null>(null);
  const { market, loading: marketLoading, stale: marketStale, error: marketError, refresh: refreshMarket } = useRoomMarket(roomId);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!room) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    setIsReady(false);
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = room.streamUrl;
      video.addEventListener('loadedmetadata', () => setIsReady(true), { once: true });
    } else {
      void import('hls.js/light').then(({ default: HlsRuntime }) => {
        if (cancelled || !HlsRuntime.isSupported()) return;
        const hls = new HlsRuntime({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(room.streamUrl);
        hls.attachMedia(video);
        hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => { if (!cancelled) setIsReady(true); });
        hlsRef.current = hls;
      });
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [room]);

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    setZoneLoading(true);
    setDetectionZone(null);
    fetch(`${AUTH_API_URL}/rooms/${roomId}/zone`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 404 ? 'This room needs an admin detection zone before it can operate.' : 'Detection-zone service unavailable.');
        return response.json() as Promise<DetectionZone>;
      })
      .then(zone => {
        setDetectionZone(zone);
        counterRef.current.configure({
          roiPts: [
            { x: zone.topLeftXBps / 10_000, y: zone.topLeftYBps / 10_000 },
            { x: zone.topRightXBps / 10_000, y: zone.topRightYBps / 10_000 },
            { x: zone.bottomRightXBps / 10_000, y: zone.bottomRightYBps / 10_000 },
            { x: zone.bottomLeftXBps / 10_000, y: zone.bottomLeftYBps / 10_000 },
          ],
        });
        setCount(0);
        setRoomLeaseError('');
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setRoomLeaseError(error instanceof Error ? error.message : 'Detection-zone service unavailable.');
      })
      .finally(() => { if (!controller.signal.aborted) setZoneLoading(false); });
    return () => controller.abort();
  }, [roomId]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    if (!video || !canvas || !detectionZone) return;
    const draw = () => {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.clearRect(0, 0, w, h);
      const points = [
        [detectionZone.topLeftXBps / 10_000 * w, detectionZone.topLeftYBps / 10_000 * h],
        [detectionZone.topRightXBps / 10_000 * w, detectionZone.topRightYBps / 10_000 * h],
        [detectionZone.bottomRightXBps / 10_000 * w, detectionZone.bottomRightYBps / 10_000 * h],
        [detectionZone.bottomLeftXBps / 10_000 * w, detectionZone.bottomLeftYBps / 10_000 * h],
      ];
      ctx.fillStyle = 'rgba(215, 255, 69, 0.08)'; ctx.strokeStyle = 'rgba(215, 255, 69, 0.9)'; ctx.lineWidth = Math.max(2, w * 0.002);
      ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]); for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]); ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    draw(); video.addEventListener('loadedmetadata', draw); return () => video.removeEventListener('loadedmetadata', draw);
  }, [detectionZone]);

  useEffect(() => {
    let cancelled = false;
    setModelLoading(true);
    setDetectorReady(false);
    getSharedDetector()
      .then((detector) => {
        if (cancelled) return;
        detectorRef.current = detector;
        if (detector.getMetadata()) {
          counterRef.current.setClassNames(detector.getMetadata()!.classes);
        }
        setDetectionError('');
        setDetectorReady(true);
      })
      .catch((err) => {
        console.error('Failed to initialize detector on room page:', err);
        if (!cancelled) setDetectionError('The on-device detector could not start. Retry after the runtime assets finish loading.');
      })
      .finally(() => {
        if (!cancelled) setModelLoading(false);
      });
    return () => {
      cancelled = true;
      detectorRef.current = null;
    };
  }, [detectorAttempt]);

  const loop = useCallback(async (detector: ObjectDetector) => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    const frame = frameRef.current;
    const synchronized = synchronizedRef.current;
    if (!video || !overlay || !frame || !synchronized || !detector || !processingRef.current) return;

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const ctx = frame.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        frame.width = w;
        frame.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        try {
          const newDetections = await detector.detectCanvas(frame);
          setDetectionError('');
          counterRef.current.update(newDetections, w, h);
          const countEvents = counterRef.current.consumeCountEvents();
          if (countEvents.length > 0) {
            setDetectionSurface(current => current.width === w && current.height === h ? current : { width: w, height: h });
            const ripples = countEvents.map(event => ({ ...event, key: `${event.id}-${performance.now()}-${crypto.randomUUID()}` }));
            setCountRipples(current => [...current, ...ripples].slice(-8));
            setCount(counterRef.current.getTotalCount());
            for (const ripple of ripples) {
              const timer = window.setTimeout(() => setCountRipples(current => current.filter(item => item.key !== ripple.key)), 700);
              rippleTimersRef.current.push(timer);
            }
          }
          const now = performance.now();
          if (now - lastUiUpdateRef.current >= 250) {
            lastUiUpdateRef.current = now;
            setVisibleVehicles(newDetections.length);
            setInferenceMs(detector.getLastPerformance()?.totalMs ?? null);
            setCount(counterRef.current.getTotalCount());
          }
          drawSynchronizedFrame(synchronized, frame, newDetections, w, h);
          setSynchronizedFrameReady(true);
          drawCountingZone(overlay, w, h, roundZoneRef.current ?? detectionZone);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Frame inference failed';
          console.error('[live-detection]', error);
          setDetectionError(message);
          processingRef.current = false;
          setProcessing(false);
        }
      }
    }
    animRef.current = requestAnimationFrame(() => loop(detector));
  }, [detectionZone]);

  function drawSynchronizedFrame(canvas: HTMLCanvasElement, source: HTMLCanvasElement, frameDetections: Detection[], w: number, h: number) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, w, h);
    const lineWidth = Math.max(2, w * 0.0025);
    const fontSize = Math.max(13, w * 0.014);
    ctx.font = `700 ${fontSize}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    frameDetections.forEach((detection, index) => {
      const color = '#d7ff45';
      const x = detection.x;
      const y = detection.y;
      const boxWidth = detection.width;
      const boxHeight = detection.height;
      const corner = Math.max(10, Math.min(boxWidth, boxHeight, w * 0.04) * 0.24);
      const scanProgress = (performance.now() % 1_100) / 1_100;
      const scanY = y + boxHeight * scanProgress;

      ctx.save();
      ctx.fillStyle = 'rgba(215, 255, 69, 0.035)';
      ctx.fillRect(x, y, boxWidth, boxHeight);
      ctx.strokeStyle = 'rgba(215, 255, 69, 0.34)';
      ctx.lineWidth = Math.max(1, lineWidth * 0.42);
      ctx.setLineDash([Math.max(4, lineWidth * 2), Math.max(4, lineWidth * 2.4)]);
      ctx.strokeRect(x, y, boxWidth, boxHeight);
      ctx.setLineDash([]);

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'square';
      ctx.shadowColor = 'rgba(215, 255, 69, 0.58)';
      ctx.shadowBlur = Math.max(3, lineWidth * 2.2);
      ctx.beginPath();
      ctx.moveTo(x, y + corner); ctx.lineTo(x, y); ctx.lineTo(x + corner, y);
      ctx.moveTo(x + boxWidth - corner, y); ctx.lineTo(x + boxWidth, y); ctx.lineTo(x + boxWidth, y + corner);
      ctx.moveTo(x + boxWidth, y + boxHeight - corner); ctx.lineTo(x + boxWidth, y + boxHeight); ctx.lineTo(x + boxWidth - corner, y + boxHeight);
      ctx.moveTo(x + corner, y + boxHeight); ctx.lineTo(x, y + boxHeight); ctx.lineTo(x, y + boxHeight - corner);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = 'rgba(72, 255, 139, 0.46)';
      ctx.lineWidth = Math.max(1, lineWidth * 0.35);
      ctx.beginPath(); ctx.moveTo(x + 3, scanY); ctx.lineTo(x + boxWidth - 3, scanY); ctx.stroke();

      const centerX = x + boxWidth / 2;
      const centerY = y + boxHeight / 2;
      const reticle = Math.max(4, lineWidth * 1.8);
      ctx.strokeStyle = 'rgba(215, 255, 69, 0.78)';
      ctx.beginPath();
      ctx.moveTo(centerX - reticle, centerY); ctx.lineTo(centerX + reticle, centerY);
      ctx.moveTo(centerX, centerY - reticle); ctx.lineTo(centerX, centerY + reticle);
      ctx.stroke();

      const label = `${detection.class.toUpperCase()}  ${Math.round(detection.confidence * 100)}%`;
      const target = `TGT-${String(index + 1).padStart(2, '0')}`;
      const labelWidth = ctx.measureText(label).width + 18;
      const labelHeight = fontSize + 10;
      const labelX = Math.min(Math.max(0, x), Math.max(0, w - labelWidth));
      const labelY = y >= labelHeight + 4 ? y - labelHeight - 4 : Math.min(h - labelHeight, y + boxHeight + 4);
      const notch = Math.min(8, labelHeight * 0.28);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(labelX, labelY); ctx.lineTo(labelX + labelWidth - notch, labelY); ctx.lineTo(labelX + labelWidth, labelY + notch);
      ctx.lineTo(labelX + labelWidth, labelY + labelHeight); ctx.lineTo(labelX + notch, labelY + labelHeight); ctx.lineTo(labelX, labelY + labelHeight - notch);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#10130c';
      ctx.fillText(label, labelX + 9, labelY + 5);
      ctx.font = `800 ${Math.max(9, fontSize * 0.68)}px ui-monospace, monospace`;
      const targetWidth = ctx.measureText(target).width + 10;
      ctx.fillStyle = 'rgba(15, 20, 11, 0.88)';
      ctx.fillRect(Math.max(0, x + boxWidth - targetWidth), Math.max(0, y + boxHeight - fontSize), targetWidth, fontSize);
      ctx.fillStyle = color;
      ctx.fillText(target, Math.max(4, x + boxWidth - targetWidth + 5), Math.max(0, y + boxHeight - fontSize + 2));
      ctx.restore();
    });
  }

  function drawCountingZone(canvas: HTMLCanvasElement, w: number, h: number, zone: DetectionZone | null) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !zone) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    const points = [
      [zone.topLeftXBps / 10_000 * w, zone.topLeftYBps / 10_000 * h],
      [zone.topRightXBps / 10_000 * w, zone.topRightYBps / 10_000 * h],
      [zone.bottomRightXBps / 10_000 * w, zone.bottomRightYBps / 10_000 * h],
      [zone.bottomLeftXBps / 10_000 * w, zone.bottomLeftYBps / 10_000 * h],
    ] as const;
    ctx.fillStyle = 'rgba(215, 255, 69, 0.14)';
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#d7ff45';
    ctx.lineWidth = Math.max(3, w * 0.003);
    ctx.setLineDash([Math.max(3, w * 0.006), Math.max(2, w * 0.004)]);
    ctx.stroke();
    ctx.setLineDash([]);
    const label = 'COUNTING ZONE · ENTER + LEAVE';
    const fontSize = Math.max(12, w * 0.012);
    ctx.font = `800 ${fontSize}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    const labelX = Math.max(0, points[0][0]);
    const labelY = Math.max(0, points[0][1] - fontSize - 14);
    ctx.fillStyle = '#d7ff45';
    ctx.fillRect(labelX, labelY, ctx.measureText(label).width + 16, fontSize + 10);
    ctx.fillStyle = '#10110e';
    ctx.fillText(label, labelX + 8, labelY + 5);
  }

  const startProcessing = useCallback(async () => {
    const detector = detectorRef.current;
    if (!detector || !detector.isReady() || !roomId) return;
    setRoomLeaseError('');
    if (!detectionZone) {
      setRoomLeaseError(zoneLoading ? 'Loading the admin detection zone…' : 'An admin detection zone is required before this room can operate.');
      return;
    }
    let lease: { leaseToken: string };
    try {
      const leaseResponse = await fetch(`${AUTH_API_URL}/rooms/${roomId}/lease`, { method: 'POST', credentials: 'include' });
      if (!leaseResponse.ok) {
        const failure = await leaseResponse.json().catch(() => null) as { error?: string } | null;
        if (leaseResponse.status === 401) setRoomLeaseError('Your wallet session expired. Open the wallet widget and verify again.');
        else if (leaseResponse.status === 409) setRoomLeaseError('This room already has an active detector. Try again when its lease ends.');
        else setRoomLeaseError(failure?.error ? `Room service: ${failure.error}` : 'The room coordinator could not issue a lease.');
        return;
      }
      lease = await leaseResponse.json() as { leaseToken: string };
    } catch {
      setRoomLeaseError('The room service is offline. Run npm run dev to start web and API.');
      return;
    }
    roomLeaseRef.current = lease.leaseToken;
    roundZoneRef.current = detectionZone;
    counterRef.current.reset();
    setCount(0);
    processingRef.current = true;
    autoStartRequestedRef.current = false;
    roundStartedAtRef.current = new Date();
    setSynchronizedFrameReady(false);
    setDetectionError('');
    setVisibleVehicles(0);
    for (const timer of rippleTimersRef.current) window.clearTimeout(timer);
    rippleTimersRef.current = [];
    setCountRipples([]);
    setProcessing(true);
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (video && overlay) drawCountingZone(overlay, video.videoWidth || 1280, video.videoHeight || 720, detectionZone);
    loop(detector);
  }, [detectionZone, loop, roomId, zoneLoading]);

  const stopProcessing = useCallback(() => {
    processingRef.current = false;
    setProcessing(false);
    setSynchronizedFrameReady(false);
    for (const timer of rippleTimersRef.current) window.clearTimeout(timer);
    rippleTimersRef.current = [];
    setCountRipples([]);
    const metadata = detectorRef.current?.getMetadata();
    const leaseToken = roomLeaseRef.current;
    if (roomId && leaseToken) {
      const publication = roundStartedAtRef.current && metadata
        && roundZoneRef.current
        ? publishInferenceManifest(roomId, leaseToken, roundStartedAtRef.current, counterRef.current.getTotalCount(), metadata, roundZoneRef.current)
        : Promise.resolve(null);
      void publication
        .catch((error) => console.warn('[inference-manifest]', error))
        .finally(() => { void fetch(`${AUTH_API_URL}/rooms/${roomId}/lease`, { method: 'DELETE', credentials: 'include', headers: { 'x-room-lease': leaseToken } }).catch(() => undefined); });
    }
    roomLeaseRef.current = null;
    roundStartedAtRef.current = null;
    roundZoneRef.current = null;
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, [roomId]);

  useEffect(() => () => {
    processingRef.current = false;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const leaseToken = roomLeaseRef.current;
    if (roomId && leaseToken) void fetch(`${AUTH_API_URL}/rooms/${roomId}/lease`, { method: 'DELETE', credentials: 'include', headers: { 'x-room-lease': leaseToken } }).catch(() => undefined);
    roomLeaseRef.current = null;
    for (const timer of rippleTimersRef.current) window.clearTimeout(timer);
    rippleTimersRef.current = [];
  }, [roomId]);

  const handlePositionConfirmed = useCallback(() => {
    setPersonalFinalCount(null);
    setPersonalRunEndsAt(Date.now() + 30_000);
    autoStartRequestedRef.current = true;
    if (!processingRef.current) void startProcessing();
  }, [startProcessing]);

  useEffect(() => {
    if (autoStartRequestedRef.current && isReady && detectorReady && detectionZone && !processingRef.current) void startProcessing();
  }, [detectionZone, detectorReady, isReady, startProcessing]);

  useEffect(() => {
    if (personalRunEndsAt !== null && clock >= personalRunEndsAt) {
      setPersonalFinalCount(counterRef.current.getTotalCount());
      if (processingRef.current) stopProcessing();
      setPersonalRunEndsAt(null);
    }
  }, [clock, personalRunEndsAt, stopProcessing]);

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

  const personalSecondsRemaining = personalRunEndsAt === null ? null : Math.max(0, Math.ceil((personalRunEndsAt - clock) / 1_000));

  return (
    <LazyMotion features={domAnimation} strict>
    <main className="room-shell">
      <header className="room-nav">
        <button className="room-back" onClick={() => navigate('/traffic')}><ArrowLeft /> Markets</button>
        <button className="brand-lockup" onClick={() => navigate('/')}><span className="brand-mark"><span /></span><span>CROSSFLOW</span></button>
        <WalletButton />
      </header>
      <div className="room-workspace">
        <section className="broadcast-stage">
          <div className="broadcast-bar">
            <div><span className="broadcast-live"><i /> LIVE</span><b>{room.name}</b><span>{room.location}</span></div>
            <div><span><Volume2 /> Ambient audio</span><span><ShieldCheck /> On-device detector</span></div>
          </div>
          <div className="video-viewport">
        <video
          ref={videoRef}
          crossOrigin="anonymous"
          className={`room-video ${processing && synchronizedFrameReady ? 'is-synchronized' : ''}`}
          autoPlay
          muted
          playsInline
        />
        <canvas ref={synchronizedRef} className={`room-video synchronized-video ${processing && synchronizedFrameReady ? 'is-visible' : ''}`} />
        <canvas ref={overlayRef} className={`room-canvas zone-overlay ${processing ? 'is-active' : ''}`} aria-label="Configured vehicle counting zone" />
        <DetectionCountEffects width={detectionSurface.width} height={detectionSurface.height} ripples={countRipples} />
        <canvas ref={frameRef} className="hidden" aria-hidden="true" />

        {(!isReady || modelLoading) && (
          <div className="room-loader">
            <Loader2 className="h-10 w-10 text-white animate-spin" />
            <p className="text-white text-sm font-medium">
              {modelLoading ? 'Loading detection model…' : 'Connecting to stream…'}
            </p>
          </div>
        )}

        <div className="vision-hud">
          <span><Crosshair /> YOLOV12 / 640PX</span>
          {detectionZone && <span>ZONE V{detectionZone.version}</span>}
          <span className={processing ? 'active' : ''}><i /> {processing ? `DETECTING · ${visibleVehicles} IN FRAME${inferenceMs ? ` / ${Math.round(inferenceMs)}MS` : ''}` : 'STANDBY'}</span>
        </div>
        <DetectionScoreboard count={count} visibleVehicles={visibleVehicles} processing={processing} roundId={market?.marketId} />
        {isReady && !modelLoading && (detectorReady
          ? <button disabled={!detectionZone || zoneLoading} className={`detect-control ${processing ? 'stop' : ''}`} onClick={processing ? stopProcessing : startProcessing}>{processing ? <Square /> : <Play />}{processing ? 'Stop oracle' : zoneLoading ? 'Loading admin zone…' : 'Start live detection'}</button>
          : <button className="detect-control" onClick={() => setDetectorAttempt((attempt) => attempt + 1)}><Play /> Retry detector</button>)}
        {roomLeaseError && <div className="room-lease-error" role="alert">{roomLeaseError}</div>}
        {detectionError && <div className="room-lease-error" role="alert">{processing ? 'Detection stopped: ' : ''}{detectionError}</div>}
          </div>
          <footer className="broadcast-footer"><span><Radio /> {room.viewers.toLocaleString()} watching</span><span>{detectionZone ? `Admin zone v${detectionZone.version} · enter + leave to count` : 'Admin zone unavailable'}</span><span>CONFIDENCE ≥ 50%</span></footer>
        </section>

        <RoomBettingConsole roomId={room.id} market={market} marketLoading={marketLoading} marketStale={marketStale} marketError={marketError} personalSecondsRemaining={personalSecondsRemaining} personalFinalCount={personalFinalCount} onRefresh={refreshMarket} onPositionConfirmed={handlePositionConfirmed} />
      </div>
    </main>
    </LazyMotion>
  );
}

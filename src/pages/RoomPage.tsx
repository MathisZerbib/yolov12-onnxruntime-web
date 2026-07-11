import { useParams, useNavigate } from 'react-router-dom';
import { useRef, useState, useEffect, useCallback } from 'react';
import type Hls from 'hls.js';
import { ROOMS } from '@/lib/globe-markers';
import { BET_TYPES, GAME_CONFIG } from '@/config/game-config';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Square, Loader2, Radio, ShieldCheck, Crosshair, Volume2 } from 'lucide-react';
import { WalletButton } from '@/components/wallet-button';
import { PlacePositionButton } from '@/components/place-position-button';
import { publishInferenceManifest } from '@/lib/inference-manifest';
import { AUTH_API_URL } from '@/lib/wagmi';
import { ChallengeTimeline } from '@/components/challenge-timeline';
import { getSharedDetector, ObjectDetector } from '@/lib/object-detector';
import { Detection } from '@/lib/types';
import { TrafficCounter } from '@/lib/traffic-counter';
import type { DetectionZone } from '@/config/detection-zone';

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
  const detectorRef = useRef<ObjectDetector | null>(null);
  const lastUiUpdateRef = useRef(0);
  const roundStartedAtRef = useRef<Date | null>(null);
  const roomLeaseRef = useRef<string | null>(null);
  const roundZoneRef = useRef<DetectionZone | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [count, setCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [selectedType, setSelectedType] = useState<number>(BET_TYPES[0].id);
  const [modelLoading, setModelLoading] = useState(true);
  const [detectorReady, setDetectorReady] = useState(false);
  const [ethAmount, setEthAmount] = useState<number>(GAME_CONFIG.BETTING.MIN_ETH);
  const [synchronizedFrameReady, setSynchronizedFrameReady] = useState(false);
  const [roomLeaseError, setRoomLeaseError] = useState('');
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [detectionZone, setDetectionZone] = useState<DetectionZone | null>(null);
  const [zoneLoading, setZoneLoading] = useState(true);

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
            { x: zone.x1Bps / 10_000, y: zone.y1Bps / 10_000 },
            { x: zone.x1Bps / 10_000, y: zone.y2Bps / 10_000 },
            { x: zone.x2Bps / 10_000, y: zone.y2Bps / 10_000 },
            { x: zone.x2Bps / 10_000, y: zone.y1Bps / 10_000 },
          ],
          countingLineY: zone.countingLineYBps / 10_000,
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
    let cancelled = false;
    getSharedDetector()
      .then((detector) => {
        if (cancelled) return;
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
      detectorRef.current = null;
    };
  }, []);

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
          counterRef.current.update(newDetections, w, h);
          const now = performance.now();
          if (now - lastUiUpdateRef.current >= 250) {
            lastUiUpdateRef.current = now;
            setInferenceMs(detector.getLastPerformance()?.totalMs ?? null);
            setCount(counterRef.current.getTotalCount());
          }
          drawSynchronizedFrame(synchronized, frame, newDetections, w, h);
          setSynchronizedFrameReady(true);
          drawCountingZone(overlay, w, h, roundZoneRef.current ?? detectionZone);
        } catch {
          // ignore
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
    for (const detection of frameDetections) {
      const color = '#d7ff45';
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(detection.x, detection.y, detection.width, detection.height);
      const label = `CAR ${Math.round(detection.confidence * 100)}%`;
      const labelWidth = ctx.measureText(label).width + 12;
      const labelHeight = fontSize + 8;
      const labelY = Math.max(0, detection.y - labelHeight);
      ctx.fillStyle = color;
      ctx.fillRect(detection.x, labelY, labelWidth, labelHeight);
      ctx.fillStyle = '#10110e';
      ctx.fillText(label, detection.x + 6, labelY + 4);
    }
  }

  function drawCountingZone(canvas: HTMLCanvasElement, w: number, h: number, zone: DetectionZone | null) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !zone) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    const x1 = zone.x1Bps / 10_000 * w;
    const y1 = zone.y1Bps / 10_000 * h;
    const x2 = zone.x2Bps / 10_000 * w;
    const y2 = zone.y2Bps / 10_000 * h;
    ctx.fillStyle = 'rgba(215, 255, 69, 0.045)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = 'rgba(215, 255, 69, 0.7)';
    ctx.lineWidth = Math.max(1, w * 0.0015);
    ctx.setLineDash([Math.max(3, w * 0.006), Math.max(2, w * 0.004)]);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = Math.max(1, w * 0.003);
    const lineY = zone.countingLineYBps / 10_000 * h;
    ctx.setLineDash([Math.max(4, w * 0.01), Math.max(2, w * 0.005)]);
    ctx.beginPath();
    ctx.moveTo(x1, lineY);
    ctx.lineTo(x2, lineY);
    ctx.stroke();
    ctx.setLineDash([]);
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
    roundStartedAtRef.current = new Date();
    setSynchronizedFrameReady(false);
    setProcessing(true);
    loop(detector);
  }, [detectionZone, loop, roomId, zoneLoading]);

  const stopProcessing = useCallback(() => {
    processingRef.current = false;
    setProcessing(false);
    setSynchronizedFrameReady(false);
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
  }, [roomId]);

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

  const selectedBet = BET_TYPES.find((type) => type.id === selectedType) ?? BET_TYPES[0];

  return (
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
            <div><span><Volume2 /> Ambient audio</span><span><ShieldCheck /> Oracle verified</span></div>
          </div>
          <div className="video-viewport">
        <video
          ref={videoRef}
          className={`room-video ${processing && synchronizedFrameReady ? 'is-synchronized' : ''}`}
          autoPlay
          muted
          playsInline
        />
        <canvas ref={synchronizedRef} className={`room-video synchronized-video ${processing && synchronizedFrameReady ? 'is-visible' : ''}`} />
        <canvas ref={overlayRef} className="room-canvas" />
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
          <span className={processing ? 'active' : ''}><i /> {processing ? `DETECTING${inferenceMs ? ` / ${Math.round(inferenceMs)}MS` : ''}` : 'STANDBY'}</span>
        </div>
        <div className="count-hud"><small>VEHICLES CROSSED</small><strong>{String(count).padStart(2, '0')}</strong><span>current round</span></div>
        {isReady && detectorReady && <button disabled={!detectionZone || zoneLoading} className={`detect-control ${processing ? 'stop' : ''}`} onClick={processing ? stopProcessing : startProcessing}>{processing ? <Square /> : <Play />}{processing ? 'Stop oracle' : zoneLoading ? 'Loading admin zone…' : 'Start live detection'}</button>}
        {roomLeaseError && <div className="room-lease-error" role="alert">{roomLeaseError}</div>}
          </div>
          <footer className="broadcast-footer"><span><Radio /> {room.viewers.toLocaleString()} watching</span><span>{detectionZone ? `Admin zone v${detectionZone.version} · line at ${(detectionZone.countingLineYBps / 100).toFixed(1)}%` : 'Admin zone unavailable'}</span><span>CONFIDENCE ≥ 50%</span></footer>
        </section>

        <aside className="room-ticket">
          <div className="round-header"><div><span>ROUND #2841</span><b>Closes in 00:42</b></div><i>OPEN</i></div>
          <div className="ticket-title"><h1>How many vehicles cross the line?</h1><p>Resolved automatically when the 60-second detection window closes.</p></div>
          <div className="ticket-block"><label>Choose outcome</label><div className="room-outcomes">{BET_TYPES.map((type) => <button key={type.id} className={selectedType === type.id ? 'active' : ''} onClick={() => setSelectedType(type.id)}><span>{type.name}<small>{type.description}</small></span><b>{type.multDisplay}</b></button>)}</div></div>
          <div className="ticket-block"><div className="ticket-label"><label htmlFor="room-stake">Stake</label><span>Balance 2.481 ETH</span></div><div className="ticket-amount"><input id="room-stake" aria-label="ETH stake" type="number" min={GAME_CONFIG.BETTING.MIN_ETH} max={GAME_CONFIG.BETTING.MAX_ETH} step="0.001" value={ethAmount} onChange={(e) => setEthAmount(Number(e.target.value))}/><span>ETH</span></div><div className="room-presets">{GAME_CONFIG.BETTING.PRESETS.slice(1,5).map((p) => <button key={p} onClick={() => setEthAmount(p)}>{p}</button>)}</div></div>
          <div className="ticket-summary"><div><span>Your call</span><b>{selectedBet.name}</b></div><div><span>Potential payout</span><b>{(ethAmount * selectedBet.mult).toFixed(3)} ETH</b></div></div>
          <PlacePositionButton outcome={selectedType} amount={ethAmount} />
          <ChallengeTimeline />
          <p className="ticket-fineprint"><ShieldCheck /> Settlement secured on {GAME_CONFIG.NETWORK.NAME}</p>
        </aside>
      </div>
    </main>
  );
}

import { useParams, useNavigate } from 'react-router-dom';
import { useRef, useState, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { ROOMS } from '@/lib/globe-markers';
import { BET_TYPES, GAME_CONFIG } from '@/config/game-config';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Square, Loader2, Radio, ShieldCheck, Wallet, Crosshair, Volume2 } from 'lucide-react';
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
  const synchronizedRef = useRef<HTMLCanvasElement>(null);
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
  const [ethAmount, setEthAmount] = useState<number>(GAME_CONFIG.BETTING.MIN_ETH);
  const [synchronizedFrameReady, setSynchronizedFrameReady] = useState(false);

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
          setCount(counterRef.current.getTotalCount());
          drawSynchronizedFrame(synchronized, frame, newDetections, w, h);
          setSynchronizedFrameReady(true);
          // Never paint inference results over a newer <video> frame.
          setDetections([]);
          drawCountingLine(overlay, w, h);
        } catch (_e) {
          // ignore
        }
      }
    }
    animRef.current = requestAnimationFrame(() => loop(detector));
  }, []);

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
    setSynchronizedFrameReady(false);
    setProcessing(true);
    loop(detector);
  }, [loop]);

  const stopProcessing = useCallback(() => {
    processingRef.current = false;
    setProcessing(false);
    setSynchronizedFrameReady(false);
    setDetections([]);
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

  const selectedBet = BET_TYPES.find((type) => type.id === selectedType) ?? BET_TYPES[0];

  return (
    <main className="room-shell">
      <header className="room-nav">
        <button className="room-back" onClick={() => navigate('/traffic')}><ArrowLeft /> Markets</button>
        <button className="brand-lockup" onClick={() => navigate('/')}><span className="brand-mark"><span /></span><span>CROSSFLOW</span></button>
        <button className="wallet-button"><Wallet /> Connect</button>
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
        {isReady && detections.length > 0 && (
          <DetectionOverlay
            detections={detections}
            videoWidth={videoRef.current?.videoWidth || 1280}
            videoHeight={videoRef.current?.videoHeight || 720}
            className="room-canvas"
          />
        )}
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
          <span className={processing ? 'active' : ''}><i /> {processing ? 'DETECTING' : 'STANDBY'}</span>
        </div>
        <div className="count-hud"><small>VEHICLES CROSSED</small><strong>{String(count).padStart(2, '0')}</strong><span>current round</span></div>
        {isReady && detectorReady && <button className={`detect-control ${processing ? 'stop' : ''}`} onClick={processing ? stopProcessing : startProcessing}>{processing ? <Square /> : <Play />}{processing ? 'Stop oracle' : 'Start live detection'}</button>}
          </div>
          <footer className="broadcast-footer"><span><Radio /> {room.viewers.toLocaleString()} watching</span><span>Line at 75% frame height</span><span>CONFIDENCE ≥ 50%</span></footer>
        </section>

        <aside className="room-ticket">
          <div className="round-header"><div><span>ROUND #2841</span><b>Closes in 00:42</b></div><i>OPEN</i></div>
          <div className="ticket-title"><h1>How many vehicles cross the line?</h1><p>Resolved automatically when the 60-second detection window closes.</p></div>
          <div className="ticket-block"><label>Choose outcome</label><div className="room-outcomes">{BET_TYPES.map((type) => <button key={type.id} className={selectedType === type.id ? 'active' : ''} onClick={() => setSelectedType(type.id)}><span>{type.name}<small>{type.description}</small></span><b>{type.multDisplay}</b></button>)}</div></div>
          <div className="ticket-block"><div className="ticket-label"><label>Stake</label><span>Balance 2.481 ETH</span></div><div className="ticket-amount"><input type="number" min={GAME_CONFIG.BETTING.MIN_ETH} max={GAME_CONFIG.BETTING.MAX_ETH} step="0.001" value={ethAmount} onChange={(e) => setEthAmount(Number(e.target.value))}/><span>ETH</span></div><div className="room-presets">{GAME_CONFIG.BETTING.PRESETS.slice(1,5).map((p) => <button key={p} onClick={() => setEthAmount(p)}>{p}</button>)}</div></div>
          <div className="ticket-summary"><div><span>Your call</span><b>{selectedBet.name}</b></div><div><span>Potential payout</span><b>{(ethAmount * selectedBet.mult).toFixed(3)} ETH</b></div></div>
          <button className="place-position">Connect wallet to bet</button>
          <p className="ticket-fineprint"><ShieldCheck /> Settlement secured on {GAME_CONFIG.NETWORK.NAME}</p>
        </aside>
      </div>
    </main>
  );
}

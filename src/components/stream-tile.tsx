import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Loader2 } from 'lucide-react';
import { Detection } from '@/lib/types';
import { ObjectDetector } from '@/lib/object-detector';
import { StreamConfig, TrafficCounter } from '@/lib/traffic-counter';
import { Play, Square, AlertTriangle, Camera, Wifi, WifiOff, Eye, TestTube } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StreamTileProps {
  config: StreamConfig;
  detector: ObjectDetector;
  onError?: (name: string, error: string) => void;
  isActive?: boolean;
  onToggle?: (name: string, active: boolean) => void;
  onOpen?: () => void;
}

type StreamStatus = 'idle' | 'loading' | 'playing' | 'stalled' | 'error';

export function StreamTile({ config, detector, onError, isActive = false, onToggle, onOpen }: StreamTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const counterRef = useRef<TrafficCounter>(new TrafficCounter());
  const animFrameRef = useRef<number>(null);
  const isProcessingRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const detectionCountRef = useRef(0);
  const lastUiUpdateRef = useRef(0);

  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 640, height: 360 });
  const [lastDetectionCount, setLastDetectionCount] = useState(0);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [frameTestResult, setFrameTestResult] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const fpsHistoryRef = useRef<number[]>([]);
  const lastFpsUpdateRef = useRef(0);

  useEffect(() => {
    counterRef.current = new TrafficCounter();
    frameCountRef.current = 0;
    detectionCountRef.current = 0;
    setCount(0);
    setLastDetectionCount(0);
    setFramesProcessed(0);
    setFrameTestResult(null);

    if (detector.getMetadata()) {
      counterRef.current.setClassNames(detector.getMetadata()!.classes);
    }
  }, [config.url, detector]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setStreamStatus('loading');
    setIsReady(false);
    setError(null);
    setFrameTestResult(null);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      
      hls.loadSource(config.url);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        setVideoSize({ width: w, height: h });
        setIsReady(true);
        setStreamStatus('playing');
        setError(null);
      });
      
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          const errMsg = data.type === Hls.ErrorTypes.NETWORK_ERROR 
            ? 'Network error loading stream' 
            : data.details || 'Stream error';
          setStreamStatus('error');
          setError(errMsg);
          if (onError) onError(config.name, errMsg);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          setStreamStatus('stalled');
          setError('Stream buffering...');
        }
      });
      
      hls.on(Hls.Events.FRAG_LOADED, () => {
        if (streamStatus === 'loading' || streamStatus === 'stalled') {
          setStreamStatus('playing');
          setError(null);
        }
      });
      
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = config.url;
      video.addEventListener('loadedmetadata', () => {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        setVideoSize({ width: w, height: h });
        setIsReady(true);
        setStreamStatus('playing');
      });
    }

    return () => {
      setStreamStatus('idle');
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [config.name, config.url, onError, streamStatus]);

  const drawDetections = useCallback((ctx: CanvasRenderingContext2D, detections: Detection[], width: number, height: number) => {
    ctx.clearRect(0, 0, width, height);

    for (const det of detections) {
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = Math.max(2, width * 0.003);
      ctx.strokeRect(det.x, det.y, det.width, det.height);

      const label = `${det.class} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = `bold ${Math.max(12, width * 0.018)}px Arial`;
      const textW = ctx.measureText(label).width;
      const labelH = Math.max(18, width * 0.028);
      const labelX = det.x;
      const labelY = Math.max(0, det.y - labelH);

      ctx.fillStyle = '#EF4444';
      ctx.fillRect(labelX, labelY, textW + 10, labelH);

      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'top';
      ctx.fillText(label, labelX + 5, labelY + 4);
    }
  }, []);

  const runDetectionLoop = useCallback(async () => {
    if (!isProcessingRef.current) return;

    const video = videoRef.current;
    const frameCanvas = frameCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    
    if (!video || !frameCanvas || !overlayCanvas || !detector.isReady()) {
      if (isProcessingRef.current) {
        animFrameRef.current = requestAnimationFrame(runDetectionLoop);
      }
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const now = performance.now();
      if (now - lastFrameTimeRef.current > 80) {
        lastFrameTimeRef.current = now;
        
        const fpsHistory = fpsHistoryRef.current;
        if (fpsHistory.length === 0 || now - lastFpsUpdateRef.current >= 1000) {
          lastFpsUpdateRef.current = now;
          if (fpsHistory.length > 0) {
            const avgFps = Math.round(fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length);
            setFps(avgFps);
          }
          fpsHistoryRef.current = [];
        }
        fpsHistory.push(1);
        
        try {
          const w = video.videoWidth || videoSize.width;
          const h = video.videoHeight || videoSize.height;
          
          if (w === 0 || h === 0) {
            if (isProcessingRef.current) {
              animFrameRef.current = requestAnimationFrame(runDetectionLoop);
            }
            return;
          }
          
          const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          
          if (frameCanvas.width !== w || frameCanvas.height !== h) {
            frameCanvas.width = w;
            frameCanvas.height = h;
          }
          if (overlayCanvas.width !== w || overlayCanvas.height !== h) {
            overlayCanvas.width = w;
            overlayCanvas.height = h;
          }
          
          ctx.drawImage(video, 0, 0, w, h);
          
          let imageData: ImageData;
          try {
            imageData = ctx.getImageData(0, 0, w, h);
          } catch {
            const msg = `Cannot read video frames (CORS). Server must send Access-Control-Allow-Origin headers or use same-origin sources.`;
            setError(msg);
            setStreamStatus('error');
            return;
          }
          
          const allDetections = await detector.detectObjects(imageData);
          const rawDetections = allDetections.filter(d => d.class.toLowerCase() === 'car');
          frameCountRef.current++;
          detectionCountRef.current += rawDetections.length;

          const tracks = counterRef.current.update(rawDetections, w, h);
          const total = counterRef.current.getTotalCount();

          const smoothedDetections: Detection[] = tracks.map(track => ({
            x: Math.max(0, track.cx - (track.width || 40) / 2),
            y: Math.max(0, track.cy - (track.height || 40) / 2),
            width: track.width || 40,
            height: track.height || 40,
            confidence: track.confidence,
            class: track.className,
          }));

          const overlayCtx = overlayCanvas.getContext('2d');
          if (overlayCtx) {
            drawDetections(overlayCtx, smoothedDetections, w, h);
          }

          const now2 = performance.now();
          if (now2 - lastUiUpdateRef.current > 200) {
            lastUiUpdateRef.current = now2;
            setCount(total);
            setFramesProcessed(frameCountRef.current);
            setLastDetectionCount(rawDetections.length);
          }
        } catch (e) {
          console.error(`[StreamTile] ${config.name} detection loop error:`, e);
        }
      }
    }
    
    if (isProcessingRef.current) {
      animFrameRef.current = requestAnimationFrame(runDetectionLoop);
    }
  }, [detector, videoSize, config.name, drawDetections]);

  const startProcessing = useCallback(() => {
    if (!detector.isReady()) {
      setError('Model not ready yet');
      return;
    }
    isProcessingRef.current = true;
    lastFrameTimeRef.current = 0;
    runDetectionLoop();
  }, [detector, runDetectionLoop]);

  const stopProcessing = useCallback(() => {
    isProcessingRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  const testFrameCapture = useCallback(async () => {
    const video = videoRef.current;
    const frameCanvas = frameCanvasRef.current;
    
    if (!video || !frameCanvas) {
      setFrameTestResult('Video or canvas not ready');
      return;
    }

    const waitForFrame = async (timeout = 3000): Promise<string> => {
      const start = performance.now();
      while (performance.now() - start < timeout) {
        const w = video.videoWidth || videoSize.width;
        const h = video.videoHeight || videoSize.height;
        
        if (w > 0 && h > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            return 'Canvas 2D not available';
          }
          
          frameCanvas.width = w;
          frameCanvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          
          try {
            const testData = ctx.getImageData(0, 0, w, h);
            const nonEmptyPixels = testData.data.filter((v, i) => i % 4 === 0 && v > 0).length;
            return `OK: ${w}x${h}, ${nonEmptyPixels} non-zero pixels`;
          } catch {
            return 'BLOCKED: CORS/tainted canvas, getImageData() failed';
          }
        }
        
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      
      return `Timeout after ${timeout}ms: video=${video.videoWidth}x${video.videoHeight}, readyState=${video.readyState}`;
    };

    const result = await waitForFrame();
    setFrameTestResult(result);
  }, [videoSize]);

  const toggleStartStop = () => {
    if (isProcessingRef.current) {
      stopProcessing();
      setIsPlaying(false);
      onToggle?.(config.name, false);
    } else {
      startProcessing();
      setIsPlaying(true);
      onToggle?.(config.name, true);
    }
  };

  useEffect(() => {
    return () => {
      stopProcessing();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [stopProcessing]);

  // Auto-start/stop when the `isActive` prop changes. Guarded by a ref so it
  // never re-runs on every render (the previous version called
  // `detector.isReady()` inside the deps array, causing an infinite loop).
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (isActive && !wasActiveRef.current && detector.isReady() && !isProcessingRef.current) {
      startProcessing();
      wasActiveRef.current = true;
    } else if (!isActive && wasActiveRef.current) {
      stopProcessing();
      wasActiveRef.current = false;
    }
  }, [isActive, detector, startProcessing, stopProcessing]);

  const getStatusIcon = () => {
    switch (streamStatus) {
      case 'playing': return <Wifi className="h-3 w-3 text-green-500" />;
      case 'loading': return <Camera className="h-3 w-3 text-yellow-500 animate-pulse" />;
      case 'stalled': return <Eye className="h-3 w-3 text-orange-500" />;
      case 'error': return <WifiOff className="h-3 w-3 text-red-500" />;
      default: return <Eye className="h-3 w-3 text-gray-500" />;
    }
  };

  return (
    <div className="relative bg-background rounded-lg overflow-hidden border border-border shadow-md">
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain"
          muted
          playsInline
          autoPlay
          onPlay={() => setStreamStatus('playing')}
          onWaiting={() => setStreamStatus('stalled')}
          onPlaying={() => setStreamStatus('playing')}
          onStalled={() => setStreamStatus('stalled')}
          onError={() => {
            setStreamStatus('error');
            setError('Stream playback error');
            if (onError) onError(config.name, 'Video playback error');
          }}
        />
        
        {/* Hidden canvas: frame capture */}
        <canvas
          ref={frameCanvasRef}
          className="hidden"
          aria-hidden="true"
        />
        {/* Detection overlay drawn imperatively for zero React overhead */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />
        
        <div className="absolute top-0 left-0 right-0 flex justify-between items-center z-10 bg-gradient-to-b from-black/70 to-transparent p-2">
          <div className="flex items-center gap-1.5">
            {getStatusIcon()}
            <span className="bg-black/70 backdrop-blur-sm text-white text-xs font-bold px-2 py-0.5 rounded">
              {config.label || config.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isPlaying && (
              <>
                <span className="text-xs text-white/80 bg-black/50 px-1.5 py-0.5 rounded">
                  {fps} FPS
                </span>
                <span className="text-xs text-white/80 bg-black/50 px-1.5 py-0.5 rounded">
                  {framesProcessed}f {lastDetectionCount}det
                </span>
              </>
            )}
            <span className="bg-red-600/90 backdrop-blur-sm text-white text-xs font-bold px-2 py-0.5 rounded-md">
              COUNT: {count}
            </span>
          </div>
        </div>
        
        {streamStatus === 'stalled' && !error && (
          <div className="absolute top-10 left-2 z-10">
            <span className="text-xs text-orange-300 bg-black/60 px-1.5 py-0.5 rounded">Buffering...</span>
          </div>
        )}
        
        {error && streamStatus === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
            <div className="text-center p-4">
              <AlertTriangle className="h-8 w-8 text-yellow-400 mx-auto mb-2" />
              <p className="text-white text-sm font-medium">{error}</p>
              <p className="text-white/70 text-xs mt-1">
                {config.name} stream unavailable or not CORS-enabled
              </p>
            </div>
          </div>
        )}
        
        {!isReady && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30 gap-3">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
            <p className="text-white text-sm font-medium">Preparing stream…</p>
          </div>
        )}

        {!error && streamStatus !== 'error' && !isPlaying && isReady && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center z-10">
            <span className="text-xs text-white/60 bg-black/40 px-2 py-1 rounded">
              Press Detect to start YOLO inference
            </span>
          </div>
        )}
      </div>
      
      <div className="p-2 flex justify-center items-center gap-2 bg-card flex-wrap">
        <Button
          onClick={toggleStartStop}
          disabled={!isReady}
          size="sm"
          className="px-3"
        >
          {isPlaying ? (
            <>
              <Square className="h-3 w-3 mr-1" />
              Stop Detect
            </>
          ) : (
            <>
              <Play className="h-3 w-3 mr-1" />
              Detect
            </>
          )}
        </Button>
        <Button
          onClick={testFrameCapture}
          variant="outline"
          size="sm"
          className="px-3"
        >
          <TestTube className="h-3 w-3 mr-1" />
          Test Frame
        </Button>
        {onOpen && (
          <Button
            onClick={onOpen}
            variant="outline"
            size="sm"
            className="px-3"
          >
            Open Room
          </Button>
        )}
        {frameTestResult && (
          <span className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">
            {frameTestResult}
          </span>
        )}
      </div>
    </div>
  );
}

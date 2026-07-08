import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
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
}

type StreamStatus = 'idle' | 'loading' | 'playing' | 'stalled' | 'error';

export function StreamTile({ config, detector, onError, isActive = false, onToggle }: StreamTileProps) {
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

  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 640, height: 360 });
  const [lastDetectionCount, setLastDetectionCount] = useState(0);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [frameTestResult, setFrameTestResult] = useState<string | null>(null);

  useEffect(() => {
    counterRef.current = new TrafficCounter();
    setCount(0);
    setLastDetectionCount(0);
    setFramesProcessed(0);
    frameCountRef.current = 0;
    detectionCountRef.current = 0;
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
        console.log(`[StreamTile] ${config.name} manifest parsed: ${w}x${h}`);
        setVideoSize({ width: w, height: h });
        setIsReady(true);
        setStreamStatus('playing');
        setError(null);
      });
      
      hls.on(Hls.Events.ERROR, (_, data) => {
        console.error(`[StreamTile] ${config.name} HLS error:`, data);
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
        console.log(`[StreamTile] ${config.name} native HLS loaded: ${w}x${h}`);
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
  }, [config.url, onError]);

  const startProcessing = useCallback(() => {
    console.log(`[StreamTile] ${config.name} starting detection, detector ready=${detector.isReady()}`);
    if (!detector.isReady()) {
      setError('Model not ready yet');
      return;
    }
    
    isProcessingRef.current = true;
    lastFrameTimeRef.current = 0;
    runDetectionLoop();
  }, [detector, config.name]);

  const stopProcessing = useCallback(() => {
    console.log(`[StreamTile] ${config.name} stopping detection`);
    isProcessingRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, [config.name]);

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
      if (now - lastFrameTimeRef.current > 250) {
        lastFrameTimeRef.current = now;
        
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
          if (!ctx) {
            console.warn(`[StreamTile] ${config.name} no canvas context`);
            return;
          }
          
          frameCanvas.width = w;
          frameCanvas.height = h;
          overlayCanvas.width = w;
          overlayCanvas.height = h;
          
          ctx.drawImage(video, 0, 0, w, h);
          
          let imageData: ImageData;
          try {
            imageData = ctx.getImageData(0, 0, w, h);
          } catch (e) {
            const msg = `Cannot read video frames (CORS). Server must send Access-Control-Allow-Origin headers or use same-origin sources.`;
            console.error(`[StreamTile] ${config.name} ${msg}`, e);
            setError(msg);
            setStreamStatus('error');
            return;
          }
          
          const detections = await detector.detectObjects(imageData, 0.25);
          frameCountRef.current++;
          detectionCountRef.current += detections.length;
          setFramesProcessed(frameCountRef.current);
          setLastDetectionCount(detections.length);
          
          console.log(`[StreamTile] ${config.name} frame=${frameCountRef.current} detections=${detections.length}`, detections.slice(0, 3));
          
          const tracks = counterRef.current.update(detections, w, h);
          setCount(counterRef.current.getTotalCount());
          
          drawAnnotations(overlayCanvas, detections, tracks, w, h);
        } catch (e) {
          console.error(`[StreamTile] ${config.name} detection loop error:`, e);
        }
      }
    }
    
    if (isProcessingRef.current) {
      animFrameRef.current = requestAnimationFrame(runDetectionLoop);
    }
  }, [detector, videoSize, config.name]);

  const testFrameCapture = useCallback(async () => {
    const video = videoRef.current;
    const frameCanvas = frameCanvasRef.current;
    console.log('[StreamTile] Test Frame clicked', {
      video: !!video,
      canvas: !!frameCanvas,
      videoWidth: video?.videoWidth,
      videoHeight: video?.videoHeight,
      readyState: video?.readyState,
    });
    
    if (!video || !frameCanvas) {
      setFrameTestResult('Video or canvas not ready');
      return;
    }

    const waitForFrame = async (timeout = 3000): Promise<string> => {
      const start = performance.now();
      let attempts = 0;
      
      while (performance.now() - start < timeout) {
        attempts++;
        const w = video.videoWidth || videoSize.width;
        const h = video.videoHeight || videoSize.height;
        
        console.log(`[StreamTile] Test Frame attempt ${attempts}: ${w}x${h}, readyState=${video.readyState}`);
        
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
          } catch (e) {
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

  const drawAnnotations = (
    canvas: HTMLCanvasElement,
    detections: Detection[],
    tracks: any[],
    width: number,
    height: number
  ) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, width, height);
    
    const config = counterRef.current.getConfig();
    if (config.roiPts.length > 0) {
      ctx.beginPath();
      ctx.moveTo(config.roiPts[0].x * width, config.roiPts[0].y * height);
      for (let i = 1; i < config.roiPts.length; i++) {
        ctx.lineTo(config.roiPts[i].x * width, config.roiPts[i].y * height);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = Math.max(1, width * 0.002);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.fill();
    }
    
    const lineY = config.countingLineY * height;
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(width, lineY);
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = Math.max(2, width * 0.003);
    ctx.setLineDash([Math.max(5, width * 0.01), Math.max(3, width * 0.005)]);
    ctx.stroke();
    ctx.setLineDash([]);
    
    const vehicleOnly = detections.filter(d => 
      config.vehicleClasses.some(vc => 
        d.class.toLowerCase() === vc.toLowerCase() || 
        d.class.toLowerCase().includes(vc.toLowerCase())
      )
    );
    
    const colorMap: Record<string, string> = {
      'car': '#3B82F6',
      'motorcycle': '#EF4444',
      'bus': '#10B981',
      'truck': '#F59E0B',
      'bicycle': '#EC4899',
    };
    
    vehicleOnly.forEach((det, idx) => {
      const color = colorMap[det.class.toLowerCase()] || `hsl(${idx * 137 % 360}, 70%, 55%)`;
      const x = det.x;
      const y = det.y;
      const w = det.width;
      const h = det.height;
      const confidence = (det.confidence * 100).toFixed(1);
      
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, width * 0.0025);
      ctx.strokeRect(x, y, w, h);
      
      const fontSize = Math.max(11, width * 0.022);
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      const label = `${det.class} ${confidence}%`;
      const metrics = ctx.measureText(label);
      const padding = fontSize * 0.35;
      const boxHeight = fontSize + padding * 2;
      
      if (y > boxHeight + 4) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y - boxHeight, metrics.width + padding * 2, boxHeight);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(label, x + padding, y - boxHeight + padding);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, metrics.width + padding * 2, boxHeight);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(label, x + padding, y + padding);
      }
    });
    
    tracks.forEach(track => {
      const cx = track.cx;
      const cy = track.cy;
      const color = track.crossed ? '#10B981' : '#FBBF24';
      const radius = Math.max(4, width * 0.009);
      
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(1, width * 0.002);
      ctx.stroke();
      
      if (track.crossed && track.prevCy) {
        ctx.beginPath();
        ctx.moveTo(cx, track.prevCy);
        ctx.lineTo(cx, cy);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, width * 0.003);
        ctx.stroke();
      }
    });
  };

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

  useEffect(() => {
    if (isActive && detector.isReady() && !isPlaying) {
      console.log(`[StreamTile] ${config.name} activating detection via isActive`);
      startProcessing();
      setIsPlaying(true);
    } else if (!isActive && isPlaying) {
      console.log(`[StreamTile] ${config.name} deactivating detection via isActive`);
      stopProcessing();
      setIsPlaying(false);
    }
  }, [isActive, detector.isReady(), isPlaying, startProcessing, stopProcessing, config.name]);

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
          onPlay={() => {
            console.log(`[StreamTile] ${config.name} video playing`);
            setStreamStatus('playing');
          }}
          onWaiting={() => setStreamStatus('stalled')}
          onPlaying={() => setStreamStatus('playing')}
          onStalled={() => setStreamStatus('stalled')}
          onError={() => {
            console.error(`[StreamTile] ${config.name} video playback error`);
            setStreamStatus('error');
            setError('Stream playback error');
            if (onError) onError(config.name, 'Video playback error');
          }}
        />
        
        {/* Hidden canvases: frame capture + overlay */}
        <canvas
          ref={frameCanvasRef}
          className="hidden"
          aria-hidden="true"
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
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
              <span className="text-xs text-white/80 bg-black/50 px-1.5 py-0.5 rounded">
                {framesProcessed}f {lastDetectionCount}det
              </span>
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
        {frameTestResult && (
          <span className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">
            {frameTestResult}
          </span>
        )}
      </div>
    </div>
  );
}

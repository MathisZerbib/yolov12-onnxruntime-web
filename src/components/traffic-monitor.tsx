import { useState, useCallback } from 'react';
import { StreamTile } from '@/components/stream-tile';
import { ObjectDetector } from '@/lib/object-detector';
import { StreamConfig } from '@/lib/traffic-counter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrafficMonitorProps {
  detector: ObjectDetector;
  initialStreams?: StreamConfig[];
}

const DEFAULT_STREAMS: StreamConfig[] = [
  {
    name: 'Tokyo',
    url: 'https://wlbt-wowza.streamguys1.com/live/byram.stream/chunks.m3u8',
    label: 'Tokyo - Live Traffic',
  },
  {
    name: 'Sydney',
    url: 'https://live.field59.com/klkn/klkn9/chunklist.m3u8',
    label: 'Sydney - Live Traffic',
  },
  {
    name: 'SF',
    url: 'https://media-hls-az1.wral.com/livehttporigin/_definst_/mp4:chapel_hill_cam.stream/chunklist.m3u8',
    label: 'San Francisco - Live Traffic',
  },
  {
    name: 'Paris',
    url: 'https://s87.ipcamlive.com/streams_storage/57xme5tijy8v39x1b/stream.m3u8',
    label: 'Paris - Live Traffic',
  },
];

export function TrafficMonitor({ detector, initialStreams }: TrafficMonitorProps) {
  const [streams, setStreams] = useState<StreamConfig[]>(initialStreams || DEFAULT_STREAMS);
  const [newStreamName, setNewStreamName] = useState('');
  const [newStreamUrl, setNewStreamUrl] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeStream, setActiveStream] = useState<string | null>(null);

  const handleAddStream = () => {
    if (!newStreamName.trim() || !newStreamUrl.trim()) return;
    
    const isYouTube = newStreamUrl.includes('youtube.com') || newStreamUrl.includes('youtu.be');
    if (isYouTube) {
      alert('YouTube streams cannot be processed in the browser due to CORS restrictions and encrypted HLS. Use direct HLS (.m3u8) URLs from public traffic cameras.');
      return;
    }
    
    const newStream: StreamConfig = {
      name: newStreamName.trim(),
      url: newStreamUrl.trim(),
    };
    
    setStreams([...streams, newStream]);
    setNewStreamName('');
    setNewStreamUrl('');
  };

  const handleRemoveStream = (index: number) => {
    setStreams(streams.filter((_, i) => i !== index));
    const newErrors = { ...errors };
    delete newErrors[index];
    setErrors(newErrors);
  };

  const handleStreamError = useCallback((name: string, error: string) => {
    setErrors(prev => ({ ...prev, [name]: error }));
  }, []);

  const toggleStream = (name: string) => {
    setActiveStream(prev => prev === name ? null : name);
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Live Traffic Monitor</h2>
          <p className="text-sm text-muted-foreground">
            Real-time vehicle detection and traffic counting from multiple streams
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {activeStream ? `Detecting: ${activeStream}` : 'Click Detect on a stream to start'}
          </span>
        </div>
      </div>

      {/* Add stream form */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Stream name (e.g., SF Downtown)"
              value={newStreamName}
              onChange={(e) => setNewStreamName(e.target.value)}
              className="flex-1 min-w-0"
            />
            <Input
              placeholder="HLS stream URL (.m3u8)"
              value={newStreamUrl}
              onChange={(e) => setNewStreamUrl(e.target.value)}
              className="flex-1 min-w-0"
            />
            <Button onClick={handleAddStream} disabled={!newStreamName || !newStreamUrl}>
              <Plus className="h-4 w-4 mr-1" />
              Add Stream
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Use direct HLS (.m3u8) URLs with CORS headers. YouTube and other video platform links are not supported in the browser.
          </p>
        </CardContent>
      </Card>

      {/* Stream grid */}
      <div className={cn(
        'grid gap-4',
        streams.length === 1 && 'grid-cols-1',
        streams.length === 2 && 'grid-cols-1 md:grid-cols-2',
        streams.length >= 3 && 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
      )}>
        {streams.map((stream, index) => (
          <div key={`${stream.name}-${index}`} className="relative group">
            <StreamTile
              config={stream}
              detector={detector}
              onError={(name, error) => handleStreamError(name, error)}
              isActive={activeStream === stream.name}
              onToggle={(name, active) => toggleStream(active ? name : '')}
            />
            <button
              onClick={() => handleRemoveStream(index)}
              className={cn(
                'absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity',
                'bg-red-600 text-white rounded-full p-1.5 shadow-lg hover:bg-red-700'
              )}
              aria-label="Remove stream"
            >
              <Trash2 className="h-3 w-3" />
            </button>
            {errors[stream.name] && (
              <div className="mt-1 text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {errors[stream.name]}
              </div>
            )}
          </div>
        ))}
      </div>

      {streams.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p>No streams configured</p>
          <p className="text-sm mt-1">Add a stream above to begin monitoring</p>
        </div>
      )}
    </div>
  );
}

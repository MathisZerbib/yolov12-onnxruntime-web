import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import ScrollGlobe from '@/components/ui/scroll-globe';
import { ROOMS } from '@/lib/globe-markers';
import { ObjectDetector } from '@/lib/object-detector';
import { StreamConfig } from '@/lib/traffic-counter';
import { cn } from '@/lib/utils';
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

interface TrafficMonitorProps {
  detector: ObjectDetector;
  initialStreams?: StreamConfig[];
}

export function TrafficMonitor({ initialStreams }: TrafficMonitorProps) {
  const [streams, setStreams] = useState<StreamConfig[]>(initialStreams || ROOMS.map(r => ({
    name: r.name,
    url: r.streamUrl,
    label: `${r.name} - ${r.location}`,
  })));
  const [newStreamName, setNewStreamName] = useState('');
  const [newStreamUrl, setNewStreamUrl] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeStream, setActiveStream] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

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

  const toggleStream = (name: string) => {
    setActiveStream(prev => prev === name ? null : name);
  };

  const handleMarkerClick = (roomId: string) => {
    setSelectedRoom(roomId);
  };

  const handleCloseOverlay = () => {
    setSelectedRoom(null);
    setActiveStream(null);
  };

  const activeRoom = selectedRoom ? ROOMS.find(r => r.id === selectedRoom) : null;

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
            {activeStream ? `Detecting: ${activeStream}` : 'Click a location on the globe to view stream'}
          </span>
        </div>
      </div>

      {/* Globe */}
      <Card>
        <CardContent className="p-4">
          <ScrollGlobe 
            startScale={0.8} 
            endScale={1.2} 
            scrollRange={500}
            onLocationClick={handleMarkerClick}
          />
        </CardContent>
      </Card>

      {/* Video overlay when a location is selected */}
      {activeRoom && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
          <div className="absolute top-4 right-4 z-50">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCloseOverlay}
              className="bg-background/80 backdrop-blur-sm"
            >
              <X className="h-4 w-4 mr-1" />
              Close
            </Button>
          </div>
          <div className="flex items-center justify-center min-h-screen p-4">
            <div className="w-full max-w-4xl">
              <div className="bg-card rounded-lg p-4">
                <h3 className="text-xl font-bold text-foreground mb-2">
                  {activeRoom.name} - {activeRoom.location}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {activeRoom.viewers.toLocaleString()} viewers
                </p>
                <video
                  src={activeRoom.streamUrl}
                  className="w-full rounded-lg"
                  controls
                  autoPlay
                  muted
                  playsInline
                />
              </div>
            </div>
          </div>
        </div>
      )}

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
            <div className="relative bg-background rounded-lg overflow-hidden border border-border shadow-md">
              <div className="relative aspect-video bg-black">
                <video
                  src={stream.url}
                  className="absolute inset-0 w-full h-full object-contain"
                  muted
                  playsInline
                  autoPlay
                  controls
                />
                
                {/* Stats overlay */}
                <div className="absolute top-0 left-0 right-0 flex justify-between items-center z-10 bg-gradient-to-b from-black/70 to-transparent p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="bg-black/70 backdrop-blur-sm text-white text-xs font-bold px-2 py-0.5 rounded">
                      {stream.label || stream.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-red-600/90 backdrop-blur-sm text-white text-xs font-bold px-2 py-0.5 rounded-md">
                      LIVE
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Controls */}
              <div className="p-2 flex justify-between items-center bg-card">
                <Button
                  onClick={() => toggleStream(stream.name)}
                  size="sm"
                  className="px-3"
                >
                  {activeStream === stream.name ? (
                    <>
                      Stop Detect
                    </>
                  ) : (
                    <>
                      Detect
                    </>
                  )}
                </Button>
                <button
                  onClick={() => handleRemoveStream(index)}
                  className={cn(
                    'bg-red-600 text-white rounded-full p-1.5 shadow-lg hover:bg-red-700',
                    'opacity-0 group-hover:opacity-100 transition-opacity'
                  )}
                  aria-label="Remove stream"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
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
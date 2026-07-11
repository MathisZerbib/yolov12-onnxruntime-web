import ScrollGlobe from '@/components/ui/scroll-globe';
import { BET_TYPES, GAME_CONFIG } from '@/config/game-config';
import { ROOMS } from '@/lib/globe-markers';
import { getSharedDetector, ObjectDetector } from '@/lib/object-detector';
import { ArrowUpRight, Check, ChevronRight, Crosshair, Radio, ShieldCheck } from 'lucide-react';
import { WalletButton } from '@/components/wallet-button';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

export default function LiveTrafficGame() {
  const navigate = useNavigate();
  const detectorRef = useRef<ObjectDetector | null>(null);
  const [detectorReady, setDetectorReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState(ROOMS[0].id);
  const [betTypeId, setBetTypeId] = useState<number>(BET_TYPES[0].id);
  const [targetCount, setTargetCount] = useState(12);
  const [ethAmount, setEthAmount] = useState<number>(GAME_CONFIG.BETTING.MIN_ETH);

  useEffect(() => {
    let cancelled = false;
    getSharedDetector().then((detector) => {
      if (!cancelled) { detectorRef.current = detector; setDetectorReady(true); }
    }).catch(console.error).finally(() => { if (!cancelled) setModelLoading(false); });
    return () => { cancelled = true; detectorRef.current = null; };
  }, []);

  const selectedRoom = ROOMS.find((r) => r.id === selectedRoomId) ?? ROOMS[0];
  const selectedBet = BET_TYPES.find((b) => b.id === betTypeId) ?? BET_TYPES[0];
  const handleOpenRoom = useCallback((roomId: string) => navigate(`/room/${roomId}`), [navigate]);
  const potentialReturn = (ethAmount * selectedBet.mult).toFixed(3);

  return (
    <main className="exchange-shell">
      <nav className="exchange-nav">
        <button className="brand-lockup" onClick={() => navigate('/')} aria-label="Crossflow home">
          <span className="brand-mark"><span /></span>
          <span>CROSSFLOW</span>
        </button>
        <div className="nav-center" aria-label="Main navigation">
          <button className="is-active">Markets</button><Link to="/how-it-works">How it works</Link><Link to="/activity">Activity</Link><Link to="/leaderboard">Leaderboard</Link>
        </div>
        <WalletButton />
      </nav>

      <section className="market-hero">
        <div className="hero-copy">
          <div className="live-chip"><span /> Live prediction market <b>·</b> {ROOMS.length} cameras online</div>
          <h1>The street is<br />the <em>oracle.</em></h1>
          <p>Bet on real-world traffic, resolved by on-device computer vision. Every vehicle. Every crossing. Verifiable on-chain.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => handleOpenRoom(selectedRoomId)}>Enter live market <ArrowUpRight /></button>
            <span><ShieldCheck /> YOLOv12 verified</span>
          </div>
        </div>

        <div className="globe-stage">
          <div className="globe-heading"><span>LIVE WORLD FEED</span><b>{ROOMS.reduce((sum, room) => sum + room.viewers, 0).toLocaleString()} WATCHING</b></div>
          <ScrollGlobe onLocationClick={handleOpenRoom} />
          <div className="globe-caption"><Crosshair /> Drag to explore · Select a signal to enter</div>
        </div>
      </section>

      <section className="market-dock" aria-label="Build your position">
        <div className="dock-header">
          <div><span className="dock-index">01</span><div><h2>Build your position</h2><p>Choose a live feed, set the line, make your call.</p></div></div>
          <div className={`model-status ${detectorReady ? 'ready' : ''}`}><span /> {modelLoading ? 'Warming detector' : detectorReady ? 'Vision oracle ready' : 'Detector unavailable'}</div>
        </div>

        <div className="bet-builder">
          <div className="builder-step stream-picker">
            <label>Camera feed</label>
            <button className="selected-stream" onClick={() => handleOpenRoom(selectedRoomId)}>
              <span className="camera-preview"><Radio /></span>
              <span><b>{selectedRoom.name}</b><small>{selectedRoom.location} · {selectedRoom.viewers.toLocaleString()} live</small></span>
              <ChevronRight />
            </button>
            <div className="room-list">
              {ROOMS.map((room) => <button key={room.id} className={room.id === selectedRoomId ? 'active' : ''} onClick={() => setSelectedRoomId(room.id)}>{room.id === selectedRoomId && <Check />}{room.name}</button>)}
            </div>
          </div>

          <div className="builder-step">
            <label>Market outcome</label>
            <div className="outcome-grid">
              {BET_TYPES.map((type) => <button key={type.id} className={type.id === betTypeId ? 'active' : ''} onClick={() => setBetTypeId(type.id)}><span>{type.name}</span><b>{type.multDisplay}</b><small>{type.description}</small></button>)}
            </div>
          </div>

          <div className="builder-step wager-step">
            <div className="field-row"><label>Target vehicles</label><input type="number" min="0" value={targetCount} onChange={(e) => setTargetCount(Math.max(0, Number(e.target.value)))} /></div>
            <div className="field-row"><label>Stake</label><div className="eth-input"><input aria-label="ETH wager" type="number" step="0.001" value={ethAmount} onChange={(e) => setEthAmount(Math.min(10, Math.max(.001, Number(e.target.value))))} /><span>ETH</span></div></div>
            <div className="quick-stakes">{[.01, .05, .1, .5].map((p) => <button key={p} onClick={() => setEthAmount(p)}>{p}</button>)}</div>
          </div>

          <div className="position-ticket">
            <div><span>Potential return</span><strong>{potentialReturn} <small>ETH</small></strong><p>≈ ${(Number(potentialReturn) * GAME_CONFIG.ETH_USD_PRICE).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p></div>
            <button onClick={() => handleOpenRoom(selectedRoomId)}>Review position <ArrowUpRight /></button>
            <small>By continuing, you accept the market rules.</small>
          </div>
        </div>
      </section>
    </main>
  );
}

import ScrollGlobe from '@/components/ui/scroll-globe';
import { BET_TYPES, GAME_CONFIG } from '@/config/game-config';
import { ROOMS } from '@/lib/globe-markers';
import { getSharedDetector, ObjectDetector } from '@/lib/object-detector';
import { ArrowRight, Radio, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function LiveTrafficGame() {
  const navigate = useNavigate();
  const detectorRef = useRef<ObjectDetector | null>(null);
  const [detectorReady, setDetectorReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(true);

  const [selectedRoomId, setSelectedRoomId] = useState<string>(ROOMS[0].id);
  const [betTypeId, setBetTypeId] = useState<number>(BET_TYPES[0].id);
  const [targetCount, setTargetCount] = useState<number>(12);
  const [ethAmount, setEthAmount] = useState<number>(GAME_CONFIG.BETTING.MIN_ETH);

  useEffect(() => {
    let cancelled = false;
    getSharedDetector()
      .then((detector) => {
        if (cancelled) return;
        detectorRef.current = detector;
        setDetectorReady(true);
      })
      .catch((err) => console.error('Failed to initialize detector:', err))
      .finally(() => {
        if (!cancelled) setModelLoading(false);
      });
    return () => {
      cancelled = true;
      detectorRef.current = null;
    };
  }, []);

  const selectedRoom = ROOMS.find((r) => r.id === selectedRoomId) ?? ROOMS[0];
  const selectedBet = BET_TYPES.find((b) => b.id === betTypeId) ?? BET_TYPES[0];

  const handleOpenRoom = useCallback(
    (roomId: string) => navigate(`/room/${roomId}`),
    [navigate]
  );

  const usdValue = (eth: number) => (eth * GAME_CONFIG.ETH_USD_PRICE).toFixed(2);

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-[#0c111d]">
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(900px 480px at 50% -10%, rgba(13,148,136,0.12), transparent 60%), radial-gradient(700px 420px at 100% 0%, rgba(99,102,241,0.08), transparent 55%)',
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-10">
        {/* Header */}
        <header className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-semibold tracking-[0.18em] uppercase text-emerald-700">
            <Radio className="h-4 w-4 text-emerald-600" />
            Live traffic betting
          </div>
          <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-[-0.02em] text-[#0c111d] text-balance">
            Live Traffic Monitor
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-[#4a5568] text-pretty">
            Real-time YOLOv12 vehicle detection across the world's busiest intersections. Pick a
            live city on the globe, watch the count, and stake your wager — a sharp on-chain game
            of chance on global traffic.
          </p>
        </header>

        {/* Globe (left) + Place your bet (right) side by side */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-7 items-start">
          {/* Globe = main component, with live streams playing on each marker */}
          <section className="relative rounded-3xl border border-slate-200 bg-white shadow-sm p-4 sm:p-8 lg:sticky lg:top-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-[#0c111d]">
                <Radio className="h-4 w-4 text-emerald-600" />
                Global Stream Map
              </h2>
              <div className="flex items-center gap-3">
                <div className="hidden sm:block rounded-xl border border-slate-200 bg-white px-3 py-1.5">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Network</div>
                  <div className="text-sm font-bold text-[#0c111d]">{GAME_CONFIG.NETWORK.NAME}</div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-700">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </div>
                  <div className="text-sm font-bold text-emerald-800">{ROOMS.length} streams</div>
                </div>
              </div>
            </div>
            <ScrollGlobe onLocationClick={handleOpenRoom} />
            <p className="mt-2 text-center text-xs text-slate-500">
              Each marker plays its live camera — click a city to open its betting room.
            </p>
          </section>

          {/* Right column: betting panel + selected stream */}
          <div className="flex flex-col gap-7">
            {/* Betting panel */}
            <aside className="h-fit">
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-center gap-2 mb-5">
                  <span className="grid place-items-center h-8 w-8 rounded-lg bg-emerald-600 text-white">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <h3 className="font-bold text-lg text-[#0c111d]">Place your bet</h3>
                </div>

                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Stream
                </label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0c111d] mb-5 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                >
                  {ROOMS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {r.location}
                    </option>
                  ))}
                </select>

                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Outcome
                </label>
                <div className="grid grid-cols-2 gap-2 mb-5">
                  {BET_TYPES.map((bt) => {
                    const active = bt.id === betTypeId;
                    return (
                      <button
                        key={bt.id}
                        onClick={() => setBetTypeId(bt.id)}
                        className={`rounded-lg border px-3 py-2 text-left transition ${
                          active
                            ? `${bt.borderClass} ${bt.bgClass} ring-2 ${bt.ringSelected}`
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className={`text-sm font-bold ${bt.colorClass}`}>{bt.name}</div>
                        <div className="text-[10px] text-slate-500">{bt.multDisplay}</div>
                      </button>
                    );
                  })}
                </div>

                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Target count · {selectedBet.description}
                </label>
                <input
                  type="number"
                  min={0}
                  value={targetCount}
                  onChange={(e) => setTargetCount(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0c111d] mb-5 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />

                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Wager (ETH)
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="number"
                    step="0.001"
                    min={GAME_CONFIG.BETTING.MIN_ETH}
                    max={GAME_CONFIG.BETTING.MAX_ETH}
                    value={ethAmount}
                    onChange={(e) =>
                      setEthAmount(
                        Math.min(
                          GAME_CONFIG.BETTING.MAX_ETH,
                          Math.max(GAME_CONFIG.BETTING.MIN_ETH, Number(e.target.value))
                        )
                      )
                    }
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0c111d] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                  <span className="text-xs font-medium text-slate-500">${usdValue(ethAmount)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {GAME_CONFIG.BETTING.PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setEthAmount(p)}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
                    >
                      {p} ETH
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => handleOpenRoom(selectedRoomId)}
                  className="group flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white shadow-sm transition hover:bg-emerald-700"
                >
                  Enter {selectedRoom.name} Room
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </button>
                <p className="mt-2 text-center text-[11px] text-slate-500">
                  Win up to {selectedBet.multDisplay} · house edge {(1 - GAME_CONFIG.BETTING.HOUSE_EDGE) * 100}%
                </p>

                <div className="mt-4 flex justify-between text-[10px] text-slate-400">
                  <span>Min: {GAME_CONFIG.BETTING.MIN_ETH} ETH</span>
                  <span>Max: {GAME_CONFIG.BETTING.MAX_ETH} ETH</span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
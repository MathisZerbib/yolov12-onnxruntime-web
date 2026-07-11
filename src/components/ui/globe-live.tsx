"use client"

import { ROOM_MARKERS } from '@/lib/globe-markers'
import createGlobe from 'cobe'
import { useCallback, useEffect, useRef, useState } from 'react'

interface LiveMarker {
  id: string
  location: [number, number]
  href?: string
}

interface GlobeLiveProps {
  markers?: readonly LiveMarker[]
  className?: string
  speed?: number
  glowingMarkerId?: string | null
  onGlowingMarkerChange?: (id: string | null) => void
  onLocationClick?: (locationId: string) => void
}

export function GlobeLive({
  markers = ROOM_MARKERS,
  className = "",
  speed = 0.005,
  glowingMarkerId: externalGlowingMarkerId,
  onGlowingMarkerChange,
  onLocationClick,
}: GlobeLiveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null)
  const dragOffset = useRef({ phi: 0, theta: 0 })
  const phiOffsetRef = useRef(0)
  const thetaOffsetRef = useRef(0)
  const isPausedRef = useRef(false)
  const hoveredRef = useRef(false)
  const [liveViewers, setLiveViewers] = useState(2847)
  const [internalGlowingMarkerId, setInternalGlowingMarkerId] = useState<string | null>(null)

  const glowingMarkerId = externalGlowingMarkerId ?? internalGlowingMarkerId

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveViewers((v) => Math.max(100, v + Math.floor(Math.random() * 21) - 8))
    }, 400)
    return () => clearInterval(interval)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY }
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing"
    isPausedRef.current = true
  }, [])

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi
      thetaOffsetRef.current += dragOffset.current.theta
      dragOffset.current = { phi: 0, theta: 0 }
    }
    pointerInteracting.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = "grab"
    isPausedRef.current = false
  }, [])

  const handleMouseEnter = useCallback(() => {
    hoveredRef.current = true
  }, [])

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = false
  }, [])

  const handleMarkerEnter = useCallback((id: string) => {
    hoveredRef.current = true
    if (!externalGlowingMarkerId) {
      setInternalGlowingMarkerId(id)
    }
    onGlowingMarkerChange?.(id)
  }, [externalGlowingMarkerId, onGlowingMarkerChange])

  const handleMarkerLeave = useCallback(() => {
    hoveredRef.current = false
    if (!externalGlowingMarkerId) {
      setInternalGlowingMarkerId(null)
    }
    onGlowingMarkerChange?.(null)
  }, [externalGlowingMarkerId, onGlowingMarkerChange])

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (pointerInteracting.current !== null) {
        dragOffset.current = {
          phi: (e.clientX - pointerInteracting.current.x) / 300,
          theta: (e.clientY - pointerInteracting.current.y) / 1000,
        }
      }
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("pointerup", handlePointerUp, { passive: true })
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [handlePointerUp])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    let globe: ReturnType<typeof createGlobe> | null = null
    let animationId = 0
    let initAnimationId = 0
    let phi = 0
    let timeoutId: number | undefined
    let disposed = false

    function destroyGlobe() {
      if (initAnimationId) cancelAnimationFrame(initAnimationId)
      if (animationId) cancelAnimationFrame(animationId)
      const instance = globe
      globe = null
      instance?.destroy()

      // Cobe leaves vertex attributes enabled after deleting their buffers.
      // Reusing that WebGL context during React StrictMode/HMR then makes the
      // next draw read a deleted buffer and spam INVALID_OPERATION.
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      if (gl) {
        const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number
        for (let index = 0; index < maxAttributes; index += 1) gl.disableVertexAttribArray(index)
        gl.bindBuffer(gl.ARRAY_BUFFER, null)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
      }
    }

    function init() {
      const width = canvas.offsetWidth
      if (width === 0 || globe) return

      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width, height: width,
        phi: 0, theta: 0.2, dark: 0, diffuse: 1.5,
        mapSamples: 16000, mapBrightness: 10,
        baseColor: [0.95, 0.95, 0.95],
        markerColor: [0.9, 0.2, 0.2],
        glowColor: [0.94, 0.93, 0.91],
        markerElevation: 0.01,
        markers: markers.map((m) => ({ location: m.location, size: 0.02, id: m.id })),
        arcs: [], arcColor: [0.9, 0.3, 0.3],
        arcWidth: 0.5, arcHeight: 0.25, opacity: 0.7,
      })
      function animate() {
        if (disposed || !globe) return
        if (!isPausedRef.current) phi += hoveredRef.current ? speed * 0.6 : speed
        globe.update({
          phi: phi + phiOffsetRef.current + dragOffset.current.phi,
          theta: 0.2 + thetaOffsetRef.current + dragOffset.current.theta,
        })
        animationId = requestAnimationFrame(animate)
      }
      animate()
      timeoutId = window.setTimeout(() => {
        if (canvas) canvas.style.opacity = "1"
      }, 0)
    }

    if (canvas.offsetWidth > 0) {
      // The first development effect is intentionally cleaned up by React
      // StrictMode. Deferring allocation avoids create/destroy/recreate on the
      // same canvas and WebGL context in that probe cycle.
      initAnimationId = requestAnimationFrame(init)
    } else {
      const ro = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.width > 0) {
          ro.disconnect()
          init()
        }
      })
      ro.observe(canvas)

      return () => {
        disposed = true
        ro.disconnect()
        if (timeoutId) window.clearTimeout(timeoutId)
        destroyGlobe()
      }
    }

    return () => {
      disposed = true
      if (timeoutId) window.clearTimeout(timeoutId)
      destroyGlobe()
    }
  }, [markers, speed])

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <style>{`
        @keyframes live-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          width: "100%", height: "100%", cursor: "grab", opacity: 0,
          transition: "opacity 1.2s ease", borderRadius: "50%", touchAction: "none",
        }}
      />
      {markers.map((m, i) => {
        const isClickable = !!m.href
        const isGlowing = glowingMarkerId === m.id
        const label = (
          <>
            <span style={{
              width: 8, height: 8, background: "#ff3b30", borderRadius: "50%",
              boxShadow: "0 0 8px #ff3b30",
              animation: "live-pulse 1.5s ease-in-out infinite",
            }} />
            <span style={{
              fontFamily: "monospace", fontSize: "0.6rem", fontWeight: 600,
              letterSpacing: "0.1em", color: "#ff3b30", textTransform: "uppercase",
            }}>LIVE</span>
            <span style={{
              fontFamily: "system-ui, sans-serif", fontSize: "0.6rem",
              color: "rgba(255,255,255,0.7)", paddingLeft: "0.4rem",
              borderLeft: "1px solid rgba(255,255,255,0.2)",
            }}>
              {Math.floor(liveViewers * (0.3 + 0.7 * Math.pow(0.6, i))).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} watching
            </span>
          </>
        )

        const handleClick = () => {
          if (onLocationClick) {
            onLocationClick(m.id);
          }
        };

        const sharedStyle: Record<string, unknown> = {
          position: "absolute",
          positionAnchor: `--cobe-${m.id}`,
          bottom: "anchor(top)",
          left: "anchor(center)",
          translate: "-50% 0",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.35rem 0.6rem",
          background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)",
          borderRadius: 4,
          boxShadow: isGlowing
            ? "0 0 10px rgba(255, 59, 48, 0.18), 0 0 22px rgba(255, 59, 48, 0.08), 0 4px 12px rgba(0, 0, 0, 0.25)"
            : "0 4px 12px rgba(0, 0, 0, 0.25)",
          whiteSpace: "nowrap",
          opacity: `var(--cobe-visible-${m.id}, 0)`,
          filter: `blur(calc((1 - var(--cobe-visible-${m.id}, 0)) * 8px))`,
          transition: "opacity 0.4s, filter 0.4s, box-shadow 0.4s ease",
          textDecoration: "none",
          pointerEvents: "auto",
          cursor: isClickable ? "pointer" : "default",
          onClick: handleClick,
        }

        if (isClickable && m.href) {
          return (
            <a key={m.id} href={m.href} style={sharedStyle} onMouseEnter={() => handleMarkerEnter(m.id)} onMouseLeave={handleMarkerLeave}>
              {label}
            </a>
          )
        }

        return (
          <div key={m.id} style={sharedStyle} onMouseEnter={() => handleMarkerEnter(m.id)} onMouseLeave={handleMarkerLeave}>
            {label}
          </div>
        )
      })}
    </div>
  )
}

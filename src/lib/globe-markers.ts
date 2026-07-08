export interface LiveMarker {
  id: string
  location: [number, number]
  href?: string
}

export interface GenericMarker {
  location: [number, number]
  size: number
}

export interface Room {
  id: string
  name: string
  location: string
  viewers: number
  streamUrl: string
}

export const ROOM_MARKERS: readonly LiveMarker[] = Object.freeze([
  { id: "tokyo", location: [35.68, 139.65], href: "/room/tokyo" },
  { id: "sydney", location: [-33.87, 151.21], href: "/room/sydney" },
  { id: "sf", location: [37.78, -122.44], href: "/room/sf" },
  { id: "paris", location: [48.86, 2.35], href: "/room/paris" },
  { id: "nyc", location: [40.71, -74.01], href: "/room/nyc" },
  { id: "london", location: [51.51, -0.13], href: "/room/london" },
])

export const GENERIC_MARKERS: readonly GenericMarker[] = Object.freeze([
  { location: [14.5995, 120.9842], size: 0.03 },
  { location: [19.076, 72.8777], size: 0.1 },
  { location: [23.8103, 90.4125], size: 0.05 },
  { location: [30.0444, 31.2357], size: 0.07 },
  { location: [39.9042, 116.4074], size: 0.08 },
  { location: [-23.5505, -46.6333], size: 0.1 },
  { location: [19.4326, -99.1332], size: 0.1 },
])

export const ROOMS: readonly Room[] = Object.freeze([
  { id: "tokyo",  name: "Tokyo",         location: "Shibuya",        viewers: 1567, streamUrl: "https://wlbt-wowza.streamguys1.com/live/byram.stream/chunks.m3u8" },
  { id: "sydney", name: "Sydney",        location: "CBD",            viewers: 892,  streamUrl: "https://live.field59.com/klkn/klkn9/chunklist.m3u8" },
  { id: "sf",     name: "San Francisco", location: "Market St",      viewers: 1284, streamUrl: "https://media-hls-az1.wral.com/livehttporigin/_definst_/mp4:chapel_hill_cam.stream/chunklist.m3u8" },
  { id: "paris",  name: "Paris",         location: "Champs-Élysées", viewers: 743,  streamUrl: "https://s87.ipcamlive.com/streams_storage/57xme5tijy8v39x1b/stream.m3u8" },
  { id: "nyc",    name: "New York",      location: "Times Square",   viewers: 1102, streamUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
  { id: "london", name: "London",        location: "Oxford St",      viewers: 1342, streamUrl: "https://test-streams.mux.dev/dai-discontinuity-deltatre/dai-discontinuity-deltatre.m3u8" },
])

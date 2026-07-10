export interface LiveMarker {
  id: string
  name: string
  locationLabel: string
  location: [number, number]
  href?: string
  streamUrl: string
}

export interface Room {
  id: string
  name: string
  location: string
  viewers: number
  streamUrl: string
}

export const ROOM_MARKERS: readonly LiveMarker[] = Object.freeze([
  { id: "tokyo",  name: "Tokyo",  locationLabel: "Shibuya",       location: [35.68, 139.65],  href: "/room/tokyo",  streamUrl: "https://wlbt-wowza.streamguys1.com/live/byram.stream/chunks.m3u8" },
  { id: "sydney", name: "Sydney", locationLabel: "CBD",           location: [-33.87, 151.21], href: "/room/sydney", streamUrl: "https://live.field59.com/klkn/klkn9/chunklist.m3u8" },
  { id: "sf",     name: "San Francisco", locationLabel: "Market St", location: [37.78, -122.44], href: "/room/sf",  streamUrl: "https://media-hls-az1.wral.com/livehttporigin/_definst_/mp4:chapel_hill_cam.stream/chunklist.m3u8" },
  { id: "paris",  name: "Paris",  locationLabel: "Champs-Élysées", location: [48.86, 2.35],    href: "/room/paris", streamUrl: "https://s87.ipcamlive.com/streams_storage/57xme5tijy8v39x1b/stream.m3u8" },
  { id: "nyc",    name: "New York", locationLabel: "Times Square", location: [40.71, -74.01],  href: "/room/nyc",   streamUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
  { id: "london", name: "London", locationLabel: "Oxford St",     location: [51.51, -0.13],    href: "/room/london", streamUrl: "https://test-streams.mux.dev/pts_shift/master.m3u8" },
])

// ROOMS dérivé de ROOM_MARKERS pour éviter la duplication des streamUrls et names
export const ROOMS: readonly Room[] = Object.freeze(
  ROOM_MARKERS.map((m, i) => ({
    id: m.id,
    name: m.name,
    location: m.locationLabel,
    streamUrl: m.streamUrl,
    viewers: [1567, 892, 1284, 743, 1102, 1342][i],
  }))
)
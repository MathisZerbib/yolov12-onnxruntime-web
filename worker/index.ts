import { encodeAbiParameters, getAddress, isAddress, keccak256, toBytes, verifyMessage, type Hex } from 'viem';
import { createSiweMessage, parseSiweMessage } from 'viem/siwe';
import { readRoomMarketState } from './market-rounds';
export { RoomCoordinator } from './room-coordinator';
export { MarketScheduler } from './market-rounds';

const CHAIN_ID = 421614;
const NONCE_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const AUTH_PURPOSE = 'Authenticate to Crossflow. This request never authorizes a transaction or transfer.';
const ROOM_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const PLATFORM_ADMIN_ADDRESS = '0x2a1f44ce3759b8624ad8b5828efee2dd370dca1e';

interface StoredDetectionZone {
  room_id: string;
  top_left_x_bps: number;
  top_left_y_bps: number;
  top_right_x_bps: number;
  top_right_y_bps: number;
  bottom_right_x_bps: number;
  bottom_right_y_bps: number;
  bottom_left_x_bps: number;
  bottom_left_y_bps: number;
  version: number;
  updated_by: string;
  updated_at: number;
}

interface DetectionZoneInput {
  topLeftXBps?: number;
  topLeftYBps?: number;
  topRightXBps?: number;
  topRightYBps?: number;
  bottomRightXBps?: number;
  bottomRightYBps?: number;
  bottomLeftXBps?: number;
  bottomLeftYBps?: number;
  expectedVersion?: number;
}

function roomKey(roomId: string): Hex {
  return keccak256(toBytes(roomId));
}

function zoneConfigHash(roomId: string, zone: StoredDetectionZone): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint16[8]' }],
    [roomKey(roomId), [zone.top_left_x_bps, zone.top_left_y_bps, zone.top_right_x_bps, zone.top_right_y_bps,
      zone.bottom_right_x_bps, zone.bottom_right_y_bps, zone.bottom_left_x_bps, zone.bottom_left_y_bps]],
  ));
}

function publicZone(zone: StoredDetectionZone) {
  return {
    roomId: zone.room_id,
    roomKey: roomKey(zone.room_id),
    topLeftXBps: zone.top_left_x_bps,
    topLeftYBps: zone.top_left_y_bps,
    topRightXBps: zone.top_right_x_bps,
    topRightYBps: zone.top_right_y_bps,
    bottomRightXBps: zone.bottom_right_x_bps,
    bottomRightYBps: zone.bottom_right_y_bps,
    bottomLeftXBps: zone.bottom_left_x_bps,
    bottomLeftYBps: zone.bottom_left_y_bps,
    version: zone.version,
    configHash: zoneConfigHash(zone.room_id, zone),
    updatedBy: getAddress(zone.updated_by),
    updatedAt: zone.updated_at,
  };
}

async function getDetectionZone(env: Env, roomId: string): Promise<StoredDetectionZone | null> {
  return env.DB.prepare('SELECT room_id,top_left_x_bps,top_left_y_bps,top_right_x_bps,top_right_y_bps,bottom_right_x_bps,bottom_right_y_bps,bottom_left_x_bps,bottom_left_y_bps,version,updated_by,updated_at FROM room_detection_zones WHERE room_id=?1 LIMIT 1')
    .bind(roomId).first<StoredDetectionZone>();
}

function validZoneInput(zone: DetectionZoneInput): zone is Required<DetectionZoneInput> {
  const values = [zone.topLeftXBps, zone.topLeftYBps, zone.topRightXBps, zone.topRightYBps, zone.bottomRightXBps,
    zone.bottomRightYBps, zone.bottomLeftXBps, zone.bottomLeftYBps, zone.expectedVersion];
  if (!values.every(value => Number.isSafeInteger(value))) return false;
  const z = zone as Required<DetectionZoneInput>;
  const coordinates = values.slice(0, 8) as number[];
  return z.expectedVersion >= 0 && coordinates.every(value => value >= 0 && value <= 10_000) &&
    z.topLeftXBps < z.topRightXBps && z.bottomLeftXBps < z.bottomRightXBps &&
    z.topLeftYBps < z.bottomLeftYBps && z.topRightYBps < z.bottomRightYBps;
}

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('cache-control', 'no-store');
  responseHeaders.set('x-content-type-options', 'nosniff');
  responseHeaders.set('referrer-policy', 'no-referrer');
  return Response.json(data, { status, headers: responseHeaders });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

async function sha256(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function cookieValue(request: Request, name: string): string | null {
  const match = request.headers.get('cookie')?.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionCookieName(env: Env): string {
  return String(env.ENVIRONMENT) === 'production' ? '__Host-crossflow_session' : 'crossflow_session';
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('origin');
  return origin === env.APP_ORIGIN ? {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type,x-room-lease',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'vary': 'Origin',
  } : {};
}

function assertOrigin(request: Request, env: Env): boolean {
  return request.headers.get('origin') === env.APP_ORIGIN;
}

async function sessionAddress(request: Request, env: Env): Promise<string | null> {
  const token = cookieValue(request, sessionCookieName(env));
  if (!token) return null;
  const row = await env.DB.prepare('SELECT address FROM auth_sessions WHERE token_hash = ?1 AND expires_at > ?2 LIMIT 1')
    .bind(await sha256(token), Math.floor(Date.now() / 1000)).first<{ address: string }>();
  return row?.address ?? null;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);

    try {
      if (url.pathname === '/auth/nonce' && request.method === 'POST') {
        if (!assertOrigin(request, env)) return json({ error: 'Invalid origin' }, 403, cors);
        const body = await request.json<{ address?: string; chainId?: number }>();
        if (!body.address || !isAddress(body.address) || body.chainId !== CHAIN_ID) return json({ error: 'Invalid wallet or chain' }, 400, cors);
        const address = getAddress(body.address);
        const nonce = randomToken(16);
        const now = Math.floor(Date.now() / 1000);
        const clientKey = await sha256(request.headers.get('cf-connecting-ip') ?? 'local');
        const windowStart = now - now % 60;
        await env.DB.prepare('INSERT INTO auth_rate_limits(client_key,window_start,request_count) VALUES(?1,?2,1) ON CONFLICT(client_key,window_start) DO UPDATE SET request_count=request_count+1').bind(clientKey, windowStart).run();
        const rate = await env.DB.prepare('SELECT request_count FROM auth_rate_limits WHERE client_key=?1 AND window_start=?2').bind(clientKey, windowStart).first<{ request_count: number }>();
        if ((rate?.request_count ?? 0) > 30) return json({ error: 'Too many authentication requests' }, 429, { ...cors, 'retry-after': '60' });
        const expiresAt = now + NONCE_TTL_SECONDS;
        const origin = new URL(env.APP_ORIGIN);
        const message = createSiweMessage({
          domain: origin.host, address, chainId: CHAIN_ID, nonce,
          uri: env.APP_ORIGIN, version: '1',
          statement: AUTH_PURPOSE,
          issuedAt: new Date(now * 1000), expirationTime: new Date(expiresAt * 1000),
          resources: [`urn:crossflow:auth:${CHAIN_ID}`],
        });
        await env.DB.prepare('INSERT INTO auth_nonces (nonce,address,chain_id,domain,issued_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6)')
          .bind(nonce, address.toLowerCase(), CHAIN_ID, origin.host, now, expiresAt).run();
        return json({ message, expiresAt }, 200, cors);
      }

      if (url.pathname === '/auth/verify' && request.method === 'POST') {
        if (!assertOrigin(request, env)) return json({ error: 'Invalid origin' }, 403, cors);
        const body = await request.json<{ message?: string; signature?: Hex }>();
        if (!body.message || !body.signature) return json({ error: 'Missing signature' }, 400, cors);
        const parsed = parseSiweMessage(body.message);
        if (!parsed.nonce || !parsed.address || !parsed.domain || parsed.chainId !== CHAIN_ID) return json({ error: 'Malformed SIWE message' }, 400, cors);
        const row = await env.DB.prepare('SELECT address,chain_id,domain,issued_at,expires_at,used_at FROM auth_nonces WHERE nonce = ?1 LIMIT 1')
          .bind(parsed.nonce).first<{ address: string; chain_id: number; domain: string; issued_at: number; expires_at: number; used_at: number | null }>();
        const now = Math.floor(Date.now() / 1000);
        if (!row || row.used_at || row.expires_at <= now || row.chain_id !== CHAIN_ID || row.domain !== parsed.domain || row.address !== parsed.address.toLowerCase())
          return json({ error: 'Challenge expired or invalid' }, 401, cors);
        const origin = new URL(env.APP_ORIGIN);
        if (parsed.domain !== origin.host || parsed.uri !== env.APP_ORIGIN || parsed.statement !== AUTH_PURPOSE ||
            !parsed.resources?.includes(`urn:crossflow:auth:${CHAIN_ID}`) ||
            parsed.issuedAt?.getTime() !== row.issued_at * 1000 || parsed.expirationTime?.getTime() !== row.expires_at * 1000)
          return json({ error: 'Cross-domain replay rejected' }, 401, cors);
        const valid = await verifyMessage({ address: getAddress(parsed.address), message: body.message, signature: body.signature });
        if (!valid) return json({ error: 'Invalid signature' }, 401, cors);

        const consumed = await env.DB.prepare('UPDATE auth_nonces SET used_at = ?1 WHERE nonce = ?2 AND used_at IS NULL AND expires_at > ?1')
          .bind(now, parsed.nonce).run();
        if (consumed.meta.changes !== 1) return json({ error: 'Nonce already used' }, 409, cors);
        const token = randomToken();
        await env.DB.batch([
          env.DB.prepare('DELETE FROM auth_sessions WHERE address=?1 OR expires_at<=?2').bind(row.address, now),
          env.DB.prepare('DELETE FROM auth_nonces WHERE expires_at<=?1').bind(now),
          env.DB.prepare('DELETE FROM auth_rate_limits WHERE window_start<?1').bind(now - 3600),
          env.DB.prepare('INSERT INTO auth_sessions (token_hash,address,chain_id,created_at,expires_at) VALUES (?1,?2,?3,?4,?5)').bind(await sha256(token), row.address, CHAIN_ID, now, now + SESSION_TTL_SECONDS),
        ]);
        const secure = String(env.ENVIRONMENT) === 'production' ? '; Secure' : '';
        return json({ address: getAddress(row.address), chainId: CHAIN_ID }, 200, {
          ...cors, 'set-cookie': `${sessionCookieName(env)}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
        });
      }

      if (url.pathname === '/auth/session' && request.method === 'GET') {
        const address = await sessionAddress(request, env);
        return address ? json({ authenticated: true, address: getAddress(address), chainId: CHAIN_ID }, 200, cors) : json({ authenticated: false }, 401, cors);
      }

      if (url.pathname === '/profile' && request.method === 'GET') {
        const address = await sessionAddress(request, env);
        if (!address) return json({ error: 'Authentication required' }, 401, cors);
        const summary = await env.DB.prepare("SELECT COUNT(*) manifests, COALESCE(SUM(CAST(json_extract(payload,'$.finalVehicleCount') AS INTEGER)),0) vehicles, COUNT(DISTINCT room_id) rooms FROM inference_manifests WHERE address=?1").bind(address).first<{ manifests: number; vehicles: number; rooms: number }>();
        const recent = await env.DB.prepare('SELECT room_id,created_at,manifest_sha256 FROM inference_manifests WHERE address=?1 ORDER BY created_at DESC LIMIT 20').bind(address).all();
        return json({ address: getAddress(address), manifests: summary?.manifests ?? 0, vehiclesVerified: summary?.vehicles ?? 0, roomsOperated: summary?.rooms ?? 0, recent: recent.results }, 200, cors);
      }

      if (url.pathname === '/leaderboard' && request.method === 'GET') {
        const rows = await env.DB.prepare("SELECT address,COUNT(*) proofs,COALESCE(SUM(CAST(json_extract(payload,'$.finalVehicleCount') AS INTEGER)),0) vehicles,COUNT(DISTINCT room_id) rooms FROM inference_manifests GROUP BY address ORDER BY proofs DESC,vehicles DESC LIMIT 100").all();
        return json(rows.results, 200, cors);
      }

      if (url.pathname === '/activity' && request.method === 'GET') {
        const rows = await env.DB.prepare("SELECT id,address,room_id,manifest_sha256,created_at,CAST(json_extract(payload,'$.finalVehicleCount') AS INTEGER) vehicles FROM inference_manifests ORDER BY created_at DESC LIMIT 100").all();
        return json(rows.results, 200, cors);
      }

      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        if (!assertOrigin(request, env)) return json({ error: 'Invalid origin' }, 403, cors);
        const token = cookieValue(request, sessionCookieName(env));
        if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?1').bind(await sha256(token)).run();
        const secure = String(env.ENVIRONMENT) === 'production' ? '; Secure' : '';
        return json({ ok: true }, 200, { ...cors, 'set-cookie': `${sessionCookieName(env)}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0` });
      }

      const roomMarket = url.pathname.match(/^\/rooms\/([a-z0-9-]{1,64})\/market$/);
      if (roomMarket && request.method === 'GET') {
        const state = await readRoomMarketState(env, roomMarket[1]);
        if (state.enabled && state.phase !== 'open') {
          ctx.waitUntil(env.MARKET_SCHEDULER.getByName('market-operator').reconcile());
        }
        return json(state, 200, cors);
      }

      const roomZone = url.pathname.match(/^\/rooms\/([a-z0-9-]{1,64})\/zone$/);
      if (roomZone) {
        const roomId = roomZone[1];
        if (request.method === 'GET') {
          const zone = await getDetectionZone(env, roomId);
          return zone ? json(publicZone(zone), 200, cors) : json({ error: 'Detection zone is not configured' }, 404, cors);
        }
        if (request.method === 'PUT') {
          if (!assertOrigin(request, env)) return json({ error: 'Invalid origin' }, 403, cors);
          const address = await sessionAddress(request, env);
          if (!address) return json({ error: 'Authentication required' }, 401, cors);
          if (address.toLowerCase() !== PLATFORM_ADMIN_ADDRESS) return json({ error: 'Only the platform admin can change detection zones' }, 403, cors);
          const declaredLength = Number(request.headers.get('content-length') ?? 0);
          if (declaredLength > 4_096) return json({ error: 'Zone configuration is too large' }, 413, cors);
          let input: DetectionZoneInput;
          try {
            input = await request.json<DetectionZoneInput>();
          } catch {
            return json({ error: 'Malformed zone configuration' }, 400, cors);
          }
          if (!validZoneInput(input)) return json({ error: 'Zone must be a valid four-corner trapezoid' }, 400, cors);

          const now = Math.floor(Date.now() / 1000);
          const current = await getDetectionZone(env, roomId);
          if ((current?.version ?? 0) !== input.expectedVersion) return json({ error: 'Zone changed; reload before saving', current: current ? publicZone(current) : null }, 409, cors);
          const values = [input.topLeftXBps, input.topLeftYBps, input.topRightXBps, input.topRightYBps,
            input.bottomRightXBps, input.bottomRightYBps, input.bottomLeftXBps, input.bottomLeftYBps,
            PLATFORM_ADMIN_ADDRESS, now] as const;
          const mutation = current
            ? await env.DB.prepare('UPDATE room_detection_zones SET top_left_x_bps=?1,top_left_y_bps=?2,top_right_x_bps=?3,top_right_y_bps=?4,bottom_right_x_bps=?5,bottom_right_y_bps=?6,bottom_left_x_bps=?7,bottom_left_y_bps=?8,version=version+1,updated_by=?9,updated_at=?10 WHERE room_id=?11 AND version=?12')
              .bind(...values, roomId, input.expectedVersion).run()
            : await env.DB.prepare('INSERT INTO room_detection_zones (room_id,x1_bps,y1_bps,x2_bps,y2_bps,top_left_x_bps,top_left_y_bps,top_right_x_bps,top_right_y_bps,bottom_right_x_bps,bottom_right_y_bps,bottom_left_x_bps,bottom_left_y_bps,counting_line_y_bps,version,updated_by,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,1,?15,?16)')
              .bind(roomId,
                Math.min(input.topLeftXBps, input.bottomLeftXBps), Math.min(input.topLeftYBps, input.topRightYBps),
                Math.max(input.topRightXBps, input.bottomRightXBps), Math.max(input.bottomLeftYBps, input.bottomRightYBps),
                input.topLeftXBps, input.topLeftYBps, input.topRightXBps, input.topRightYBps,
                input.bottomRightXBps, input.bottomRightYBps, input.bottomLeftXBps, input.bottomLeftYBps,
                Math.round((Math.max(input.topLeftYBps, input.topRightYBps) + Math.min(input.bottomLeftYBps, input.bottomRightYBps)) / 2), PLATFORM_ADMIN_ADDRESS, now).run();
          if (mutation.meta.changes !== 1) return json({ error: 'Concurrent zone update rejected' }, 409, cors);
          const updated = await getDetectionZone(env, roomId);
          return json(publicZone(updated!), current ? 200 : 201, cors);
        }
        return json({ error: 'Method not allowed' }, 405, { ...cors, allow: 'GET, PUT' });
      }

      const roomLease = url.pathname.match(/^\/rooms\/([a-z0-9-]{1,64})\/lease$/);
      if (roomLease) {
        if (!assertOrigin(request, env)) return json({ error: 'Invalid origin' }, 403, cors);
        const address = await sessionAddress(request, env);
        if (!address) return json({ error: 'Authentication required' }, 401, cors);
        const coordinator = env.ROOMS.getByName(roomLease[1]);
        if (request.method === 'POST') {
          const token = randomToken();
          const result = await coordinator.acquire(address, await sha256(token));
          return result.acquired ? json({ ...result, leaseToken: token }, 201, cors) : json(result, 409, cors);
        }
        if (request.method === 'DELETE') {
          const token = request.headers.get('x-room-lease');
          if (!token) return json({ error: 'Missing lease' }, 400, cors);
          return json({ released: await coordinator.release(address, await sha256(token)) }, 200, cors);
        }
        if (request.method === 'GET') return json(await coordinator.status(), 200, cors);
      }

      if (url.pathname === '/inference/manifests' && request.method === 'POST') {
        if (!assertOrigin(request, env)) return json({ error: 'Invalid origin' }, 403, cors);
        const address = await sessionAddress(request, env);
        if (!address) return json({ error: 'Authentication required' }, 401, cors);
        const declaredLength = Number(request.headers.get('content-length') ?? 0);
        if (declaredLength > 32_768) return json({ error: 'Manifest too large' }, 413, cors);
        const payload = await request.text();
        if (payload.length > 32_768) return json({ error: 'Manifest too large' }, 413, cors);
        let manifest: { version?: number; purpose?: string; roomId?: string; finalVehicleCount?: number; startedAt?: string; completedAt?: string; model?: { sha256?: string; executionProvider?: string; inputSize?: number[] }; zone?: { version?: number; roomKey?: string; configHash?: string; topLeftXBps?: number; topLeftYBps?: number; topRightXBps?: number; topRightYBps?: number; bottomRightXBps?: number; bottomRightYBps?: number; bottomLeftXBps?: number; bottomLeftYBps?: number } };
        try {
          manifest = JSON.parse(payload) as typeof manifest;
        } catch {
          return json({ error: 'Malformed proof manifest' }, 400, cors);
        }
        const startedAt = Date.parse(manifest.startedAt ?? '');
        const completedAt = Date.parse(manifest.completedAt ?? '');
        const validWindow = Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt && completedAt - startedAt <= 120_000 && Math.abs(Date.now() - completedAt) <= 60_000;
        const validModel = manifest.model?.sha256 === env.APPROVED_MODEL_SHA256 && ['webgpu', 'wasm'].includes(manifest.model.executionProvider ?? '') && manifest.model.inputSize?.[0] === 640 && manifest.model.inputSize?.[1] === 640;
        if (manifest.version !== 3 || manifest.purpose !== 'crossflow-market-resolution' || !manifest.roomId || !ROOM_ID_PATTERN.test(manifest.roomId) || !validModel || !validWindow || !Number.isSafeInteger(manifest.finalVehicleCount) || Number(manifest.finalVehicleCount) < 0 || Number(manifest.finalVehicleCount) > 1_000_000) return json({ error: 'Invalid or unapproved proof manifest' }, 400, cors);
        const configuredZone = await getDetectionZone(env, manifest.roomId);
        if (!configuredZone) return json({ error: 'Detection zone is not configured' }, 409, cors);
        const approvedZone = publicZone(configuredZone);
        const submittedZone = manifest.zone;
        if (!submittedZone || submittedZone.version !== approvedZone.version || submittedZone.roomKey !== approvedZone.roomKey || submittedZone.configHash !== approvedZone.configHash ||
            submittedZone.topLeftXBps !== approvedZone.topLeftXBps || submittedZone.topLeftYBps !== approvedZone.topLeftYBps ||
            submittedZone.topRightXBps !== approvedZone.topRightXBps || submittedZone.topRightYBps !== approvedZone.topRightYBps ||
            submittedZone.bottomRightXBps !== approvedZone.bottomRightXBps || submittedZone.bottomRightYBps !== approvedZone.bottomRightYBps ||
            submittedZone.bottomLeftXBps !== approvedZone.bottomLeftXBps || submittedZone.bottomLeftYBps !== approvedZone.bottomLeftYBps)
          return json({ error: 'Stale or unauthorized detection zone' }, 409, cors);
        const leaseToken = request.headers.get('x-room-lease');
        const coordinator = env.ROOMS.getByName(manifest.roomId);
        if (!leaseToken || !await coordinator.verify(address, await sha256(leaseToken))) return json({ error: 'Room lease is missing or expired' }, 409, cors);
        const id = crypto.randomUUID();
        const digest = await sha256(payload);
        const inserted = await env.DB.prepare('INSERT INTO inference_manifests (id,address,room_id,model_sha256,manifest_sha256,payload,created_at) SELECT ?1,?2,?3,?4,?5,?6,?7 FROM room_detection_zones WHERE room_id=?3 AND version=?8 AND top_left_x_bps=?9 AND top_left_y_bps=?10 AND top_right_x_bps=?11 AND top_right_y_bps=?12 AND bottom_right_x_bps=?13 AND bottom_right_y_bps=?14 AND bottom_left_x_bps=?15 AND bottom_left_y_bps=?16')
          .bind(id, address, manifest.roomId, env.APPROVED_MODEL_SHA256, digest, payload, Math.floor(Date.now() / 1000), approvedZone.version,
            approvedZone.topLeftXBps, approvedZone.topLeftYBps, approvedZone.topRightXBps, approvedZone.topRightYBps,
            approvedZone.bottomRightXBps, approvedZone.bottomRightYBps, approvedZone.bottomLeftXBps, approvedZone.bottomLeftYBps).run();
        if (inserted.meta.changes !== 1) return json({ error: 'Detection zone changed while the proof was being verified' }, 409, cors);
        return json({ id, sha256: digest }, 201, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_error', path: url.pathname, error: error instanceof Error ? error.message : 'unknown' }));
      return json({ error: 'Request failed' }, 500, cors);
    }
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    const scheduler = env.MARKET_SCHEDULER.getByName('market-operator');
    ctx.waitUntil(scheduler.reconcile());
  },
} satisfies ExportedHandler<Env>;

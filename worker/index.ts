import { getAddress, isAddress, verifyMessage, type Hex } from 'viem';
import { createSiweMessage, parseSiweMessage } from 'viem/siwe';
export { RoomCoordinator } from './room-coordinator';

const CHAIN_ID = 421614;
const NONCE_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const AUTH_PURPOSE = 'Authenticate to Crossflow. This request never authorizes a transaction or transfer.';

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers });
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

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('origin');
  return origin === env.APP_ORIGIN ? {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type,x-room-lease',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'vary': 'Origin',
  } : {};
}

function assertOrigin(request: Request, env: Env): boolean {
  return request.headers.get('origin') === env.APP_ORIGIN;
}

async function sessionAddress(request: Request, env: Env): Promise<string | null> {
  const token = cookieValue(request, 'crossflow_session');
  if (!token) return null;
  const row = await env.DB.prepare('SELECT address FROM auth_sessions WHERE token_hash = ?1 AND expires_at > ?2 LIMIT 1')
    .bind(await sha256(token), Math.floor(Date.now() / 1000)).first<{ address: string }>();
  return row?.address ?? null;
}

export default {
  async fetch(request, env): Promise<Response> {
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
        await env.DB.prepare('INSERT INTO auth_sessions (token_hash,address,chain_id,created_at,expires_at) VALUES (?1,?2,?3,?4,?5)')
          .bind(await sha256(token), row.address, CHAIN_ID, now, now + SESSION_TTL_SECONDS).run();
        const secure = env.ENVIRONMENT === 'production' ? '; Secure' : '';
        return json({ address: getAddress(row.address), chainId: CHAIN_ID }, 200, {
          ...cors, 'set-cookie': `crossflow_session=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
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
        const token = cookieValue(request, 'crossflow_session');
        if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?1').bind(await sha256(token)).run();
        return json({ ok: true }, 200, { ...cors, 'set-cookie': 'crossflow_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
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
        const payload = await request.text();
        if (payload.length > 32_768) return json({ error: 'Manifest too large' }, 413, cors);
        const manifest = JSON.parse(payload) as { roomId?: string; finalVehicleCount?: number; startedAt?: string; completedAt?: string; model?: { sha256?: string; executionProvider?: string } };
        if (!manifest.roomId || manifest.model?.sha256 !== env.APPROVED_MODEL_SHA256 || !Number.isSafeInteger(manifest.finalVehicleCount) || Number(manifest.finalVehicleCount) < 0) return json({ error: 'Invalid or unapproved proof manifest' }, 400, cors);
        const leaseToken = request.headers.get('x-room-lease');
        const coordinator = env.ROOMS.getByName(manifest.roomId);
        if (!leaseToken || !await coordinator.verify(address, await sha256(leaseToken))) return json({ error: 'Room lease is missing or expired' }, 409, cors);
        const id = crypto.randomUUID();
        const digest = await sha256(payload);
        await env.DB.prepare('INSERT INTO inference_manifests (id,address,room_id,model_sha256,manifest_sha256,payload,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)')
          .bind(id, address, manifest.roomId, env.APPROVED_MODEL_SHA256, digest, payload, Math.floor(Date.now() / 1000)).run();
        return json({ id, sha256: digest }, 201, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_error', path: url.pathname, error: error instanceof Error ? error.message : 'unknown' }));
      return json({ error: 'Request failed' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;

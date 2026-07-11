import { DurableObject } from 'cloudflare:workers';

const LEASE_MS = 120_000;

export class RoomCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS lease (singleton INTEGER PRIMARY KEY CHECK(singleton=1), address TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    });
  }

  async acquire(address: string, tokenHash: string): Promise<{ acquired: boolean; expiresAt: number; operator?: string }> {
    const now = Date.now();
    const current = this.ctx.storage.sql.exec<{ address: string; expires_at: number }>('SELECT address, expires_at FROM lease WHERE singleton=1').toArray()[0] ?? null;
    if (current && current.expires_at > now && current.address !== address) return { acquired: false, expiresAt: current.expires_at, operator: current.address };
    const expiresAt = now + LEASE_MS;
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO lease(singleton,address,token_hash,expires_at) VALUES(1,?,?,?)', address, tokenHash, expiresAt);
    await this.ctx.storage.setAlarm(expiresAt);
    return { acquired: true, expiresAt };
  }

  verify(address: string, tokenHash: string): boolean {
    const lease = this.ctx.storage.sql.exec<{ address: string; token_hash: string; expires_at: number }>('SELECT address,token_hash,expires_at FROM lease WHERE singleton=1').toArray()[0] ?? null;
    return Boolean(lease && lease.address === address && lease.token_hash === tokenHash && lease.expires_at > Date.now());
  }

  release(address: string, tokenHash: string): boolean {
    const result = this.ctx.storage.sql.exec('DELETE FROM lease WHERE singleton=1 AND address=? AND token_hash=?', address, tokenHash);
    return result.rowsWritten === 1;
  }

  status(): { occupied: boolean; operator?: string; expiresAt?: number } {
    const lease = this.ctx.storage.sql.exec<{ address: string; expires_at: number }>('SELECT address,expires_at FROM lease WHERE singleton=1').toArray()[0] ?? null;
    if (!lease || lease.expires_at <= Date.now()) return { occupied: false };
    return { occupied: true, operator: lease.address, expiresAt: lease.expires_at };
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM lease WHERE expires_at <= ?', Date.now());
  }
}

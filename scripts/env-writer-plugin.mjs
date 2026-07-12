import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite dev-server middleware that writes/updates env variables from the browser.
 *
 * The contract deployment panel (/admin/contracts) runs in the browser and cannot
 * write directly to the developer's .env file. This plugin exposes a local-only
 * POST endpoint consumed by the deployment panel so that freshly deployed
 * contract values are persisted to the configured env file automatically.
 *
 * It only runs in `serve` (dev) mode and never touches anything outside the
 * explicitly allowed keys passed by the caller, preserving every other line.
 */
export function envWriterPlugin(options = {}) {
  const targetFile = options.envFile || '.env.development.local';
  const envPath = path.resolve(__dirname, '..', targetFile);

  function updateEnvFile(updates) {
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const lines = content.split(/\r?\n/);
    const seen = new Set();
    const out = [];
    for (const line of lines) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && Object.prototype.hasOwnProperty.call(updates, match[1])) {
        out.push(`${match[1]}=${updates[match[1]]}`);
        seen.add(match[1]);
      } else {
        out.push(line);
      }
    }
    for (const [key, value] of Object.entries(updates)) {
      if (!seen.has(key)) out.push(`${key}=${value}`);
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push('');
    fs.writeFileSync(envPath, out.join('\n'));
  }

  return {
    name: 'crossflow-env-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__crossflow_update_env', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const updates = JSON.parse(body || '{}');
            if (!updates || typeof updates !== 'object') {
              throw new Error('Payload must be a JSON object of env key/values');
            }
            updateEnvFile(updates);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, file: envPath }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(error) }));
          }
        });
      });
    },
  };
}
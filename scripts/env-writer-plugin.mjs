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
    const operatorKeyPath = path.resolve(__dirname, '..', '.dev.operator.key');

  function updateEnvFile(updates) {
    // Skip MARKET_OPERATOR_PRIVATE_KEY for .env files to avoid Vite reload
    const viteUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => key !== 'MARKET_OPERATOR_PRIVATE_KEY')
    );
    if (Object.keys(viteUpdates).length === 0) return;
    
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const lines = content.split(/\r?\n/);
    const seen = new Set();
    const out = [];
    for (const line of lines) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && Object.prototype.hasOwnProperty.call(viteUpdates, match[1])) {
        out.push(`${match[1]}=${viteUpdates[match[1]]}`);
        seen.add(match[1]);
      } else {
        out.push(line);
      }
    }
    for (const [key, value] of Object.entries(viteUpdates)) {
      if (!seen.has(key)) out.push(`${key}=${value}`);
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push('');
    fs.writeFileSync(envPath, out.join('\n'));
  }

  function updateOperatorKeyFile(privateKey) {
    if (!privateKey || typeof privateKey !== 'string') return false;
    const clean = privateKey.replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(clean)) return false;
    try {
      fs.writeFileSync(operatorKeyPath, clean, 'utf8');
      return true;
    } catch (error) {
      console.error('[env-writer] Failed to write operator key file:', error);
      return false;
    }
  }

  function updateDevVars(updates) {
    const devVarsPath = path.resolve(__dirname, '..', '.dev.vars');
    if (!fs.existsSync(devVarsPath)) return false;
    let content = fs.readFileSync(devVarsPath, 'utf8');
    let modified = false;
    for (const [key, value] of Object.entries(updates)) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^(${escapedKey}=).*$`, 'm');
      if (pattern.test(content)) {
        content = content.replace(pattern, `$1${value}`);
        modified = true;
      } else {
        content += `\n${key}=${value}`;
        modified = true;
      }
    }
    if (modified) {
      fs.writeFileSync(devVarsPath, content);
    }
    return modified;
  }

  function updateWranglerConfig(updates) {
    const wranglerPath = path.resolve(__dirname, '..', 'wrangler.jsonc');
    if (!fs.existsSync(wranglerPath)) {
      console.warn('[env-writer] wrangler.jsonc not found, skipping worker config update');
      return false;
    }
    
    let content = fs.readFileSync(wranglerPath, 'utf8');
    let modified = false;
    
    for (const [key, value] of Object.entries(updates)) {
      const pattern = new RegExp(`("${key}"\\s*:\\s*")[^"]*(")`);
      if (pattern.test(content)) {
        content = content.replace(pattern, `$1${value}$2`);
        modified = true;
      } else if (key === 'VITE_MARKET_CONTRACT_ADDRESS') {
        const varsPattern = new RegExp(`("MARKET_CONTRACT_ADDRESS"\\s*:\\s*")[^"]*(")`);
        if (varsPattern.test(content)) {
          content = content.replace(varsPattern, `$1${value}$2`);
          modified = true;
        }
      }
    }
    
    if (modified) {
      fs.writeFileSync(wranglerPath, content);
      console.log(`[env-writer] Updated wrangler.jsonc with: ${Object.keys(updates).join(', ')}`);
    }
    
    return modified;
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
            
            const envUpdates = {};
            const wranglerUpdates = {};
            for (const [key, value] of Object.entries(updates)) {
              if (key === 'MARKET_OPERATOR_PRIVATE_KEY') {
                envUpdates[key] = value;
              } else if (key.startsWith('VITE_')) {
                envUpdates[key] = value;
                const wranglerKey = key.replace('VITE_', '');
                wranglerUpdates[wranglerKey] = value;
              } else {
                envUpdates[key] = value;
                wranglerUpdates[key] = value;
              }
            }

            const envResult = updateEnvFile(envUpdates);
            const operatorResult = updates.MARKET_OPERATOR_PRIVATE_KEY ? updateOperatorKeyFile(updates.MARKET_OPERATOR_PRIVATE_KEY) : false;
            const devVarsResult = updates.MARKET_OPERATOR_PRIVATE_KEY ? updateDevVars({ MARKET_OPERATOR_PRIVATE_KEY: updates.MARKET_OPERATOR_PRIVATE_KEY }) : false;
            const wranglerResult = updateWranglerConfig(wranglerUpdates);
            
            const message = [];
            if (envResult) message.push(`Updated ${envPath}`);
            if (operatorResult) message.push('Updated .dev.operator.key');
            if (devVarsResult) message.push('Updated .dev.vars');
            if (wranglerResult) message.push('Updated wrangler.jsonc');
            
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ 
              ok: true, 
              file: envPath,
              operatorKeyUpdated: operatorResult,
              devVarsUpdated: devVarsResult,
              wranglerUpdated: wranglerResult,
              message: message.join(', ') || 'No changes made',
              reload: false
            }));
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
import fs from 'node:fs';
import path from 'node:path';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a production Worker release`);
  return value;
}

const sourcePath = path.resolve('wrangler.jsonc');
const targetPath = path.resolve('.wrangler.production.jsonc');
const config = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const databaseId = required('CLOUDFLARE_D1_DATABASE_ID');
const appOrigin = required('CROSSFLOW_APP_ORIGIN').replace(/\/$/, '');

if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw new Error('CLOUDFLARE_D1_DATABASE_ID must be a D1 UUID');
new URL(appOrigin);

config.vars = { ...config.vars, APP_ORIGIN: appOrigin, ENVIRONMENT: 'production' };
config.d1_databases = config.d1_databases.map(database => database.binding === 'DB'
  ? { ...database, database_id: databaseId }
  : database);

fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Prepared production Worker config for ${appOrigin}`);

// Explicit preload for maintenance commands only. Never import this from app/lib.
const fs = require('node:fs');
const dotenv = require('dotenv');
dotenv.config();
if (!fs.existsSync('.env.migrations')) throw new Error('Operator .env.migrations is required');
const operator = dotenv.parse(fs.readFileSync('.env.migrations'));
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (!operator[key]) throw new Error(`Missing operator ${key}`);
  process.env[key] = operator[key];
}

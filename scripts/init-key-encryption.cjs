// Local setup only: write a new key to .env without putting it in arguments or logs.
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');
const file = '.env';
const text = fs.readFileSync(file, 'utf8');
const env = dotenv.parse(text);
if ((env.API_KEY_ENCRYPTION_KEYS && env.API_KEY_ENCRYPTION_KEYS !== '{}') || env.API_KEY_ENCRYPTION_ACTIVE_KEY_ID) {
  console.error('Encryption configuration already exists; refusing to replace it.');
  process.exitCode = 1;
} else {
  const cleaned = text.replace(/^API_KEY_ENCRYPTION_(?:KEYS|ACTIVE_KEY_ID)=.*\r?\n?/gm, '');
  const keys = JSON.stringify({ primary: randomBytes(32).toString('base64') });
  fs.writeFileSync(file, `${cleaned}\nAPI_KEY_ENCRYPTION_ACTIVE_KEY_ID="primary"\nAPI_KEY_ENCRYPTION_KEYS='${keys}'\n`, { mode: 0o600 });
  console.log('Encryption key configured in local .env. Back it up separately from database backups; never commit it.');
}

/* ==================================================
   CLI: ساخت API Client جدید
   Usage:
     npm run client:add -- NOVA-WEB
     npx tsx src/scripts/add-client.ts NOVA-WEB
   کلید خام فقط یک بار نمایش داده می‌شود
   ================================================== */

import path from 'path';
import { DatabaseService } from '../database/database.service';
import { generateApiKey, hashApiKey } from '../utils/otp';
import { loadConfig } from '../config/config';

function main(): void {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: npm run client:add -- <name>');
    process.exit(1);
  }

  const config = loadConfig();
  const db = new DatabaseService(config.DATABASE_PATH);
  db.init();

  try {
    const apiKey = generateApiKey(name);
    const client = db.createClient(name.trim(), hashApiKey(apiKey));

    console.info('\n──────────────────────────────────────────────');
    console.info('✅ API client created');
    console.info(`   Name : ${client.name}`);
    console.info(`   Id   : ${client.id}`);
    console.info(`   Key  : ${apiKey}`);
    console.info('⚠️  Save this key now — it will NOT be shown again.');
    console.info('──────────────────────────────────────────────\n');
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();

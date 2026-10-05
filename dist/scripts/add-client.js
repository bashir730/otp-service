"use strict";
/* ==================================================
   CLI: ساخت API Client جدید
   Usage:
     npm run client:add -- NOVA-WEB
     npx tsx src/scripts/add-client.ts NOVA-WEB
   کلید خام فقط یک بار نمایش داده می‌شود
   ================================================== */
Object.defineProperty(exports, "__esModule", { value: true });
const database_service_1 = require("../database/database.service");
const otp_1 = require("../utils/otp");
const config_1 = require("../config/config");
function main() {
    const name = process.argv[2];
    if (!name) {
        console.error('Usage: npm run client:add -- <name>');
        process.exit(1);
    }
    const config = (0, config_1.loadConfig)();
    const db = new database_service_1.DatabaseService(config.DATABASE_PATH);
    db.init();
    try {
        const apiKey = (0, otp_1.generateApiKey)(name);
        const client = db.createClient(name.trim(), (0, otp_1.hashApiKey)(apiKey));
        console.info('\n──────────────────────────────────────────────');
        console.info('✅ API client created');
        console.info(`   Name : ${client.name}`);
        console.info(`   Id   : ${client.id}`);
        console.info(`   Key  : ${apiKey}`);
        console.info('⚠️  Save this key now — it will NOT be shown again.');
        console.info('──────────────────────────────────────────────\n');
    }
    catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
    }
    finally {
        db.close();
    }
}
main();

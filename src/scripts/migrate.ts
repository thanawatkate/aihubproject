import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/database.js';
import { splitSqlStatements } from '../utils/splitSqlStatements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../../migrations');

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 AS ok
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 AS ok
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

async function addColumnIfMissing(table: string, column: string, definition: string): Promise<void> {
  if (!(await tableExists(table))) {
    console.log(`[migrate] skip column ${table}.${column} (table missing)`);
    return;
  }
  if (await columnExists(table, column)) {
    console.log(`[migrate] skip column ${table}.${column} (exists)`);
    return;
  }
  await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`[migrate] ✓ added column ${table}.${column}`);
}

async function ensureHardeningColumns(): Promise<void> {
  await addColumnIfMissing(
    'ai_quota_reservations',
    'reserved_tokens',
    'BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `reserved_requests`',
  );
  await addColumnIfMissing(
    'ai_quota_reservations',
    'reserved_cost',
    'DECIMAL(14,8) NOT NULL DEFAULT 0 AFTER `reserved_tokens`',
  );
}

async function migrate(): Promise<void> {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`[migrate] Found ${files.length} migration file(s)`);

  for (const file of files) {
    console.log(`[migrate] Running ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = splitSqlStatements(sql);

    for (const stmt of statements) {
      await pool.execute(stmt);
    }
    console.log(`[migrate] ✓ ${file} (${statements.length} statements)`);
  }

  await ensureHardeningColumns();

  await pool.end();
  console.log('[migrate] Done.');
}

migrate().catch(err => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});

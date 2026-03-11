import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

function fail(message: string): never {
  throw new Error(message);
}

function toConnectionStringWithDatabase(connectionString: string, databaseName: string) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function collectTestFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function dropDatabase(adminPool: Pool, databaseName: string) {
  await adminPool.query(
    `select pg_terminate_backend(pid)
       from pg_stat_activity
      where datname = $1
        and pid <> pg_backend_pid()`,
    [databaseName],
  );
  await adminPool.query(`drop database ${quoteIdentifier(databaseName)}`);
}

async function main() {
  const baseDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!baseDatabaseUrl) fail('DATABASE_URL is required for tests');

  const testFiles = await collectTestFiles(path.resolve('tests'));
  if (testFiles.length === 0) fail('No test files found under tests/');

  const adminPool = new Pool({ connectionString: baseDatabaseUrl });

  try {
    for (const testFile of testFiles) {
      const databaseName = `fabric_test_${path.basename(testFile, '.test.mjs').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`;
      const testDatabaseUrl = toConnectionStringWithDatabase(baseDatabaseUrl, databaseName);
      const childEnv = {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
      };

      console.log(`[tests] creating ${databaseName} for ${path.relative(process.cwd(), testFile)}`);
      await adminPool.query(`create database ${quoteIdentifier(databaseName)}`);

      const bootstrapStatus = runCommand(process.execPath, [path.resolve('dist/scripts/bootstrap-db.js')], childEnv);
      if (bootstrapStatus !== 0) {
        console.error(`[tests] bootstrap failed for ${databaseName}; database preserved`);
        process.exit(bootstrapStatus);
      }

      const testStatus = runCommand(process.execPath, ['--test', '--test-concurrency=1', testFile], childEnv);
      if (testStatus !== 0) {
        console.error(`[tests] failure in ${path.relative(process.cwd(), testFile)}; database preserved: ${databaseName}`);
        process.exit(testStatus);
      }

      await dropDatabase(adminPool, databaseName);
      console.log(`[tests] passed ${path.relative(process.cwd(), testFile)}`);
    }
  } finally {
    await adminPool.end();
  }
}

await main();

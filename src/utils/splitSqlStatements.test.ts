import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from './splitSqlStatements.js';

describe('splitSqlStatements', () => {
  it('ignores semicolons inside comment lines', () => {
    const sql = '-- note: re-runs; careful\nUPDATE t SET a = 1\n  WHERE b = 0;\n-- end; done\nSELECT 1;';
    assert.deepEqual(splitSqlStatements(sql), ['UPDATE t SET a = 1\n  WHERE b = 0', 'SELECT 1']);
  });

  it('every migration file yields statements without comment text', () => {
    const dir = path.resolve(process.cwd(), 'migrations');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const stmts = splitSqlStatements(fs.readFileSync(path.join(dir, file), 'utf8'));
      assert.ok(stmts.length > 0, file);
      for (const s of stmts) assert.ok(!/^\s*--/m.test(s), `${file}: comment leaked into statement`);
    }
  });
});

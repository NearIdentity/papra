import { createNoopLogger } from '@crowlog/logger';
import { sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { setupDatabase } from '../../modules/app/database/database';
import { migrations } from '../migrations.registry';
import { runMigrations } from '../migrations.usecases';
import { documentPinnedAtMigration } from './0029-document-pinned-at.migration';

describe('document pinned at migration', () => {
  test('existing documents are preserved and start unpinned after upgrading', async () => {
    const { db } = setupDatabase({ url: ':memory:' });
    await runMigrations({
      db,
      migrations: migrations.slice(0, migrations.indexOf(documentPinnedAtMigration)),
      logger: createNoopLogger(),
    });
    // raw SQL: the drizzle schema already knows the column this migration adds
    await db.run(
      sql`INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Organization', 0, 0)`,
    );
    await db.run(
      sql`INSERT INTO documents (id, created_at, updated_at, organization_id, original_name, original_storage_key, original_sha256_hash, name, mime_type) VALUES ('doc_1', 0, 0, 'org', 'a.txt', 'k', 'h', 'a.txt', 'text/plain')`,
    );

    await runMigrations({ db, migrations, logger: createNoopLogger() });

    const { rows } = await db.run(sql`SELECT id, pinned_at FROM documents`);
    expect(rows.map((r) => ({ id: r.id, pinned_at: r.pinned_at }))).to.eql([
      { id: 'doc_1', pinned_at: null },
    ]);
  });

  test('the migration can be rolled back', async () => {
    const { db } = setupDatabase({ url: ':memory:' });
    await runMigrations({ db, migrations, logger: createNoopLogger() });

    await documentPinnedAtMigration.down({ db });

    const { rows } = await db.run(sql`SELECT name FROM pragma_table_info('documents')`);
    expect(rows.map((r) => r.name)).not.to.include('pinned_at');
  });
});

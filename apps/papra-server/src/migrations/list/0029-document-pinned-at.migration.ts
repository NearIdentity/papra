import type { Migration } from '../migrations.types';
import { sql } from 'drizzle-orm';
import { getRuntimeTableColumns } from '../../modules/app/database/database.usecases';

export const documentPinnedAtMigration = {
  name: 'document-pinned-at',

  up: async ({ db }) => {
    const existingColumns = await getRuntimeTableColumns({ tableName: 'documents', db });

    if (!existingColumns.includes('pinned_at')) {
      await db.run(sql`ALTER TABLE documents ADD COLUMN pinned_at integer`);
    }

    await db.run(
      sql`CREATE INDEX IF NOT EXISTS documents_organization_id_pinned_at_index ON documents (organization_id, pinned_at)`,
    );
  },

  down: async ({ db }) => {
    await db.run(sql`DROP INDEX IF EXISTS documents_organization_id_pinned_at_index`);
    await db.run(sql`ALTER TABLE documents DROP COLUMN pinned_at`);
  },
} satisfies Migration;

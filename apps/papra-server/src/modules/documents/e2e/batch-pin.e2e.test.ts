import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../../app/database/database.test-utils';
import { createServer } from '../../app/server';
import { createTestServerDependencies } from '../../app/server.test-utils';
import { overrideConfig } from '../../config/config.test-utils';
import { ORGANIZATION_ROLES } from '../../organizations/organizations.constants';
import { createDocumentSearchRepository } from '../document-search/database-fts5/database-fts5.repository';
import { documentsTable } from '../documents.table';

const USER_ID = 'usr_111111111111111111111111';
const OTHER_USER_ID = 'usr_222222222222222222222222';
const ORGANIZATION_ID = 'org_222222222222222222222222';
const OTHER_ORGANIZATION_ID = 'org_333333333333333333333333';
const DOCS = [1, 2, 3, 4].map((n) => `doc_${String(n).repeat(24)}`);
const OTHER_ORG_DOC = `doc_${'9'.repeat(24)}`;

function makeDocument({
  id,
  name,
  organizationId = ORGANIZATION_ID,
  createdAt,
}: {
  id: string;
  name: string;
  organizationId?: string;
  createdAt: Date;
}) {
  return {
    id,
    name,
    organizationId,
    createdAt,
    mimeType: 'text/plain',
    originalName: name,
    createdBy: USER_ID,
    originalStorageKey: `documents/${id}`,
    originalSha256Hash: `hash${id}`,
    isDeleted: false,
  };
}

async function setup() {
  const { db } = await createInMemoryDatabase({
    users: [
      { id: USER_ID, email: 'user@example.com' },
      { id: OTHER_USER_ID, email: 'other@example.com' },
    ],
    organizations: [
      { id: ORGANIZATION_ID, name: 'Org 1' },
      { id: OTHER_ORGANIZATION_ID, name: 'Org 2' },
    ],
    organizationMembers: [
      { organizationId: ORGANIZATION_ID, userId: USER_ID, role: ORGANIZATION_ROLES.OWNER },
      {
        organizationId: OTHER_ORGANIZATION_ID,
        userId: OTHER_USER_ID,
        role: ORGANIZATION_ROLES.OWNER,
      },
    ],
    documents: [
      ...DOCS.map((id, index) =>
        makeDocument({ id, name: `doc-${index + 1}.txt`, createdAt: new Date(2025, 0, index + 1) }),
      ),
      makeDocument({
        id: OTHER_ORG_DOC,
        name: 'foreign.txt',
        organizationId: OTHER_ORGANIZATION_ID,
        createdAt: new Date(2025, 0, 1),
      }),
    ],
  });

  // seeded rows are not in the full-text index, which query-based targeting relies on
  await createDocumentSearchRepository({ db }).indexDocuments({
    documents: await db.select().from(documentsTable),
  });

  const { app } = createServer(
    createTestServerDependencies({ db, config: overrideConfig({ env: 'test' }) }),
  );

  const post = async (path: string, body: unknown, userId = USER_ID) =>
    app.request(
      `/api/organizations/${ORGANIZATION_ID}/documents/batch/${path}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { loggedInUserId: userId },
    );

  const list = async (query = '') => {
    const response = await app.request(
      `/api/organizations/${ORGANIZATION_ID}/documents?${query}`,
      {},
      { loggedInUserId: USER_ID },
    );
    const { documents, documentsCount } = (await response.json()) as {
      documents: { id: string; pinnedAt: number | null }[];
      documentsCount: number;
    };
    return { status: response.status, documents, documentsCount };
  };

  return { post, list };
}

describe('documents e2e', () => {
  describe('batch pin', () => {
    test('pinned documents move to the top of the list whatever the sort, and go back after unpinning', async () => {
      const { post, list } = await setup();

      // default order is the documentDate desc then createdAt desc: newest first
      expect((await list('sortField=createdAt&sortOrder=desc')).documents.map((d) => d.id)).to.eql([
        DOCS[3],
        DOCS[2],
        DOCS[1],
        DOCS[0],
      ]);

      const pinResponse = await post('pin', { filter: { documentIds: [DOCS[0], DOCS[1]] } });
      expect(pinResponse.status).to.eql(204);

      const desc = await list('sortField=createdAt&sortOrder=desc');
      expect(desc.documents.map((d) => d.id)).to.eql([DOCS[1], DOCS[0], DOCS[3], DOCS[2]]);
      expect(desc.documents.map((d) => d.pinnedAt !== null)).to.eql([true, true, false, false]);

      const asc = await list('sortField=createdAt&sortOrder=asc');
      expect(asc.documents.map((d) => d.id)).to.eql([DOCS[0], DOCS[1], DOCS[2], DOCS[3]]);

      const unpinResponse = await post('unpin', { filter: { documentIds: [DOCS[0], DOCS[1]] } });
      expect(unpinResponse.status).to.eql(204);

      const after = await list('sortField=createdAt&sortOrder=desc');
      expect(after.documents.map((d) => d.id)).to.eql([DOCS[3], DOCS[2], DOCS[1], DOCS[0]]);
      expect(after.documents.every((d) => d.pinnedAt === null)).to.eql(true);
    });

    test('pins every document matching a search query', async () => {
      const { post, list } = await setup();

      expect((await post('pin', { filter: { query: 'doc-1' } })).status).to.eql(204);

      const { documents } = await list('sortField=createdAt&sortOrder=desc');
      expect(documents[0]?.id).to.eql(DOCS[0]);
      expect(documents[0]?.pinnedAt).not.to.eql(null);
    });

    test('a user cannot pin documents of an organization they do not belong to', async () => {
      const { post } = await setup();

      const response = await post('pin', { filter: { documentIds: [DOCS[0]] } }, OTHER_USER_ID);

      expect(response.status).to.eql(403);
    });

    test('pinning a document id from another organization is rejected and pins nothing', async () => {
      const { post, list } = await setup();

      const response = await post('pin', { filter: { documentIds: [DOCS[0], OTHER_ORG_DOC] } });

      expect(response.status).to.be.within(400, 404);
      expect((await list()).documents.every((d) => d.pinnedAt === null)).to.eql(true);
    });

    test('rejects an invalid body', async () => {
      const { post } = await setup();

      expect((await post('pin', { filter: { documentIds: [] } })).status).to.eql(400);
      expect((await post('unpin', {})).status).to.eql(400);
    });
  });
});

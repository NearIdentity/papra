import { desc } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { ORGANIZATION_ROLES } from '../organizations/organizations.constants';
import { createDocumentAlreadyExistsError } from './documents.errors';
import { createDocumentsRepository } from './documents.repository';
import { documentsTable } from './documents.table';

describe('documents repository', () => {
  describe('crud operations on document collection', () => {
    test('a document can be created, retrieved, and soft deleted', async () => {
      const { db } = await createInMemoryDatabase({
        users: [{ id: 'user-1', email: 'user-1@example.com' }],
        organizations: [{ id: 'organization-1', name: 'Organization 1' }],
        organizationMembers: [
          { organizationId: 'organization-1', userId: 'user-1', role: ORGANIZATION_ROLES.OWNER },
        ],
      });

      const documentsRepository = createDocumentsRepository({ db });

      const { document } = await documentsRepository.saveOrganizationDocument({
        organizationId: 'organization-1',
        createdBy: 'user-1',
        mimeType: 'application/pdf',
        name: 'Document 1',
        originalName: 'document-1.pdf',
        originalStorageKey: 'document-1.pdf',
        originalSha256Hash: 'hash1',
      });

      expect(document).to.include({
        organizationId: 'organization-1',
        createdBy: 'user-1',
        mimeType: 'application/pdf',
        name: 'Document 1',
        originalName: 'document-1.pdf',
        originalStorageKey: 'document-1.pdf',
        originalSha256Hash: 'hash1',
        isDeleted: false,
      });

      const documents = await db
        .select()
        .from(documentsTable)
        .orderBy(desc(documentsTable.createdAt));

      expect(documents).to.have.length(1);
      expect(documents[0]).to.include({
        organizationId: 'organization-1',
        createdBy: 'user-1',
        mimeType: 'application/pdf',
        name: 'Document 1',
        originalName: 'document-1.pdf',
        originalStorageKey: 'document-1.pdf',
        isDeleted: false,
      });

      await documentsRepository.softDeleteDocument({
        documentId: document.id,
        userId: 'user-1',
        organizationId: 'organization-1',
      });

      const documentsAfterDelete = await db
        .select()
        .from(documentsTable)
        .orderBy(desc(documentsTable.createdAt));

      expect(documentsAfterDelete).to.have.length(1);
      expect(documentsAfterDelete[0]!.isDeleted).toBe(true);
    });
  });

  describe('saveOrganizationDocument', () => {
    test('a document is unique by organization, an error is raised if a document with the same hash already exists', async () => {
      const { db } = await createInMemoryDatabase({
        users: [{ id: 'user-1', email: 'user-1@example.com' }],
        organizations: [{ id: 'organization-1', name: 'Organization 1' }],
      });

      const documentsRepository = createDocumentsRepository({ db });

      await documentsRepository.saveOrganizationDocument({
        organizationId: 'organization-1',
        createdBy: 'user-1',
        name: 'Document 1',
        originalName: 'document-1.pdf',
        content: 'lorem ipsum',
        originalStorageKey: '',
        mimeType: 'application/pdf',
        originalSha256Hash: 'hash1',
      });

      await expect(
        documentsRepository.saveOrganizationDocument({
          organizationId: 'organization-1',
          createdBy: 'user-1',
          name: 'Document 1',
          originalName: 'document-1.pdf',
          content: 'lorem ipsum',
          originalStorageKey: '',
          mimeType: 'application/pdf',
          originalSha256Hash: 'hash1',
        }),
      ).rejects.toThrow(createDocumentAlreadyExistsError());
    });
  });

  describe('getOrganizationStats', () => {
    test('retrieve document count and total size for an organization', async () => {
      const { db } = await createInMemoryDatabase({
        users: [
          { id: 'user-1', email: 'user-1@example.com' },
          { id: 'user-2', email: 'user-2@example.com' },
        ],
        organizations: [
          { id: 'organization-1', name: 'Organization 1' },
          { id: 'organization-2', name: 'Organization 2' },
        ],
        organizationMembers: [
          { organizationId: 'organization-1', userId: 'user-1', role: ORGANIZATION_ROLES.OWNER },
          { organizationId: 'organization-2', userId: 'user-2', role: ORGANIZATION_ROLES.OWNER },
        ],
        documents: [
          {
            id: 'doc-1',
            organizationId: 'organization-1',
            createdBy: 'user-1',
            name: 'Document 1',
            originalName: 'document-1.pdf',
            content: 'lorem ipsum',
            originalStorageKey: '',
            mimeType: 'application/pdf',
            originalSize: 200,
            originalSha256Hash: 'hash1',
          },
          {
            id: 'doc-2',
            organizationId: 'organization-1',
            createdBy: 'user-1',
            name: 'File 2',
            originalName: 'document-2.pdf',
            content: 'lorem',
            originalStorageKey: '',
            mimeType: 'application/pdf',
            originalSize: 10,
            originalSha256Hash: 'hash2',
          },
          {
            id: 'doc-3',
            organizationId: 'organization-1',
            createdBy: 'user-1',
            name: 'File 3',
            originalName: 'document-3.pdf',
            content: 'ipsum',
            originalStorageKey: '',
            mimeType: 'application/pdf',
            originalSize: 5,
            originalSha256Hash: 'hash3',
          },
          {
            id: 'doc-4',
            organizationId: 'organization-2',
            createdBy: 'user-2',
            name: 'File 3',
            originalName: 'document-3.pdf',
            content: 'ipsum',
            originalStorageKey: '',
            mimeType: 'application/pdf',
            originalSize: 100,
            originalSha256Hash: 'hash4',
          },
          {
            id: 'doc-5',
            organizationId: 'organization-1',
            createdBy: 'user-2',
            name: 'File 3',
            originalName: 'document-3.pdf',
            content: 'ipsum',
            originalStorageKey: '',
            mimeType: 'application/pdf',
            originalSize: 100,
            originalSha256Hash: 'hash5',
            deletedAt: new Date(0),
            isDeleted: true,
          },
          {
            id: 'doc-6',
            organizationId: 'organization-1',
            createdBy: 'user-2',
            name: 'File 3',
            originalName: 'document-3.pdf',
            content: 'ipsum',
            originalStorageKey: '',
            mimeType: 'application/pdf',
            originalSize: 100,
            originalSha256Hash: 'hash6',
            deletedAt: new Date(0),
            isDeleted: true,
          },
        ],
      });

      const documentsRepository = createDocumentsRepository({ db });

      const stats = await documentsRepository.getOrganizationStats({
        organizationId: 'organization-1',
      });

      expect(stats).to.deep.equal({
        documentsCount: 3,
        documentsSize: 215,
        totalDocumentsSize: 415,
        totalDocumentsCount: 5,
        deletedDocumentsCount: 2,
        deletedDocumentsSize: 200,
      });
    });

    test('returns 0 count and size when no documents are present', async () => {
      const { db } = await createInMemoryDatabase({
        users: [{ id: 'user-1', email: 'user-1@example.com' }],
        organizations: [{ id: 'organization-1', name: 'Organization 1' }],
        organizationMembers: [
          { organizationId: 'organization-1', userId: 'user-1', role: ORGANIZATION_ROLES.OWNER },
        ],
      });

      const documentsRepository = createDocumentsRepository({ db });

      const stats = await documentsRepository.getOrganizationStats({
        organizationId: 'organization-1',
      });

      expect(stats).to.deep.equal({
        documentsCount: 0,
        documentsSize: 0,
        totalDocumentsSize: 0,
        totalDocumentsCount: 0,
        deletedDocumentsCount: 0,
        deletedDocumentsSize: 0,
      });
    });

    test('returns 0 count and size when organization does not exist', async () => {
      const { db } = await createInMemoryDatabase();

      const documentsRepository = createDocumentsRepository({ db });

      const stats = await documentsRepository.getOrganizationStats({
        organizationId: 'organization-1',
      });

      expect(stats).to.deep.equal({
        documentsCount: 0,
        documentsSize: 0,
        totalDocumentsSize: 0,
        totalDocumentsCount: 0,
        deletedDocumentsCount: 0,
        deletedDocumentsSize: 0,
      });
    });
  });

  describe('areAllDocumentsInOrganization', async () => {
    const { db } = await createInMemoryDatabase({
      organizations: [
        { id: 'org-1', name: 'Organization 1' },
        { id: 'org-2', name: 'Organization 2' },
      ],
      documents: [
        {
          id: 'doc-1',
          organizationId: 'org-1',
          mimeType: 'text/plain',
          originalStorageKey: 'org-1/originals/doc-1.txt',
          name: 'file.txt',
          originalName: 'file.txt',
          originalSha256Hash: 'hash1',
        },
        {
          id: 'doc-2',
          organizationId: 'org-1',
          mimeType: 'text/plain',
          originalStorageKey: 'org-1/originals/doc-2.txt',
          name: 'file.txt',
          originalName: 'file.txt',
          originalSha256Hash: 'hash2',
        },
        {
          id: 'doc-3',
          organizationId: 'org-2',
          mimeType: 'text/plain',
          originalStorageKey: 'org-2/originals/doc-3.txt',
          name: 'file.txt',
          originalName: 'file.txt',
          originalSha256Hash: 'hash3',
        },
      ],
    });

    const documentsRepository = createDocumentsRepository({ db });

    test('check if a given list of document IDs all belong to the organization', async () => {
      expect(
        await documentsRepository.areAllDocumentsInOrganization({
          documentIds: ['doc-1', 'doc-2'],
          organizationId: 'org-1',
        }),
      ).to.eql(true);

      expect(
        await documentsRepository.areAllDocumentsInOrganization({
          documentIds: ['doc-1', 'doc-3'],
          organizationId: 'org-1',
        }),
      ).to.eql(false);

      expect(
        await documentsRepository.areAllDocumentsInOrganization({
          documentIds: ['doc-3'],
          organizationId: 'org-1',
        }),
      ).to.eql(false);
    });

    test('no document IDs provided, returns true', async () => {
      expect(
        await documentsRepository.areAllDocumentsInOrganization({
          documentIds: [],
          organizationId: 'org-1',
        }),
      ).to.eql(true);
    });

    test('non existing document ID returns false', async () => {
      expect(
        await documentsRepository.areAllDocumentsInOrganization({
          documentIds: ['non-existing-doc'],
          organizationId: 'org-1',
        }),
      ).to.eql(false);
    });

    test('duplicated document IDs from the organizations are accepted and return true', async () => {
      expect(
        await documentsRepository.areAllDocumentsInOrganization({
          documentIds: ['doc-1', 'doc-1', 'doc-2'],
          organizationId: 'org-1',
        }),
      ).to.eql(true);
    });
  });

  describe('pinDocuments and unpinDocuments', () => {
    const makeDocument = (id: string, organizationId: string, extra: object = {}) => ({
      id,
      organizationId,
      mimeType: 'text/plain',
      originalStorageKey: `${organizationId}/originals/${id}.txt`,
      name: `${id}.txt`,
      originalName: `${id}.txt`,
      originalSha256Hash: `hash-${id}`,
      ...extra,
    });

    test('pinning only affects non-deleted documents of the given organization, and returns the ids that changed', async () => {
      const { db } = await createInMemoryDatabase({
        organizations: [
          { id: 'org-1', name: 'Organization 1' },
          { id: 'org-2', name: 'Organization 2' },
        ],
        documents: [
          makeDocument('doc-1', 'org-1'),
          makeDocument('doc-2', 'org-1', { isDeleted: true }),
          makeDocument('doc-3', 'org-2'),
        ],
      });
      const documentsRepository = createDocumentsRepository({ db });
      const now = new Date('2025-01-02T03:04:05.000Z');

      const { pinnedDocumentIds } = await documentsRepository.pinDocuments({
        documentIds: ['doc-1', 'doc-2', 'doc-3'],
        organizationId: 'org-1',
        now,
      });

      expect(pinnedDocumentIds).to.eql(['doc-1']);

      const records = await db.select().from(documentsTable);
      expect(Object.fromEntries(records.map((r) => [r.id, r.pinnedAt ?? null]))).to.eql({
        'doc-1': now,
        'doc-2': null,
        'doc-3': null,
      });
    });

    test('re-pinning an already pinned document keeps its original pin date and is not reported as changed', async () => {
      const { db } = await createInMemoryDatabase({
        organizations: [{ id: 'org-1', name: 'Organization 1' }],
        documents: [makeDocument('doc-1', 'org-1')],
      });
      const documentsRepository = createDocumentsRepository({ db });
      const firstPin = new Date('2025-01-01T00:00:00.000Z');

      await documentsRepository.pinDocuments({
        documentIds: ['doc-1'],
        organizationId: 'org-1',
        now: firstPin,
      });
      const { pinnedDocumentIds } = await documentsRepository.pinDocuments({
        documentIds: ['doc-1'],
        organizationId: 'org-1',
        now: new Date('2025-06-01T00:00:00.000Z'),
      });

      expect(pinnedDocumentIds).to.eql([]);
      const [record] = await db.select().from(documentsTable);
      expect(record?.pinnedAt).to.eql(firstPin);
    });

    test('unpinning clears the pin only for pinned documents of the organization', async () => {
      const pinnedAt = new Date('2025-01-01T00:00:00.000Z');
      const { db } = await createInMemoryDatabase({
        organizations: [
          { id: 'org-1', name: 'Organization 1' },
          { id: 'org-2', name: 'Organization 2' },
        ],
        documents: [
          makeDocument('doc-1', 'org-1', { pinnedAt }),
          makeDocument('doc-2', 'org-1'),
          makeDocument('doc-3', 'org-2', { pinnedAt }),
        ],
      });
      const documentsRepository = createDocumentsRepository({ db });

      const { unpinnedDocumentIds } = await documentsRepository.unpinDocuments({
        documentIds: ['doc-1', 'doc-2', 'doc-3'],
        organizationId: 'org-1',
      });

      expect(unpinnedDocumentIds).to.eql(['doc-1']);
      const records = await db.select().from(documentsTable);
      expect(Object.fromEntries(records.map((r) => [r.id, r.pinnedAt ?? null]))).to.eql({
        'doc-1': null,
        'doc-2': null,
        'doc-3': pinnedAt,
      });
    });

    test('an empty id list is a no-op', async () => {
      const { db } = await createInMemoryDatabase();
      const documentsRepository = createDocumentsRepository({ db });

      expect(
        await documentsRepository.pinDocuments({ documentIds: [], organizationId: 'org-1' }),
      ).to.eql({ pinnedDocumentIds: [] });
      expect(
        await documentsRepository.unpinDocuments({ documentIds: [], organizationId: 'org-1' }),
      ).to.eql({ unpinnedDocumentIds: [] });
    });
  });
});

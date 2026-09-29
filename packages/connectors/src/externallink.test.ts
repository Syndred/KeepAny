import { describe, expect, it } from 'vitest';
import { checkTargetImageCount, externalLinkPairKey, externalLinkSubmissionForAsset, listExternalLinkExportProfiles, normalizeDestinationKey, previewExternalLinkExport, previewExternalLinkProfile, previewExternalLinkSubmission } from './externallink';

const profile = {
  id: 'DemoProject', name: 'Fallback Name', url: 'https://demo.example',
  fields: {
    Name: 'Demo Project', Url: 'https://demo.example', Title: 'A small tool',
    'Short description(20-30 words)': 'A useful short description.',
    'Long description (250-500 words)': 'A longer, approved description.',
    'Business mail': 'hello@demo.example',
    'Cloud LOGO': 'https://cdn.example/logo.png',
    'Cloud Featured image': 'https://cdn.example/featured.png',
    'Screenshot 1': 'https://cdn.example/screen-1.png',
    'Screenshot-2': 'cloud-media://private/screen-2',
    'Screenshot 3': 'javascript:alert(1)',
  },
};

describe('ExternalLink profile fixture preview', () => {
  it('maps known field aliases while counting only allowed image references', () => {
    const result = previewExternalLinkProfile(profile, 'asset-demo');
    expect(result).toMatchObject({ assetId: 'asset-demo', profileId: 'DemoProject', name: 'Demo Project',
      title: 'A small tool', shortDescription: 'A useful short description.',
      longDescription: 'A longer, approved description.',
      imageCounts: { logo: 1, featured: 1, screenshots: 2, totalReferences: 4 },
      unresolvedImageFields: ['screenshot:3'],
    });
    expect(result.screenshots).toEqual(['https://cdn.example/screen-1.png', 'cloud-media://private/screen-2']);
  });

  it('reports target image shortfalls and does not claim image bytes are resolved', () => {
    const result = previewExternalLinkProfile(profile, 'asset-demo');
    expect(checkTargetImageCount(result, { minScreenshots: 3, maxScreenshots: 4, requireLogo: true }))
      .toMatchObject({ missingScreenshots: 1, missingLogo: false, requiresMediaResolution: true });
    expect(checkTargetImageCount(result, { minScreenshots: 0, maxScreenshots: 1 }))
      .toMatchObject({ extraScreenshots: 1, selectedScreenshots: ['https://cdn.example/screen-1.png'] });
  });
});

describe('ExternalLink exact submission ledger mapping', () => {
  const mapping = { assetId: 'asset-demo', profileId: 'DemoProject', destinationUrl: 'https://www.directory.example/submit?ref=1' };
  const key = 'directory.example/submit::DemoProject';
  const receipt = { destinationKey: 'https://directory.example/submit', profileId: 'DemoProject', status: 'success',
    confirmedBy: 'agent', evidence: 'Submission received', submittedAt: '2026-09-28T10:00:00Z',
    publicationStatus: 'submitted' };

  it('normalizes destination key and keeps the exact profile pair', () => {
    expect(normalizeDestinationKey(mapping.destinationUrl)).toBe('directory.example/submit');
    expect(externalLinkPairKey(mapping.destinationUrl, 'DemoProject')).toBe(key);
    expect(normalizeDestinationKey('https://startupstash.com/add-listing', new Set(['startupstash.com']))).toBe('startupstash.com');
    expect(() => normalizeDestinationKey('javascript:alert(1)')).toThrow();
    expect(() => normalizeDestinationKey('https://user:pass@directory.example/submit')).toThrow();
  });

  it('requires the raw row, key and mapped profile to agree', () => {
    expect(() => previewExternalLinkSubmission({ ...receipt, profileId: 'Other' }, key, mapping)).toThrow('ledger-identity');
    expect(() => previewExternalLinkSubmission(receipt, 'directory.example/submit::Other', mapping)).toThrow('ledger-identity');
    expect(() => previewExternalLinkSubmission({ ...receipt, destinationKey: 'other.example' }, key, mapping)).toThrow('ledger-identity');
  });

  it('does not promote a legacy success flag without receipt evidence', () => {
    const mapped = previewExternalLinkSubmission({ ...receipt, evidence: '', confirmedBy: '' }, key, mapping);
    expect(mapped.status).toBe('planned');
    expect(mapped.issues).toContain('missing-receipt-evidence');
    const migrated = previewExternalLinkSubmission({ ...receipt, evidence: 'table.xlsx submitted seed' }, key, mapping);
    expect(migrated.status).toBe('planned');
  });

  it('separates submitted, moderation, publication and search indexing', () => {
    expect(previewExternalLinkSubmission(receipt, key, mapping).status).toBe('submitted');
    expect(previewExternalLinkSubmission({ ...receipt, publicationStatus: 'pending_moderation' }, key, mapping).status).toBe('review');
    const claimed = previewExternalLinkSubmission({ ...receipt, publicationStatus: 'published' }, key, mapping);
    expect(claimed).toMatchObject({ status: 'verify', listingClaim: 'claimed' });
    const live = previewExternalLinkSubmission({ ...receipt, publicationStatus: 'published', publicUrl: 'https://directory.example/tools/demo', verifiedAt: '2026-09-28T11:00:00Z' }, key, mapping);
    expect(live).toMatchObject({ status: 'verify', listingClaim: 'verified' });
    const unverifiedIndex = previewExternalLinkSubmission({ ...receipt, publicationStatus: 'published', publicUrl: 'https://directory.example/tools/demo', indexedAt: '2026-09-29T11:00:00Z', indexEvidenceUrl: 'https://search.example/result/demo' }, key, mapping);
    expect(unverifiedIndex.status).toBe('verify');
    const indexed = previewExternalLinkSubmission({ ...receipt, publicationStatus: 'published', publicUrl: 'https://directory.example/tools/demo', verifiedAt: '2026-09-28T11:00:00Z', indexedAt: '2026-09-29T11:00:00Z', indexEvidenceUrl: 'https://search.example/result/demo' }, key, mapping);
    expect(indexed.status).toBe('indexed');
  });

  it('preserves failed status and reason without inventing a receipt', () => {
    const failed = previewExternalLinkSubmission({ destinationKey: 'directory.example/submit', profileId: 'DemoProject', status: 'failed', failureReason: 'Form rejected' }, key, mapping);
    expect(failed).toMatchObject({ status: 'rejected', failureReason: 'Form rejected', submittedAt: '' });
  });
});

describe('ExternalLink Settings JSON export import contract', () => {
  const exportData = {
    format: 'externallink-submission-backup', version: 2,
    siteProfiles: { DemoProject: profile, Other: { id: 'Other', name: 'Other site', fields: {} } },
    submissionRecords: {
      'startupstash.com::DemoProject': { destinationKey: 'startupstash.com', destinationUrl: 'https://startupstash.com/add-listing?temporary=secret', profileId: 'DemoProject', status: 'success', confirmedBy: 'agent', evidence: 'Submission received', submittedAt: '2026-09-28T10:00:00Z', publicationStatus: 'submitted' },
      'directory.example/submit::DemoProject': { destinationKey: 'directory.example/submit', profileId: 'DemoProject', status: 'success', confirmedBy: 'migration', evidence: 'table.xlsx submitted seed', submittedAt: '2026-09-28T10:00:00Z' },
      'other.example::Other': { destinationKey: 'other.example', profileId: 'Other', status: 'success', confirmedBy: 'agent', evidence: 'Other receipt', submittedAt: '2026-09-28T10:00:00Z' },
    },
    sheetTableData: { privateValue: 'never-import-this' },
  };

  it('selects one exact Profile and writes only a receipt-backed status', () => {
    expect(listExternalLinkExportProfiles(exportData).map(item => item.id)).toEqual(['DemoProject', 'Other']);
    const result = previewExternalLinkExport(exportData, 'DemoProject', 'asset-demo');
    expect(result.profile.imageCounts).toEqual({ logo: 1, featured: 1, screenshots: 2, totalReferences: 4 });
    expect(result.rows).toHaveLength(2);
    const accepted = result.rows.find(row => row.preview.destinationKey === 'startupstash.com');
    if (!accepted) throw Error('missing accepted row');
    expect(accepted.importable).toBe(true);
    expect(result.rows.find(row => row.preview.destinationKey === 'directory.example/submit')).toMatchObject({ importable: false, preview: { status: 'planned', issues: ['missing-receipt-evidence'] } });
    const submission = externalLinkSubmissionForAsset(accepted, '2026-09-29T00:00:00.000Z');
    expect(submission).toMatchObject({ assetId: 'asset-demo', status: 'submitted', submittedAt: '2026-09-28', externalLink: { profileId: 'DemoProject', destinationKey: 'startupstash.com', publicationStatus: 'submitted' } });
    expect(submission.url).toBe('https://startupstash.com/add-listing');
    expect(JSON.stringify(submission)).not.toContain('never-import-this');
    const unproven = result.rows.find(row => !row.importable);
    if (!unproven) throw Error('missing unproven row');
    expect(() => externalLinkSubmissionForAsset(unproven, '2026-09-29T00:00:00.000Z')).toThrow('externallink-evidence');
    expect(externalLinkSubmissionForAsset(accepted, '2026-09-29T00:00:00.000Z').id).toBe(submission.id);
    expect(externalLinkSubmissionForAsset({ ...accepted, preview: { ...accepted.preview, assetId: 'other-asset' } }, '2026-09-29T00:00:00.000Z').id).not.toBe(submission.id);
  });

  it('rejects unsupported formats and ledger identity mismatches', () => {
    expect(() => listExternalLinkExportProfiles({ ...exportData, version: 3 })).toThrow();
    expect(() => previewExternalLinkExport({ ...exportData, submissionRecords: { 'other.example::DemoProject': { destinationKey: 'other.example', profileId: 'Other' } } }, 'DemoProject', 'asset-demo')).toThrow('ledger-identity');
  });
});

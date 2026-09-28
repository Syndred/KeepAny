import { z } from 'zod';

// Contract adapter only. It never reads an ExternalLink browser profile or submits a form.
const profileSchema = z.object({
  id: z.string().trim().min(1).max(96),
  name: z.string().max(200).optional(),
  url: z.string().optional(),
  promoUrl: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
  media: z.object({
    logo: z.string().optional(), featured: z.string().optional(),
    screenshots: z.array(z.string()).max(100).optional(),
  }).optional(),
  logoUrl: z.string().optional(),
}).passthrough();

const recordSchema = z.object({
  destinationKey: z.string().optional(), destinationUrl: z.string().optional(),
  profileId: z.string().optional(), status: z.string().optional(),
  publicationStatus: z.string().optional(), submittedAt: z.string().optional(),
  verifiedAt: z.string().optional(), indexedAt: z.string().optional(),
  confirmedBy: z.string().optional(), evidence: z.string().optional(),
  evidenceUrl: z.string().optional(), publicUrl: z.string().optional(),
  indexEvidenceUrl: z.string().optional(), failureReason: z.string().optional(),
  note: z.string().optional(),
}).passthrough();

const FIELD_ALIASES = {
  name: ['Name'],
  website: ['Url', 'URL', 'Website'],
  title: ['Title'],
  shortDescription: ['Short description(20-30 words)', 'Note'],
  longDescription: ['Long description (250-500 words)', 'Short Discription(100-150 words)'],
  email: ['Business mail', 'Email'],
  tags: ['Tags Keywords/Hashtags'],
  logo: ['Cloud LOGO', 'LOGO'],
  featured: ['Cloud Featured image', 'Featured image'],
} as const;

type Fields = Record<string, unknown>;
const firstText = (fields: Fields, aliases: readonly string[]) =>
  aliases.map(key => fields[key]).find(value => typeof value === 'string' && value.trim())?.toString().trim() ?? '';

function normalizedMediaReference(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) return url.toString();
    if (url.protocol === 'cloud-media:' && url.hostname && !url.search && !url.hash) return raw;
  } catch { /* Invalid or relative references are not counted as available. */ }
  return '';
}

export interface ExternalLinkProfilePreview {
  assetId: string;
  profileId: string;
  name: string;
  website: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  email: string;
  tags: string;
  logo: string;
  featuredImage: string;
  screenshots: string[];
  imageCounts: { logo: number; featured: number; screenshots: number; totalReferences: number };
  unresolvedImageFields: string[];
}

export function previewExternalLinkProfile(input: unknown, assetId: string): ExternalLinkProfilePreview {
  if (!assetId || assetId.length > 96) throw Error('asset-id');
  const profile = profileSchema.parse(input);
  const fields = profile.fields;
  const logo = normalizedMediaReference(firstText(fields, FIELD_ALIASES.logo) || profile.media?.logo || profile.logoUrl);
  const featuredImage = normalizedMediaReference(firstText(fields, FIELD_ALIASES.featured) || profile.media?.featured);
  const configured = profile.media?.screenshots?.length
    ? profile.media.screenshots
    : [1, 2, 3, 4].map(index => fields[`Screenshot ${index}`] ?? fields[`Screenshot-${index}`]);
  const screenshots = [...new Set(configured.map(normalizedMediaReference).filter(Boolean))];
  const unresolvedImageFields = configured.flatMap((value, index) => value && !normalizedMediaReference(value) ? [`screenshot:${index + 1}`] : []);
  if (!logo && (firstText(fields, FIELD_ALIASES.logo) || profile.media?.logo || profile.logoUrl)) unresolvedImageFields.push('logo');
  if (!featuredImage && (firstText(fields, FIELD_ALIASES.featured) || profile.media?.featured)) unresolvedImageFields.push('featured');
  return {
    assetId, profileId: profile.id,
    name: firstText(fields, FIELD_ALIASES.name) || profile.name || profile.id,
    website: firstText(fields, FIELD_ALIASES.website) || profile.promoUrl || profile.url || '',
    title: firstText(fields, FIELD_ALIASES.title),
    shortDescription: firstText(fields, FIELD_ALIASES.shortDescription),
    longDescription: firstText(fields, FIELD_ALIASES.longDescription),
    email: firstText(fields, FIELD_ALIASES.email), tags: firstText(fields, FIELD_ALIASES.tags),
    logo, featuredImage, screenshots,
    imageCounts: { logo: Number(Boolean(logo)), featured: Number(Boolean(featuredImage)), screenshots: screenshots.length, totalReferences: Number(Boolean(logo)) + Number(Boolean(featuredImage)) + screenshots.length },
    unresolvedImageFields,
  };
}

export function checkTargetImageCount(preview: ExternalLinkProfilePreview, requirement: { minScreenshots: number; maxScreenshots: number; requireLogo?: boolean }) {
  if (!Number.isInteger(requirement.minScreenshots) || !Number.isInteger(requirement.maxScreenshots) ||
      requirement.minScreenshots < 0 || requirement.maxScreenshots < requirement.minScreenshots) throw Error('image-requirement');
  const selectedScreenshots = preview.screenshots.slice(0, requirement.maxScreenshots);
  return {
    selectedScreenshots,
    missingScreenshots: Math.max(0, requirement.minScreenshots - selectedScreenshots.length),
    extraScreenshots: Math.max(0, preview.screenshots.length - selectedScreenshots.length),
    missingLogo: Boolean(requirement.requireLogo && !preview.logo),
    // References have not been downloaded, decoded, or approved for a target site.
    requiresMediaResolution: Boolean(preview.imageCounts.totalReferences),
  };
}

export function normalizeDestinationKey(value: string, hostScopedHosts: ReadonlySet<string> = new Set()): string {
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) throw Error('destination-url');
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
      !url.hostname.includes('.') || url.hostname === 'localhost') throw Error('destination-url');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  return hostScopedHosts.has(host) ? host : `${host}${path}`;
}

export function externalLinkPairKey(destinationKey: string, profileId: string): string {
  if (!profileId.trim() || profileId.includes('::')) throw Error('profile-id');
  return `${normalizeDestinationKey(destinationKey)}::${profileId.trim()}`;
}

export type ExternalLinkMappedStatus = 'planned' | 'submitted' | 'review' | 'verify' | 'indexed' | 'rejected';
export interface ExternalLinkSubmissionPreview {
  assetId: string; profileId: string; destinationKey: string; ledgerKey: string;
  status: ExternalLinkMappedStatus; listingClaim: 'none' | 'claimed' | 'verified';
  submittedAt: string; verifiedAt: string; indexedAt: string;
  evidence: string; evidenceUrl: string; publicUrl: string; indexEvidenceUrl: string;
  failureReason: string; issues: string[];
}

const safeUrl = (raw: string) => {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : '';
  } catch { return ''; }
};
const isoTime = (raw: string) => raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : '';

export function previewExternalLinkSubmission(
  input: unknown,
  ledgerKey: string,
  mapping: { assetId: string; profileId: string; destinationUrl: string; hostScopedHosts?: ReadonlySet<string> },
): ExternalLinkSubmissionPreview {
  const raw = recordSchema.parse(input);
  if (!mapping.assetId || !mapping.profileId.trim()) throw Error('mapping');
  const destinationKey = normalizeDestinationKey(mapping.destinationUrl, mapping.hostScopedHosts);
  const expectedLedgerKey = `${destinationKey}::${mapping.profileId.trim()}`;
  if (ledgerKey !== expectedLedgerKey || raw.profileId?.trim() !== mapping.profileId.trim() ||
      normalizeDestinationKey(raw.destinationKey || raw.destinationUrl || '', mapping.hostScopedHosts) !== destinationKey) throw Error('ledger-identity');
  const issues: string[] = [];
  const evidence = (raw.evidence || '').trim().slice(0, 2000);
  const evidenceUrl = safeUrl(raw.evidenceUrl || '');
  const publicUrl = safeUrl(raw.publicUrl || '');
  const indexEvidenceUrl = safeUrl(raw.indexEvidenceUrl || '');
  const submittedAt = isoTime(raw.submittedAt || '');
  const verifiedAt = isoTime(raw.verifiedAt || '');
  const indexedAt = isoTime(raw.indexedAt || '');
  if (raw.submittedAt && !submittedAt) issues.push('invalid-submitted-at');
  if (raw.verifiedAt && !verifiedAt) issues.push('invalid-verified-at');
  if (raw.indexedAt && !indexedAt) issues.push('invalid-indexed-at');
  if (raw.evidenceUrl && !evidenceUrl) issues.push('invalid-evidence-url');
  if (raw.publicUrl && !publicUrl) issues.push('invalid-public-url');
  const receipt = raw.status === 'success' && ['agent', 'manual'].includes(raw.confirmedBy || '') && Boolean(evidence || evidenceUrl);
  let status: ExternalLinkMappedStatus = 'planned';
  let listingClaim: ExternalLinkSubmissionPreview['listingClaim'] = 'none';
  if (raw.status === 'rejected' || raw.status === 'failed') status = 'rejected';
  else if (receipt) {
    status = raw.publicationStatus === 'pending_moderation' ? 'review' : 'submitted';
    if (raw.publicationStatus === 'published') {
      status = 'verify';
      listingClaim = publicUrl && verifiedAt ? 'verified' : 'claimed';
      if (!publicUrl || !verifiedAt) issues.push('publication-needs-verification');
    }
    if (indexedAt && indexEvidenceUrl && publicUrl) status = 'indexed';
  } else if (raw.status === 'success') issues.push('missing-receipt-evidence');
  if (receipt && !submittedAt) issues.push('missing-submitted-at');
  return {
    assetId: mapping.assetId, profileId: mapping.profileId.trim(), destinationKey, ledgerKey,
    status, listingClaim, submittedAt, verifiedAt, indexedAt, evidence, evidenceUrl, publicUrl, indexEvidenceUrl,
    failureReason: status === 'rejected' ? (raw.failureReason || raw.note || '').trim().slice(0, 2000) : '', issues,
  };
}

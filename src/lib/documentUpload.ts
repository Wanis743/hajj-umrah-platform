import { supabase } from '@/lib/supabase';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'application/pdf': return 'pdf';
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    default: return 'bin';
  }
}

export async function uploadPrivateDocument(params: {
  file: File;
  agencyId: string;
  branchId: string;
  pilgrimId: string;
  documentType: string;
}) {
  const { file, agencyId, branchId, pilgrimId, documentType } = params;
  if (!ALLOWED_MIME.has(file.type)) throw new Error('Unsupported document file type');
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error('Document exceeds the 10 MB upload limit');
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const objectPath = `${agencyId}/${branchId}/${pilgrimId}/${crypto.randomUUID()}.${extensionForMime(file.type)}`;

  const upload = await supabase.storage.from('documents').upload(objectPath, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) throw new Error(`Secure upload failed: ${upload.error.message}`);

  return {
    storageBucket: 'documents',
    storagePath: objectPath,
    checksumSha256: checksum,
    fileName: file.name.replace(/[/\\]/g, '_').slice(0, 180),
    mimeType: file.type,
    sizeBytes: file.size,
    documentType,
  };
}

export async function createSignedDocumentUrl(storagePath: string, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Unable to create document access URL');
  return data.signedUrl;
}

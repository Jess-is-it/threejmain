export const ATTACHMENT_LIMIT = 2 * 1024 * 1024;
const FILE_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export async function attachmentBody(file, version) {
  if (!file || file.size < 1 || file.size > ATTACHMENT_LIMIT) throw new Error('Choose a PDF, PNG or JPEG up to 2 MiB.');
  if (!/^[A-Za-z0-9][A-Za-z0-9 _().-]{0,119}$/.test(file.name) || file.name.includes('..')) {
    throw new Error('Use a plain filename with letters, numbers, spaces or common punctuation.');
  }
  const contentType = FILE_TYPES[file.name.split('.').at(-1).toLowerCase()];
  if (!contentType || file.type && file.type !== contentType) throw new Error('File extension and type must agree.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new Error('File changed while it was being read. Please choose it again.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return { version, filename: file.name, contentType, contentBase64: btoa(binary) };
}

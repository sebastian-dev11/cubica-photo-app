const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const cloudinary = require('./cloudinary');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { esUrlCloudinarySegura } = require('./validaciones');

const R2_URI_PREFIX = 'r2://';
const MAX_IMAGE_PIXELS = 120_000_000;

let cachedS3Client = null;
let cachedS3Config = '';

function getStorageProvider() {
  const provider = String(process.env.STORAGE_PROVIDER || 'cloudinary')
    .trim()
    .toLowerCase();

  if (!['cloudinary', 'r2'].includes(provider)) {
    throw new Error('STORAGE_PROVIDER debe ser "cloudinary" o "r2".');
  }

  return provider;
}

function getR2Config() {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim();
  const bucket = String(process.env.R2_BUCKET_NAME || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Faltan variables R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID o R2_SECRET_ACCESS_KEY.'
    );
  }

  return {
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint:
      String(process.env.R2_ENDPOINT || '').trim() ||
      `https://${accountId}.r2.cloudflarestorage.com`,
    region: String(process.env.R2_REGION || 'auto').trim() || 'auto'
  };
}

function getS3Client() {
  const config = getR2Config();
  const fingerprint = [
    config.accountId,
    config.endpoint,
    config.region,
    config.accessKeyId,
    config.secretAccessKey
  ].join('|');

  if (!cachedS3Client || cachedS3Config !== fingerprint) {
    cachedS3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
    cachedS3Config = fingerprint;
  }

  return { client: cachedS3Client, bucket: config.bucket };
}

function normalizeKey(key) {
  const normalized = String(key || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');

  if (!normalized) {
    throw new Error('La clave del objeto en almacenamiento no puede estar vacía.');
  }

  return normalized;
}

function getStorageKey(file) {
  if (!file) return '';

  if (typeof file === 'string') {
    return file.startsWith(R2_URI_PREFIX)
      ? normalizeKey(file.slice(R2_URI_PREFIX.length))
      : '';
  }

  if (file.storageKey) {
    return normalizeKey(file.storageKey);
  }

  const url = file.url || file.secure_url || '';

  if (typeof url === 'string' && url.startsWith(R2_URI_PREFIX)) {
    return normalizeKey(url.slice(R2_URI_PREFIX.length));
  }

  return '';
}

function getProvider(file) {
  const specified = String(file?.storageProvider || '').trim().toLowerCase();

  if (specified === 'r2' || specified === 'cloudinary') return specified;
  if (getStorageKey(file)) return 'r2';

  const url = typeof file === 'string'
    ? file
    : file?.url || file?.secure_url || '';

  if (esUrlCloudinarySegura(url)) return 'cloudinary';

  if (file?.publicId || file?.public_id) return 'cloudinary';

  return '';
}

function getCloudinaryPublicId(file, resourceType = 'image') {
  const url = typeof file === 'string'
    ? file
    : file?.url || file?.secure_url || '';

  if (!esUrlCloudinarySegura(url)) return '';

  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const uploadIndex = segments.indexOf('upload');

    if (uploadIndex === -1 || uploadIndex === segments.length - 1) return '';

    let remaining = segments.slice(uploadIndex + 1);
    const versionIndex = remaining.findIndex((segment) => /^v\d+$/.test(segment));

    if (versionIndex !== -1) {
      remaining = remaining.slice(versionIndex + 1);
    } else {
      remaining = remaining.filter((segment) =>
        !segment.includes(',') &&
        !/^(?:c_|w_|h_|q_|f_|fl_|e_|x_|y_|g_|r_|a_|b_|d_|t_|o_|l_|s_|p_|u_)/i.test(segment)
      );
    }

    if (remaining.length === 0) return '';

    const lastIndex = remaining.length - 1;
    const extension = path.posix.extname(remaining[lastIndex]);

    if (extension && resourceType !== 'raw') {
      remaining[lastIndex] = remaining[lastIndex].slice(0, -extension.length);
    }

    return remaining.join('/');
  } catch {
    return '';
  }
}

function buildStoredUrl(provider, key, cloudinaryUrl = '') {
  return provider === 'r2'
    ? `${R2_URI_PREFIX}${normalizeKey(key)}`
    : cloudinaryUrl;
}

function cloudinaryUpload(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });

    stream.end(buffer);
  });
}

async function uploadBuffer(buffer, {
  key,
  contentType = 'application/octet-stream',
  resourceType = 'raw',
  cloudinaryOptions = {}
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Se requiere un buffer válido para subir el archivo.');
  }

  const provider = getStorageProvider();

  if (provider === 'r2') {
    const storageKey = normalizeKey(key);
    const { client, bucket } = getS3Client();

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.length
    }));

    return {
      storageProvider: 'r2',
      storageKey,
      url: buildStoredUrl('r2', storageKey),
      publicId: storageKey,
      public_id: storageKey,
      mimeType: contentType,
      size: buffer.length
    };
  }

  const result = await cloudinaryUpload(buffer, {
    resource_type: resourceType,
    ...cloudinaryOptions
  });

  return {
    storageProvider: 'cloudinary',
    storageKey: '',
    url: result.secure_url || result.url || '',
    publicId: result.public_id || '',
    public_id: result.public_id || '',
    mimeType: contentType,
    size: result.bytes || buffer.length,
    cloudinary: result
  };
}

async function downloadCloudinaryBuffer(file, { maxBytes = 100 * 1024 * 1024 } = {}) {
  const url = typeof file === 'string'
    ? file
    : file?.url || file?.secure_url || '';

  if (!esUrlCloudinarySegura(url)) {
    throw new Error('URL de Cloudinary no permitida.');
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: maxBytes,
    maxRedirects: 0
  });

  return Buffer.from(response.data);
}

async function downloadBuffer(file, { maxBytes = 100 * 1024 * 1024 } = {}) {
  const provider = getProvider(file);

  if (provider === 'cloudinary') {
    return downloadCloudinaryBuffer(file, { maxBytes });
  }

  if (provider !== 'r2') {
    throw new Error('No se pudo determinar el proveedor del archivo.');
  }

  const storageKey = getStorageKey(file);
  const { client, bucket } = getS3Client();
  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey
  }));

  if (Number(response.ContentLength || 0) > maxBytes) {
    response.Body?.destroy?.();
    throw new Error('El archivo supera el tamaño máximo permitido para descargar.');
  }

  if (!response.Body) {
    throw new Error('R2 devolvió un archivo vacío.');
  }

  if (typeof response.Body.transformToByteArray === 'function') {
    return Buffer.from(await response.Body.transformToByteArray());
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of response.Body) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      response.Body.destroy?.();
      throw new Error('El archivo supera el tamaño máximo permitido para descargar.');
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function getOptimizedImageBuffer(file, {
  width = 1400,
  quality = 65
} = {}) {
  const buffer = await downloadBuffer(file);

  return sharp(buffer, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    failOn: 'none'
  })
    .rotate()
    .resize({
      width,
      height: width,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: '4:2:0'
    })
    .toBuffer();
}

async function getSignedReadUrl(file, { expiresIn } = {}) {
  const provider = getProvider(file);

  if (provider === 'cloudinary') {
    const url = typeof file === 'string'
      ? file
      : file?.url || file?.secure_url || '';

    if (!esUrlCloudinarySegura(url)) {
      throw new Error('URL de Cloudinary no permitida.');
    }

    return url;
  }

  if (provider !== 'r2') {
    return '';
  }

  const storageKey = getStorageKey(file);
  const { client, bucket } = getS3Client();
  const ttl = Math.min(
    Math.max(
      Number(expiresIn || process.env.R2_SIGNED_URL_TTL_SECONDS) || 86400,
      60
    ),
    7 * 24 * 60 * 60
  );

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    { expiresIn: ttl }
  );
}

async function objectExists(file) {
  const provider = getProvider(file);

  if (provider === 'cloudinary') {
    if (file?.publicId || file?.public_id) {
      const publicId = file.publicId || file.public_id;
      const resourceType = file.resourceType || 'raw';

      try {
        await cloudinary.api.resource(publicId, { resource_type: resourceType });
        return true;
      } catch {
        return esUrlCloudinarySegura(file?.url || '');
      }
    }

    return esUrlCloudinarySegura(file?.url || '');
  }

  if (provider !== 'r2') return false;

  const { client, bucket } = getS3Client();

  try {
    await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: getStorageKey(file)
    }));
    return true;
  } catch {
    return false;
  }
}

async function deleteObject(file, {
  publicId,
  resourceType = 'raw'
} = {}) {
  const provider = getProvider(file) || (publicId ? 'cloudinary' : '');

  if (provider === 'r2') {
    const { client, bucket } = getS3Client();
    const storageKey = getStorageKey(file);

    if (!storageKey) return false;

    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: storageKey
    }));
    return true;
  }

  if (provider === 'cloudinary') {
    const id =
      publicId ||
      file?.publicId ||
      file?.public_id ||
      getCloudinaryPublicId(file, resourceType);

    if (!id) return false;

    const result = await cloudinary.uploader.destroy(id, {
      resource_type: resourceType,
      invalidate: true
    });

    return result?.result === 'ok' || result?.result === 'not found';
  }

  return false;
}

function createObjectKey(prefix, filename) {
  const safePrefix = String(prefix || '')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[^A-Za-z0-9_-]/g, '_'))
    .join('/');
  const safeFilename = path.basename(String(filename || 'archivo'))
    .replace(/[^A-Za-z0-9._-]/g, '_');

  return normalizeKey(`${safePrefix}/${safeFilename}`);
}

module.exports = {
  R2_URI_PREFIX,
  buildStoredUrl,
  createObjectKey,
  deleteObject,
  downloadBuffer,
  getOptimizedImageBuffer,
  getProvider,
  getCloudinaryPublicId,
  getSignedReadUrl,
  getStorageKey,
  getStorageProvider,
  objectExists,
  uploadBuffer
};

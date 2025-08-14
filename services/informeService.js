// services/informeService.js
const crypto = require('crypto');
const Informe = require('../models/informe');
const Sesion = require('../models/sesion'); // nuevo modelo
const cloudinary = require('../utils/cloudinary');

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

/**
 * Sube un informe PDF a Cloudinary y registra sus metadatos en MongoDB.
 * Si no se pasa generatedBy, intenta resolverlo desde el sesionId.
 *
 * @param {Object} params
 * @param {String} params.title             Título del informe (obligatorio)
 * @param {String|null} [params.generatedBy=null] ID del usuario (opcional)
 * @param {String|null} [params.sesionId=null] ID de sesión para buscar el usuario (opcional)
 * @param {Buffer} params.buffer            Contenido binario del PDF (obligatorio)
 * @param {Boolean} [params.includesActa=false]  Indica si incluye acta
 * @param {Boolean} [params.overwrite=false]     Si true, permite sobreescritura en Cloudinary
 * @returns {Promise<Informe>} Documento guardado en MongoDB
 */
async function guardarInforme({
  title,
  generatedBy = null,
  sesionId = null,
  buffer,
  includesActa = false,
  overwrite = false
}) {
  if (!title) throw new Error('El título es obligatorio.');
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('El buffer del PDF es obligatorio y debe ser un Buffer válido.');
  }

  // Si no se pasa generatedBy, buscarlo desde la sesión
  if (!generatedBy && sesionId) {
    const sesion = await Sesion.findOne({ sesionId });
    generatedBy = sesion?.usuarioId || null;
  }

  const baseId = slugify(title);
  const hash8 = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 8);
  const publicId = `${baseId}_${hash8}`;

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'informes',
        public_id: publicId,
        overwrite
      },
      async (error, result) => {
        if (error) return reject(error);

        try {
          const informe = await Informe.create({
            title,
            generatedBy,
            url: result.secure_url,
            publicId: result.public_id,
            mimeType: 'application/pdf',
            includesActa
          });
          resolve(informe);
        } catch (dbErr) {
          try {
            await cloudinary.uploader.destroy(result.public_id, { resource_type: 'raw' });
          } catch (cleanupErr) {
            console.warn('No se pudo limpiar asset en Cloudinary tras fallo de DB:', cleanupErr?.message || cleanupErr);
          }
          reject(dbErr);
        }
      }
    );

    uploadStream.end(buffer);
  });
}

module.exports = { guardarInforme };
// services/informeService.js
const Informe = require('../models/informe');
const cloudinary = require('../utils/cloudinary');

/**
 * Guarda un informe PDF en Cloudinary y registra sus metadatos en Mongo.
 * @param {Object} params
 * @param {String} params.title - Título del informe.
 * @param {String} params.generatedBy - ID del usuario creador.
 * @param {Buffer} params.buffer - Contenido binario del PDF.
 * @param {Boolean} params.includesActa - Si incluye acta adjunta.
 */
async function guardarInforme({ title, generatedBy, buffer, includesActa }) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'informes',
        public_id: title.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        overwrite: true
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
          reject(dbErr);
        }
      }
    );
    uploadStream.end(buffer);
  });
}

module.exports = { guardarInforme };

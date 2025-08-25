// services/informeService.js
const crypto = require('crypto');
const Informe = require('../models/informe');
const Sesion = require('../models/sesion'); // Para mapear sesionId -> usuarioId
const cloudinary = require('../utils/cloudinary');

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function esPDF(buffer) {
  return buffer.slice(0, 4).toString() === '%PDF';
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
  if (!esPDF(buffer)) {
    throw new Error('El archivo no parece ser un PDF válido.');
  }

  // Si no se pasa generatedBy, buscarlo desde la sesión
  if (!generatedBy && sesionId) {
    const sesion = await Sesion.findOne({ sesionId });
    generatedBy = sesion?.usuarioId || null;
  }

  const baseId = slugify(title);
  const hash8 = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 8);
  const publicId = `${baseId}_${hash8}.pdf`; // ← extensión añadida

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'informes',
        public_id: publicId,
        overwrite,
        format: 'pdf' // ← asegura tipo
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

/* ============================
   ELIMINACIÓN DE INFORMES
============================ */

/**
 * Resuelve el userId efectivo del solicitante usando userId directo
 * o buscando por sesionId en la colección Sesion.
 */
async function resolverUserId({ requesterUserId = null, requesterSesionId = null }) {
  if (requesterUserId) return requesterUserId.toString();
  if (requesterSesionId) {
    const sesion = await Sesion.findOne({ sesionId: requesterSesionId }).lean();
    return sesion?.usuarioId ? sesion.usuarioId.toString() : null;
  }
  return null;
}

/**
 * Verifica si el solicitante puede eliminar el informe.
 * - Admin: siempre puede.
 * - Usuario normal: debe coincidir con generatedBy.
 */
function verificarAutorizacionEliminacion({ informe, resolvedUserId, isAdmin = false }) {
  if (isAdmin) return;

  const ownerId = informe?.generatedBy ? informe.generatedBy.toString() : null;
  if (!ownerId || !resolvedUserId || ownerId !== resolvedUserId) {
    const err = new Error('No autorizado para eliminar este informe.');
    err.status = 403;
    throw err;
  }
}

/**
 * Elimina un informe:
 *  - Verifica autorización (propiedad o admin).
 *  - Destruye el asset en Cloudinary (resource_type: 'raw').
 *  - Elimina el documento en Mongo.
 * @returns {Promise<{cloudResult: string}>}
 */
async function eliminarInforme({
  id,
  requesterUserId = null,
  requesterSesionId = null,
  isAdmin = false
}) {
  if (!id) {
    const err = new Error('Debe especificar el id del informe.');
    err.status = 400;
    throw err;
  }

  const informe = await Informe.findById(id);
  if (!informe) {
    const err = new Error('Informe no encontrado.');
    err.status = 404;
    throw err;
  }

  const resolvedUserId = await resolverUserId({ requesterUserId, requesterSesionId });
  verificarAutorizacionEliminacion({ informe, resolvedUserId, isAdmin });

  let cloudResult = 'skipped';
  if (informe.publicId) {
    try {
      const resp = await cloudinary.uploader.destroy(informe.publicId, {
        resource_type: 'raw',
        invalidate: true,
      });
      cloudResult = resp?.result || 'ok'; // 'ok' | 'not found' | ...
    } catch (e) {
      // Error real de Cloudinary: preferimos no dejar el registro huérfano
      const err = new Error(`Fallo al eliminar en Cloudinary: ${e?.message || e}`);
      err.status = 502;
      throw err;
    }
  }

  await Informe.deleteOne({ _id: id });
  return { cloudResult };
}

/**
 * Elimina varios informes.
 * Devuelve resumen con borrados y fallos.
 */
async function eliminarInformesBulk({
  ids = [],
  requesterUserId = null,
  requesterSesionId = null,
  isAdmin = false
}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const err = new Error('Debe enviar un arreglo "ids" con al menos un id.');
    err.status = 400;
    throw err;
  }

  const results = await Promise.allSettled(
    ids.map((id) =>
      eliminarInforme({
        id,
        requesterUserId,
        requesterSesionId,
        isAdmin,
      })
    )
  );

  const deleted = [];
  const failed = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      deleted.push({ id: ids[i], cloudResult: r.value.cloudResult });
    } else {
      failed.push({ id: ids[i], reason: r.reason?.message || 'Error desconocido' });
    }
  });

  return { ok: failed.length === 0, deleted: deleted.length, failed, details: { deleted, failed } };
}

module.exports = {
  guardarInforme,
  eliminarInforme,
  eliminarInformesBulk,
};

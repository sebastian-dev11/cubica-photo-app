const crypto = require('crypto');
const Informe = require('../models/informe');
const Sesion = require('../models/sesion'); 
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

async function guardarInforme({
  title,
  generatedBy = null,
  sesionId = null,
  buffer,
  includesActa = false,
  numeroIncidencia = '',
  regional = 'OTRA', // <--- AHORA RECIBE LA REGIONAL
  overwrite = false
}) {
  if (!title) throw new Error('El título es obligatorio.');
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('El buffer del PDF es obligatorio y debe ser un Buffer válido.');
  }
  if (!esPDF(buffer)) {
    throw new Error('El archivo no parece ser un PDF válido.');
  }

  if (!generatedBy && sesionId) {
    const sesion = await Sesion.findOne({ sesionId });
    generatedBy = sesion?.usuarioId || null;
  }

  const baseId = slugify(title);
  const hash8 = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 8);
  const publicId = `${baseId}_${hash8}.pdf`; 

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'informes',
        public_id: publicId,
        overwrite,
        format: 'pdf' 
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
            numeroIncidencia,
            includesActa,
            regional // <--- Y AHORA LA GUARDA EN LA BASE DE DATOS
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

async function resolverAuth({ requesterUserId = null, requesterSesionId = null, isAdmin = false }) {
  let resolvedUserId = null;
  let admin = !!isAdmin;

  if (requesterUserId) {
    resolvedUserId = requesterUserId.toString();
  }

  if (requesterSesionId) {
    const sesion = await Sesion.findOne({ sesionId: requesterSesionId }).lean();
    if (sesion?.usuarioId) {
      resolvedUserId = sesion.usuarioId.toString();
    }
    if (!admin && sesion?.isAdmin) {
      admin = true; 
    }
  }

  return { resolvedUserId, isAdmin: admin };
}

function verificarAutorizacionEliminacion({ informe, resolvedUserId, isAdmin = false }) {
  if (isAdmin) return;

  const ownerId = informe?.generatedBy ? informe.generatedBy.toString() : null;
  if (!ownerId || !resolvedUserId || ownerId !== resolvedUserId) {
    const err = new Error('No autorizado para eliminar este informe.');
    err.status = 403;
    throw err;
  }
}

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

  const { resolvedUserId, isAdmin: isAdminEff } = await resolverAuth({
    requesterUserId,
    requesterSesionId,
    isAdmin
  });

  verificarAutorizacionEliminacion({ informe, resolvedUserId, isAdmin: isAdminEff });

  let cloudResult = 'skipped';
  if (informe.publicId) {
    try {
      const resp = await cloudinary.uploader.destroy(informe.publicId, {
        resource_type: 'raw',
        invalidate: true
      });
      cloudResult = resp?.result || 'ok'; 
    } catch (e) {
      const err = new Error(`Fallo al eliminar en Cloudinary: ${e?.message || e}`);
      err.status = 502;
      throw err;
    }
  }

  await Informe.deleteOne({ _id: id });
  return { cloudResult };
}

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
        isAdmin
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
  eliminarInformesBulk
};
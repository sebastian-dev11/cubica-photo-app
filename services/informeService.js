const crypto = require('crypto');
const mongoose = require('mongoose');
const Informe = require('../models/informe');
const Sesion = require('../models/sesion');
const Tienda = require('../models/tienda');
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

function limpiarTexto(valor) {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
}

function normalizarNumero(valor) {
  const num = Number(valor);

  return Number.isFinite(num) ? num : null;
}

function normalizarFecha(valor) {
  if (!valor) return null;

  const fecha = new Date(valor);

  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function normalizarGeolocalizacion(geolocalizacion = null) {
  if (!geolocalizacion || typeof geolocalizacion !== 'object') {
    return {
      latitud: null,
      longitud: null,
      precision: null,
      altitud: null,
      precisionAltitud: null,
      fechaCaptura: null,
      mapsUrl: '',
      origen: 'none'
    };
  }

  const latitud = normalizarNumero(geolocalizacion.latitud);
  const longitud = normalizarNumero(geolocalizacion.longitud);

  const tieneCoordenadas =
    latitud !== null &&
    longitud !== null &&
    latitud >= -90 &&
    latitud <= 90 &&
    longitud >= -180 &&
    longitud <= 180;

  if (!tieneCoordenadas) {
    return {
      latitud: null,
      longitud: null,
      precision: null,
      altitud: null,
      precisionAltitud: null,
      fechaCaptura: null,
      mapsUrl: '',
      origen: 'none'
    };
  }

  const mapsUrl =
    typeof geolocalizacion.mapsUrl === 'string' && geolocalizacion.mapsUrl.trim()
      ? geolocalizacion.mapsUrl.trim()
      : `https://www.google.com/maps?q=${latitud},${longitud}`;

  return {
    latitud,
    longitud,
    precision: normalizarNumero(geolocalizacion.precision),
    altitud: normalizarNumero(geolocalizacion.altitud),
    precisionAltitud: normalizarNumero(geolocalizacion.precisionAltitud),
    fechaCaptura: normalizarFecha(geolocalizacion.fechaCaptura) || new Date(),
    mapsUrl,
    origen: ['browser', 'manual'].includes(geolocalizacion.origen)
      ? geolocalizacion.origen
      : 'browser'
  };
}

function mapTiendaParaInforme(tienda = null) {
  if (!tienda || typeof tienda !== 'object') {
    return {
      tiendaId: null,
      tiendaNombre: '',
      tiendaRegional: '',
      tiendaDepartamento: '',
      tiendaCiudad: ''
    };
  }

  return {
    tiendaId: tienda._id || tienda.id || null,
    tiendaNombre: limpiarTexto(tienda.nombre),
    tiendaRegional: limpiarTexto(tienda.regional),
    tiendaDepartamento: limpiarTexto(tienda.departamento),
    tiendaCiudad: limpiarTexto(tienda.ciudad)
  };
}

async function resolverTiendaInforme({ tiendaId = null, tienda = null }) {
  if (tienda && typeof tienda === 'object') {
    return mapTiendaParaInforme(tienda);
  }

  const idNormalizado = limpiarTexto(tiendaId);

  if (!idNormalizado || !mongoose.isValidObjectId(idNormalizado)) {
    return mapTiendaParaInforme(null);
  }

  const tiendaEncontrada = await Tienda.findById(idNormalizado).lean();

  if (!tiendaEncontrada) {
    return mapTiendaParaInforme(null);
  }

  return mapTiendaParaInforme(tiendaEncontrada);
}

async function guardarInforme({
  title,
  generatedBy = null,
  sesionId = null,
  buffer,
  includesActa = false,
  numeroIncidencia = '',
  regional = 'OTRA',
  tiendaId = null,
  tienda = null,
  geolocalizacion = null,
  overwrite = false
}) {
  if (!title) throw new Error('El título es obligatorio.');

  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('El buffer del PDF es obligatorio y debe ser un Buffer válido.');
  }

  if (!esPDF(buffer)) {
    throw new Error('El archivo no parece ser un PDF válido.');
  }

  const sesionIdNormalizado = typeof sesionId === 'string' ? sesionId.trim() : '';
  const geolocalizacionNormalizada = normalizarGeolocalizacion(geolocalizacion);
  const tiendaNormalizada = await resolverTiendaInforme({
    tiendaId,
    tienda
  });

  if (!generatedBy && sesionIdNormalizado) {
    const sesion = await Sesion.findOne({ sesionId: sesionIdNormalizado });
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
            sesionId: sesionIdNormalizado,
            url: result.secure_url,
            publicId: result.public_id,
            mimeType: 'application/pdf',
            numeroIncidencia,
            includesActa,
            regional,
            tiendaId: tiendaNormalizada.tiendaId,
            tiendaNombre: tiendaNormalizada.tiendaNombre,
            tiendaRegional: tiendaNormalizada.tiendaRegional,
            tiendaDepartamento: tiendaNormalizada.tiendaDepartamento,
            tiendaCiudad: tiendaNormalizada.tiendaCiudad,
            geolocalizacion: geolocalizacionNormalizada
          });

          resolve(informe);
        } catch (dbErr) {
          try {
            await cloudinary.uploader.destroy(result.public_id, {
              resource_type: 'raw'
            });
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

async function resolverAuth({
  requesterUserId = null,
  requesterSesionId = null,
  isAdmin = false
}) {
  let resolvedUserId = null;
  let admin = Boolean(isAdmin);

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

function verificarAutorizacionEliminacion({
  informe,
  resolvedUserId,
  isAdmin = false
}) {
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

  verificarAutorizacionEliminacion({
    informe,
    resolvedUserId,
    isAdmin: isAdminEff
  });

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

async function editarInforme({
  id,
  title,
  numeroIncidencia,
  regional,
  includesActa = undefined,
  tiendaId = undefined,
  tienda = undefined,
  geolocalizacion = undefined
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

  if (
    typeof numeroIncidencia === 'string' &&
    numeroIncidencia.trim()
  ) {
    const existente = await Informe.findOne({
      numeroIncidencia: numeroIncidencia.trim(),
      _id: { $ne: id }
    });

    if (existente) {
      const err = new Error('Ya existe un informe con ese número de incidencia.');
      err.status = 400;
      throw err;
    }
  }

  if (typeof title === 'string') {
    informe.title = title.trim();
  }

  if (typeof numeroIncidencia === 'string') {
    informe.numeroIncidencia = numeroIncidencia.trim();
  }

  if (typeof regional === 'string') {
    informe.regional = regional.trim();
  }

  if (typeof includesActa === 'boolean') {
    informe.includesActa = includesActa;
  }

  if (tiendaId !== undefined || tienda !== undefined) {
    const tiendaNormalizada = await resolverTiendaInforme({
      tiendaId,
      tienda
    });

    informe.tiendaId = tiendaNormalizada.tiendaId;
    informe.tiendaNombre = tiendaNormalizada.tiendaNombre;
    informe.tiendaRegional = tiendaNormalizada.tiendaRegional;
    informe.tiendaDepartamento = tiendaNormalizada.tiendaDepartamento;
    informe.tiendaCiudad = tiendaNormalizada.tiendaCiudad;
  }

  if (geolocalizacion !== undefined) {
    informe.geolocalizacion = normalizarGeolocalizacion(geolocalizacion);
  }

  await informe.save();

  return informe;
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
      deleted.push({
        id: ids[i],
        cloudResult: r.value.cloudResult
      });
    } else {
      failed.push({
        id: ids[i],
        reason: r.reason?.message || 'Error desconocido'
      });
    }
  });

  return {
    ok: failed.length === 0,
    deleted: deleted.length,
    failed,
    details: {
      deleted,
      failed
    }
  };
}

module.exports = {
  guardarInforme,
  editarInforme,
  eliminarInforme,
  eliminarInformesBulk
};
const crypto = require('crypto');
const mongoose = require('mongoose');
const Informe = require('../models/informe');
const InformeVersion = require('../models/informeVersion');
const Sesion = require('../models/sesion');
const Tienda = require('../models/tienda');
const cloudinary = require('../utils/cloudinary');
const { regenerarYSubirPdfInforme } = require('./pdfInformeService');

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

function valorComparable(valor) {
  if (valor === undefined) return null;
  if (valor === null) return null;

  if (valor instanceof Date) {
    return valor.toISOString();
  }

  if (mongoose.isValidObjectId(valor) && typeof valor !== 'object') {
    return valor.toString();
  }

  if (valor && typeof valor === 'object' && valor._id) {
    return valor._id.toString();
  }

  if (valor && typeof valor.toString === 'function' && valor.constructor?.name === 'ObjectId') {
    return valor.toString();
  }

  return valor;
}

function limpiarObjetoParaComparar(valor) {
  if (valor === undefined || valor === null) return null;

  if (valor instanceof Date) {
    return valor.toISOString();
  }

  if (Array.isArray(valor)) {
    return valor.map((item) => limpiarObjetoParaComparar(item));
  }

  if (valor && typeof valor === 'object') {
    if (valor.constructor?.name === 'ObjectId') {
      return valor.toString();
    }

    const obj = {};

    Object.keys(valor).forEach((key) => {
      if (key === '_id') return;
      obj[key] = limpiarObjetoParaComparar(valor[key]);
    });

    return obj;
  }

  return valor;
}

function sonIguales(anterior, nuevo) {
  return JSON.stringify(limpiarObjetoParaComparar(anterior)) === JSON.stringify(limpiarObjetoParaComparar(nuevo));
}

function agregarCambio(cambios, campo, anterior, nuevo) {
  if (sonIguales(anterior, nuevo)) return;

  cambios.push({
    campo,
    anterior: limpiarObjetoParaComparar(anterior),
    nuevo: limpiarObjetoParaComparar(nuevo)
  });
}

function normalizarArchivoVersion(item = {}) {
  const plain = typeof item.toObject === 'function' ? item.toObject() : item;

  return {
    url: limpiarTexto(plain.url),
    publicId: limpiarTexto(plain.publicId || plain.public_id),
    public_id: limpiarTexto(plain.public_id || plain.publicId),
    nombreOriginal: limpiarTexto(plain.nombreOriginal),
    nombreArchivoOriginal: limpiarTexto(plain.nombreArchivoOriginal),
    mimeType: limpiarTexto(plain.mimeType || plain.mimetype),
    tipo: limpiarTexto(plain.tipo),
    ubicacion: limpiarTexto(plain.ubicacion),
    observacion: limpiarTexto(plain.observacion),
    fechaSubida: normalizarFecha(plain.fechaSubida) || null,
    width: normalizarNumero(plain.width),
    height: normalizarNumero(plain.height),
    escaneada: Boolean(plain.escaneada),
    crop: plain.crop || null
  };
}

function normalizarListaArchivosVersion(lista = []) {
  if (!Array.isArray(lista)) return [];

  return lista.map((item) => normalizarArchivoVersion(item));
}

function crearSnapshotInforme(informe) {
  const data = typeof informe.toObject === 'function'
    ? informe.toObject({ depopulate: true })
    : informe;

  return {
    title: data.title || '',
    generatedBy: data.generatedBy || null,
    sesionId: data.sesionId || '',
    url: data.url || '',
    publicId: data.publicId || '',
    mimeType: data.mimeType || 'application/pdf',
    includesActa: Boolean(data.includesActa),
    numeroIncidencia: data.numeroIncidencia || '',
    regional: data.regional || 'OTRA',
    tiendaId: data.tiendaId || null,
    tiendaNombre: data.tiendaNombre || '',
    tiendaRegional: data.tiendaRegional || '',
    tiendaDepartamento: data.tiendaDepartamento || '',
    tiendaCiudad: data.tiendaCiudad || '',
    geolocalizacion: data.geolocalizacion || {
      latitud: null,
      longitud: null,
      precision: null,
      altitud: null,
      precisionAltitud: null,
      fechaCaptura: null,
      mapsUrl: '',
      origen: 'none'
    },
    versionActual: data.versionActual || 1,
    editadoPor: data.editadoPor || null,
    editadoEn: data.editadoEn || null,
    evidenciasPrevias: normalizarListaArchivosVersion(data.evidenciasPrevias),
    evidenciasPosteriores: normalizarListaArchivosVersion(data.evidenciasPosteriores),
    acta: normalizarArchivoVersion(data.acta || {}),
    actaImagenes: normalizarListaArchivosVersion(data.actaImagenes),
    fuentesPersistentes: Boolean(data.fuentesPersistentes),
    createdAt: data.createdAt || null
  };
}

async function obtenerNumeroVersionDisponible(informeId, versionSugerida = 1) {
  const ultima = await InformeVersion.findOne({ informeId })
    .sort({ version: -1 })
    .lean();

  const versionUltima = Number(ultima?.version || 0);
  const versionBase = Number(versionSugerida || 1);

  return Math.max(versionBase, versionUltima + 1, 1);
}

async function guardarVersionActual({
  informe,
  editadoPor = null,
  cambios = [],
  motivo = ''
}) {
  const snapshot = crearSnapshotInforme(informe);
  const version = await obtenerNumeroVersionDisponible(informe._id, snapshot.versionActual || 1);

  await InformeVersion.create({
    informeId: informe._id,
    version,
    title: snapshot.title,
    generatedBy: snapshot.generatedBy,
    editadoPor,
    sesionId: snapshot.sesionId,
    pdf: {
      url: snapshot.url,
      publicId: snapshot.publicId,
      mimeType: snapshot.mimeType
    },
    url: snapshot.url,
    publicId: snapshot.publicId,
    mimeType: snapshot.mimeType,
    includesActa: snapshot.includesActa,
    numeroIncidencia: snapshot.numeroIncidencia,
    regional: snapshot.regional,
    tiendaId: snapshot.tiendaId,
    tiendaNombre: snapshot.tiendaNombre,
    tiendaRegional: snapshot.tiendaRegional,
    tiendaDepartamento: snapshot.tiendaDepartamento,
    tiendaCiudad: snapshot.tiendaCiudad,
    geolocalizacion: snapshot.geolocalizacion,
    evidenciasPrevias: snapshot.evidenciasPrevias,
    evidenciasPosteriores: snapshot.evidenciasPosteriores,
    acta: snapshot.acta,
    actaImagenes: snapshot.actaImagenes,
    cambios,
    motivo: limpiarTexto(motivo),
    snapshot
  });

  return version + 1;
}

async function calcularSiguienteVersionActual(informe) {
  const versionHistorica = await obtenerNumeroVersionDisponible(
    informe._id,
    informe.versionActual || 1
  );

  return versionHistorica + 1;
}

function construirOverridePdf(valoresNuevos = {}) {
  const override = {};

  [
    'title',
    'numeroIncidencia',
    'regional',
    'tiendaNombre',
    'tiendaRegional',
    'tiendaDepartamento',
    'tiendaCiudad',
    'geolocalizacion',
    'evidenciasPrevias',
    'evidenciasPosteriores',
    'acta',
    'actaImagenes'
  ].forEach((key) => {
    if (valoresNuevos[key] !== undefined) {
      override[key] = valoresNuevos[key];
    }
  });

  return override;
}

async function intentarRegenerarPdfInforme({
  informe,
  valoresNuevos,
  cambios,
  nuevaVersionActual
}) {
  if (!informe.fuentesPersistentes) {
    return null;
  }

  const override = construirOverridePdf(valoresNuevos);

  const resultado = await regenerarYSubirPdfInforme({
    informe,
    override,
    versionActual: nuevaVersionActual
  });

  const pdfNuevo = {
    url: resultado.url,
    publicId: resultado.publicId,
    mimeType: resultado.mimeType || 'application/pdf',
    includesActa: Boolean(resultado.includesActa)
  };

  agregarCambio(
    cambios,
    'pdf',
    {
      url: informe.url,
      publicId: informe.publicId,
      mimeType: informe.mimeType,
      includesActa: informe.includesActa
    },
    pdfNuevo
  );

  return {
    ...pdfNuevo,
    fuentes: resultado.fuentes || null
  };
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
            geolocalizacion: geolocalizacionNormalizada,
            versionActual: 1,
            fuentesPersistentes: false
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
  geolocalizacion = undefined,
  editadoPor = null,
  motivo = ''
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

  const cambios = [];
  const valoresNuevos = {};

  if (typeof title === 'string') {
    valoresNuevos.title = title.trim();
    agregarCambio(cambios, 'title', informe.title, valoresNuevos.title);
  }

  if (typeof numeroIncidencia === 'string') {
    valoresNuevos.numeroIncidencia = numeroIncidencia.trim();
    agregarCambio(cambios, 'numeroIncidencia', informe.numeroIncidencia, valoresNuevos.numeroIncidencia);
  }

  if (typeof regional === 'string') {
    valoresNuevos.regional = regional.trim();
    agregarCambio(cambios, 'regional', informe.regional, valoresNuevos.regional);
  }

  if (typeof includesActa === 'boolean') {
    valoresNuevos.includesActa = includesActa;
    agregarCambio(cambios, 'includesActa', informe.includesActa, valoresNuevos.includesActa);
  }

  if (tiendaId !== undefined || tienda !== undefined) {
    const tiendaNormalizada = await resolverTiendaInforme({
      tiendaId,
      tienda
    });

    valoresNuevos.tiendaId = tiendaNormalizada.tiendaId;
    valoresNuevos.tiendaNombre = tiendaNormalizada.tiendaNombre;
    valoresNuevos.tiendaRegional = tiendaNormalizada.tiendaRegional;
    valoresNuevos.tiendaDepartamento = tiendaNormalizada.tiendaDepartamento;
    valoresNuevos.tiendaCiudad = tiendaNormalizada.tiendaCiudad;

    agregarCambio(cambios, 'tiendaId', valorComparable(informe.tiendaId), valorComparable(valoresNuevos.tiendaId));
    agregarCambio(cambios, 'tiendaNombre', informe.tiendaNombre, valoresNuevos.tiendaNombre);
    agregarCambio(cambios, 'tiendaRegional', informe.tiendaRegional, valoresNuevos.tiendaRegional);
    agregarCambio(cambios, 'tiendaDepartamento', informe.tiendaDepartamento, valoresNuevos.tiendaDepartamento);
    agregarCambio(cambios, 'tiendaCiudad', informe.tiendaCiudad, valoresNuevos.tiendaCiudad);
  }

  if (geolocalizacion !== undefined) {
    valoresNuevos.geolocalizacion = normalizarGeolocalizacion(geolocalizacion);
    agregarCambio(cambios, 'geolocalizacion', informe.geolocalizacion, valoresNuevos.geolocalizacion);
  }

  if (cambios.length > 0) {
    const nuevaVersionActualSugerida = await calcularSiguienteVersionActual(informe);
    const pdfRegenerado = await intentarRegenerarPdfInforme({
      informe,
      valoresNuevos,
      cambios,
      nuevaVersionActual: nuevaVersionActualSugerida
    });

    if (pdfRegenerado) {
      valoresNuevos.url = pdfRegenerado.url;
      valoresNuevos.publicId = pdfRegenerado.publicId;
      valoresNuevos.mimeType = pdfRegenerado.mimeType;
      valoresNuevos.includesActa = pdfRegenerado.includesActa;

      if (pdfRegenerado.fuentes) {
        valoresNuevos.evidenciasPrevias = pdfRegenerado.fuentes.evidenciasPrevias;
        valoresNuevos.evidenciasPosteriores = pdfRegenerado.fuentes.evidenciasPosteriores;
        valoresNuevos.acta = pdfRegenerado.fuentes.acta;
        valoresNuevos.actaImagenes = pdfRegenerado.fuentes.actaImagenes;
        valoresNuevos.fuentesPersistentes = true;
      }
    }

    const nuevaVersionActual = await guardarVersionActual({
      informe,
      editadoPor,
      cambios,
      motivo
    });

    Object.keys(valoresNuevos).forEach((key) => {
      informe[key] = valoresNuevos[key];
    });

    informe.versionActual = nuevaVersionActual;
    informe.editadoPor = editadoPor || null;
    informe.editadoEn = new Date();

    await informe.save();
  }

  return informe;
}

async function listarVersionesInforme({
  informeId,
  page = 1,
  limit = 20
}) {
  if (!informeId || !mongoose.isValidObjectId(informeId)) {
    const err = new Error('Id de informe inválido.');
    err.status = 400;
    throw err;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const total = await InformeVersion.countDocuments({ informeId });

  const data = await InformeVersion.find({ informeId })
    .populate('generatedBy', 'usuario nombre')
    .populate('editadoPor', 'usuario nombre')
    .populate('tiendaId', 'nombre regional departamento ciudad')
    .sort({ version: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean();

  return {
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    data
  };
}

async function obtenerVersionInforme({
  informeId,
  versionId
}) {
  if (!informeId || !mongoose.isValidObjectId(informeId)) {
    const err = new Error('Id de informe inválido.');
    err.status = 400;
    throw err;
  }

  if (!versionId || !mongoose.isValidObjectId(versionId)) {
    const err = new Error('Id de versión inválido.');
    err.status = 400;
    throw err;
  }

  const version = await InformeVersion.findOne({
    _id: versionId,
    informeId
  })
    .populate('generatedBy', 'usuario nombre')
    .populate('editadoPor', 'usuario nombre')
    .populate('tiendaId', 'nombre regional departamento ciudad')
    .lean();

  if (!version) {
    const err = new Error('Versión no encontrada.');
    err.status = 404;
    throw err;
  }

  return version;
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
  eliminarInformesBulk,
  listarVersionesInforme,
  obtenerVersionInforme
};
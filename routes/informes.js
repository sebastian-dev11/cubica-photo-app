const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const streamifier = require('streamifier');
const router = express.Router();
const Informe = require('../models/informe');
const InformeVersion = require('../models/informeVersion');
const Tienda = require('../models/tienda');
const cloudinary = require('../utils/cloudinary');
const { procesarImagenActaSeguro } = require('../utils/actaScanner');
const { regenerarYSubirPdfInforme } = require('../services/pdfInformeService');
const {
  editarInforme,
  eliminarInforme,
  eliminarInformesBulk,
  listarVersionesInforme,
  obtenerVersionInforme
} = require('../services/informeService');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 80
  },
  fileFilter: (req, file, cb) => {
    const isImage = file.mimetype && file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';

    if (file.fieldname === 'acta') {
      return cb(null, isPdf || isImage);
    }

    return cb(null, isImage);
  }
});

function sanitizePagination(page, limit) {
  let p = parseInt(page, 10);
  let l = parseInt(limit, 10);

  if (!Number.isFinite(p) || p < 1) p = 1;
  if (!Number.isFinite(l) || l < 1) l = 10;
  if (l > 100) l = 100;

  return { page: p, limit: l };
}

function computeShareUrl(inf) {
  return (
    inf?.url ||
    inf?.secure_url ||
    inf?.cloudinary?.secure_url ||
    null
  );
}

function getOwnerId(informe) {
  const generatedBy = informe?.generatedBy;

  if (!generatedBy) return null;

  if (typeof generatedBy === 'object' && generatedBy._id) {
    return generatedBy._id.toString();
  }

  return generatedBy.toString();
}

function esPropietario(informe, userId) {
  const ownerId = getOwnerId(informe);
  return Boolean(ownerId && userId && ownerId === userId);
}

function mapInforme(informe) {
  return {
    ...informe,
    shareUrl: computeShareUrl(informe)
  };
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

function parseJsonSeguro(valor, fallback = null) {
  if (valor === undefined || valor === null || valor === '') return fallback;

  if (typeof valor === 'object') return valor;

  try {
    return JSON.parse(valor);
  } catch {
    return fallback;
  }
}

function normalizarBoolean(valor) {
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') return ['true', '1', 'si', 'sí', 'yes'].includes(valor.toLowerCase().trim());

  return undefined;
}

function debeActualizarGeolocalizacion(body = {}) {
  const valor =
    body.actualizarGeolocalizacion !== undefined
      ? body.actualizarGeolocalizacion
      : body.actualizarGPS !== undefined
        ? body.actualizarGPS
        : body.actualizarGps;

  return normalizarBoolean(valor) === true;
}

function obtenerListaBody(body, key) {
  const valor = body?.[key];

  if (Array.isArray(valor)) return valor;

  const json = parseJsonSeguro(valor, null);

  if (Array.isArray(json)) return json;

  if (typeof valor === 'string' && valor.trim()) return [valor];

  return [];
}

function obtenerValorLista(lista, index) {
  if (!Array.isArray(lista)) return '';

  return limpiarTexto(lista[index] || '');
}

function normalizarGeolocalizacion(valor) {
  const data = parseJsonSeguro(valor, valor);

  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const latitud = normalizarNumero(data.latitud);
  const longitud = normalizarNumero(data.longitud);

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

  const mapsUrl = limpiarTexto(data.mapsUrl) || `https://www.google.com/maps?q=${latitud},${longitud}`;

  return {
    latitud,
    longitud,
    precision: normalizarNumero(data.precision),
    altitud: normalizarNumero(data.altitud),
    precisionAltitud: normalizarNumero(data.precisionAltitud),
    fechaCaptura: normalizarFecha(data.fechaCaptura) || new Date(),
    mapsUrl,
    origen: ['browser', 'manual'].includes(data.origen) ? data.origen : 'browser'
  };
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

function limpiarObjetoParaComparar(valor, vistos = new WeakSet()) {
  if (valor === undefined || valor === null) return null;

  if (valor instanceof Date) {
    return valor.toISOString();
  }

  if (valor && typeof valor === 'object') {
    if (vistos.has(valor)) {
      return null;
    }

    vistos.add(valor);

    if (valor.constructor?.name === 'ObjectId') {
      return valor.toString();
    }

    if (typeof valor.toObject === 'function') {
      return limpiarObjetoParaComparar(
        valor.toObject({
          depopulate: true,
          getters: false,
          virtuals: false
        }),
        vistos
      );
    }

    if (Array.isArray(valor)) {
      return valor.map((item) => limpiarObjetoParaComparar(item, vistos));
    }

    if (valor instanceof Buffer) {
      return null;
    }

    const obj = {};

    Object.keys(valor).forEach((key) => {
      if (key === '_id') return;
      if (key.startsWith('$')) return;
      if (key.startsWith('_')) return;

      obj[key] = limpiarObjetoParaComparar(valor[key], vistos);
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

async function guardarVersionActualAvanzada({ informe, editadoPor = null, cambios = [], motivo = '' }) {
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

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, res) => {
      if (err) return reject(err);
      return resolve(res);
    });

    streamifier.createReadStream(buffer).pipe(stream);
  });
}

async function subirImagenEvidencia(file, folder, datos = {}) {
  const result = await uploadBufferToCloudinary(file.buffer, {
    folder,
    resource_type: 'image'
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    public_id: result.public_id,
    nombreOriginal: limpiarTexto(file.originalname).replace(/\.[^.]+$/, ''),
    nombreArchivoOriginal: limpiarTexto(file.originalname),
    mimeType: limpiarTexto(file.mimetype),
    tipo: limpiarTexto(datos.tipo),
    ubicacion: limpiarTexto(datos.ubicacion),
    observacion: limpiarTexto(datos.observacion),
    fechaSubida: new Date(),
    orden: datos.orden || 0,
    width: result.width || null,
    height: result.height || null,
    escaneada: false,
    crop: null
  };
}

async function subirActaPdf(file, folder) {
  const result = await uploadBufferToCloudinary(file.buffer, {
    folder,
    resource_type: 'raw'
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    public_id: result.public_id,
    nombreOriginal: limpiarTexto(file.originalname).replace(/\.[^.]+$/, ''),
    nombreArchivoOriginal: limpiarTexto(file.originalname),
    mimeType: 'application/pdf',
    tipo: 'acta',
    ubicacion: '',
    observacion: '',
    fechaSubida: new Date(),
    orden: 0,
    width: null,
    height: null,
    escaneada: false,
    crop: null
  };
}

async function subirImagenActa(file, folder, orden = 0) {
  const procesada = await procesarImagenActaSeguro(file.buffer, {
    mimetype: file.mimetype,
    crop: true,
    scanMode: 'color'
  });

  const uploadOptions = {
    folder,
    resource_type: 'image'
  };

  if (procesada.procesada) {
    uploadOptions.format = 'jpg';
  }

  const result = await uploadBufferToCloudinary(procesada.buffer, uploadOptions);

  return {
    url: result.secure_url,
    publicId: result.public_id,
    public_id: result.public_id,
    nombreOriginal: limpiarTexto(file.originalname).replace(/\.[^.]+$/, ''),
    nombreArchivoOriginal: limpiarTexto(file.originalname),
    mimeType: procesada.mimetype || file.mimetype || 'image/jpeg',
    tipo: 'acta_imagen',
    ubicacion: '',
    observacion: '',
    fechaSubida: new Date(),
    orden,
    width: procesada.width || result.width || null,
    height: procesada.height || result.height || null,
    escaneada: Boolean(procesada.procesada),
    crop: procesada.crop || null
  };
}

async function resolverTiendaDesdeBody(tiendaId) {
  const id = limpiarTexto(tiendaId);

  if (!id || !mongoose.isValidObjectId(id)) {
    return null;
  }

  return Tienda.findById(id).lean();
}

async function obtenerInformePermitido(id, req) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error('Id de informe inválido');
    err.status = 400;
    throw err;
  }

  const informe = await Informe.findById(id)
    .populate('generatedBy', 'usuario nombre')
    .populate('tiendaId', 'nombre regional departamento ciudad')
    .lean();

  if (!informe) {
    const err = new Error('Informe no encontrado');
    err.status = 404;
    throw err;
  }

  if (!req.auth?.isAdmin && !esPropietario(informe, req.auth?.userId)) {
    const err = new Error('No autorizado para consultar este informe');
    err.status = 403;
    throw err;
  }

  return informe;
}

async function prepararValoresAvanzados({ req, informe }) {
  const body = req.body || {};
  const files = req.files || {};
  const valoresNuevos = {};
  const cambios = [];
  const baseFolder = `informes/${informe._id.toString()}/fuentes/v${(informe.versionActual || 1) + 1}`;

  if (typeof body.title === 'string') {
    valoresNuevos.title = limpiarTexto(body.title);
    agregarCambio(cambios, 'title', informe.title, valoresNuevos.title);
  }

  if (typeof body.numeroIncidencia === 'string') {
    valoresNuevos.numeroIncidencia = limpiarTexto(body.numeroIncidencia);
    agregarCambio(cambios, 'numeroIncidencia', informe.numeroIncidencia, valoresNuevos.numeroIncidencia);
  }

  if (typeof body.regional === 'string') {
    valoresNuevos.regional = limpiarTexto(body.regional);
    agregarCambio(cambios, 'regional', informe.regional, valoresNuevos.regional);
  }

  const includesActa = normalizarBoolean(body.includesActa);

  if (typeof includesActa === 'boolean') {
    valoresNuevos.includesActa = includesActa;
    agregarCambio(cambios, 'includesActa', informe.includesActa, valoresNuevos.includesActa);
  }

  if (body.tiendaId !== undefined) {
    const tienda = await resolverTiendaDesdeBody(body.tiendaId);

    valoresNuevos.tiendaId = tienda?._id || null;
    valoresNuevos.tiendaNombre = tienda?.nombre || '';
    valoresNuevos.tiendaRegional = tienda?.regional || '';
    valoresNuevos.tiendaDepartamento = tienda?.departamento || '';
    valoresNuevos.tiendaCiudad = tienda?.ciudad || '';

    agregarCambio(cambios, 'tiendaId', valorComparable(informe.tiendaId), valorComparable(valoresNuevos.tiendaId));
    agregarCambio(cambios, 'tiendaNombre', informe.tiendaNombre, valoresNuevos.tiendaNombre);
    agregarCambio(cambios, 'tiendaRegional', informe.tiendaRegional, valoresNuevos.tiendaRegional);
    agregarCambio(cambios, 'tiendaDepartamento', informe.tiendaDepartamento, valoresNuevos.tiendaDepartamento);
    agregarCambio(cambios, 'tiendaCiudad', informe.tiendaCiudad, valoresNuevos.tiendaCiudad);
  }

  if (body.geolocalizacion !== undefined && debeActualizarGeolocalizacion(body)) {
    valoresNuevos.geolocalizacion = normalizarGeolocalizacion(body.geolocalizacion);
    agregarCambio(cambios, 'geolocalizacion', informe.geolocalizacion, valoresNuevos.geolocalizacion);
  }

  const previas = files.fotosPrevias || [];
  const posteriores = files.fotosPosteriores || [];
  const actas = files.acta || [];
  const actaImagenes = files.actaImagenes || [];

  if (previas.length > 0) {
    const observaciones = obtenerListaBody(body, 'observacionesPrevias');
    const ubicaciones = obtenerListaBody(body, 'ubicacionesPrevias');
    const nuevasPrevias = [];

    for (let i = 0; i < previas.length; i++) {
      const item = await subirImagenEvidencia(previas[i], `${baseFolder}/previas`, {
        tipo: 'previa',
        orden: i,
        ubicacion: obtenerValorLista(ubicaciones, i),
        observacion: obtenerValorLista(observaciones, i)
      });

      nuevasPrevias.push(item);
    }

    valoresNuevos.evidenciasPrevias = nuevasPrevias;
    valoresNuevos.fuentesPersistentes = true;
    agregarCambio(cambios, 'evidenciasPrevias', informe.evidenciasPrevias, nuevasPrevias);
  }

  if (posteriores.length > 0) {
    const observaciones = obtenerListaBody(body, 'observacionesPosteriores');
    const ubicaciones = obtenerListaBody(body, 'ubicacionesPosteriores');
    const nuevasPosteriores = [];

    for (let i = 0; i < posteriores.length; i++) {
      const item = await subirImagenEvidencia(posteriores[i], `${baseFolder}/posteriores`, {
        tipo: 'posterior',
        orden: i,
        ubicacion: obtenerValorLista(ubicaciones, i),
        observacion: obtenerValorLista(observaciones, i)
      });

      nuevasPosteriores.push(item);
    }

    valoresNuevos.evidenciasPosteriores = nuevasPosteriores;
    valoresNuevos.fuentesPersistentes = true;
    agregarCambio(cambios, 'evidenciasPosteriores', informe.evidenciasPosteriores, nuevasPosteriores);
  }

  if (actas.length > 0) {
    const actaFile = actas[0];

    if (actaFile.mimetype === 'application/pdf') {
      const nuevaActa = await subirActaPdf(actaFile, `${baseFolder}/acta`);
      valoresNuevos.acta = nuevaActa;
      valoresNuevos.actaImagenes = [];
      valoresNuevos.includesActa = true;
      valoresNuevos.fuentesPersistentes = true;
      agregarCambio(cambios, 'acta', informe.acta, nuevaActa);
      agregarCambio(cambios, 'actaImagenes', informe.actaImagenes, []);
    } else if (actaFile.mimetype && actaFile.mimetype.startsWith('image/')) {
      const nuevaImagenActa = await subirImagenActa(actaFile, `${baseFolder}/acta_imagenes`, 0);
      valoresNuevos.acta = {};
      valoresNuevos.actaImagenes = [nuevaImagenActa];
      valoresNuevos.includesActa = true;
      valoresNuevos.fuentesPersistentes = true;
      agregarCambio(cambios, 'acta', informe.acta, {});
      agregarCambio(cambios, 'actaImagenes', informe.actaImagenes, [nuevaImagenActa]);
    }
  }

  if (actaImagenes.length > 0) {
    const nuevasImagenesActa = [];

    for (let i = 0; i < actaImagenes.length; i++) {
      const item = await subirImagenActa(actaImagenes[i], `${baseFolder}/acta_imagenes`, i);
      nuevasImagenesActa.push(item);
    }

    valoresNuevos.acta = {};
    valoresNuevos.actaImagenes = nuevasImagenesActa;
    valoresNuevos.includesActa = true;
    valoresNuevos.fuentesPersistentes = true;
    agregarCambio(cambios, 'acta', informe.acta, {});
    agregarCambio(cambios, 'actaImagenes', informe.actaImagenes, nuevasImagenesActa);
  }

  return {
    valoresNuevos,
    cambios
  };
}

router.get('/', async (req, res) => {
  try {
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const {
      search = '',
      userId,
      from,
      to,
      regional = '',
      incidencia = ''
    } = req.query;

    const isAdmin = Boolean(req.auth?.isAdmin);
    const currentUserId = req.auth?.userId;

    const query = {};

    if (search) {
      const rx = new RegExp(search, 'i');
      query.$or = [
        { title: rx },
        { numeroIncidencia: rx },
        { regional: rx },
        { tiendaNombre: rx },
        { tiendaRegional: rx },
        { tiendaDepartamento: rx },
        { tiendaCiudad: rx }
      ];
    }

    if (regional) {
      query.regional = regional;
    }

    if (incidencia) {
      query.numeroIncidencia = { $regex: new RegExp(incidencia, 'i') };
    }

    if (isAdmin) {
      if (userId) {
        if (!mongoose.isValidObjectId(userId)) {
          return res.status(400).json({
            error: 'Id de usuario inválido'
          });
        }

        query.generatedBy = userId;
      }
    } else {
      query.generatedBy = currentUserId;
    }

    if (from || to) {
      query.createdAt = {};

      if (from) {
        const d = new Date(from);
        if (!isNaN(d)) query.createdAt.$gte = d;
      }

      if (to) {
        const d = new Date(to);
        if (!isNaN(d)) query.createdAt.$lt = d;
      }

      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt;
      }
    }

    const total = await Informe.countDocuments(query);

    const informes = await Informe.find(query)
      .populate('generatedBy', 'usuario nombre')
      .populate('tiendaId', 'nombre regional departamento ciudad')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const data = informes.map(mapInforme);

    res.set('Cache-Control', 'no-store');

    return res.json({
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data
    });
  } catch (err) {
    console.error('Error obteniendo informes:', err);

    return res.status(500).json({
      error: 'Error al obtener informes'
    });
  }
});

router.get('/utils/ultimo-por-sesion', async (req, res) => {
  try {
    const targetSesionId = req.query.sesionId;

    if (!targetSesionId) {
      return res.status(400).json({
        error: 'Debe enviar ?sesionId=...'
      });
    }

    const isAdmin = Boolean(req.auth?.isAdmin);

    if (!isAdmin && targetSesionId !== req.auth?.sesionId) {
      return res.status(403).json({
        error: 'No autorizado para consultar esta sesión'
      });
    }

    const inf = await Informe.findOne({ sesionId: targetSesionId })
      .populate('generatedBy', 'usuario nombre')
      .populate('tiendaId', 'nombre regional departamento ciudad')
      .sort({ createdAt: -1 })
      .lean();

    if (!inf) {
      return res.status(404).json({
        error: 'No hay informes para esa sesión'
      });
    }

    if (!isAdmin && !esPropietario(inf, req.auth?.userId)) {
      return res.status(403).json({
        error: 'No autorizado para consultar este informe'
      });
    }

    return res.json(mapInforme(inf));
  } catch (err) {
    console.error('Error consultando último informe por sesión:', err);

    return res.status(500).json({
      error: 'Error al consultar'
    });
  }
});

router.get('/tienda/:tiendaId', async (req, res) => {
  try {
    const { tiendaId } = req.params;
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const {
      search = '',
      incidencia = '',
      from,
      to
    } = req.query;

    if (!mongoose.isValidObjectId(tiendaId)) {
      return res.status(400).json({
        error: 'Id de tienda inválido'
      });
    }

    const isAdmin = Boolean(req.auth?.isAdmin);
    const currentUserId = req.auth?.userId;

    const query = {
      tiendaId
    };

    if (!isAdmin) {
      query.generatedBy = currentUserId;
    }

    if (search) {
      const rx = new RegExp(search, 'i');
      query.$or = [
        { title: rx },
        { numeroIncidencia: rx },
        { regional: rx },
        { tiendaNombre: rx },
        { tiendaRegional: rx },
        { tiendaDepartamento: rx },
        { tiendaCiudad: rx }
      ];
    }

    if (incidencia) {
      query.numeroIncidencia = { $regex: new RegExp(incidencia, 'i') };
    }

    if (from || to) {
      query.createdAt = {};

      if (from) {
        const d = new Date(from);
        if (!isNaN(d)) query.createdAt.$gte = d;
      }

      if (to) {
        const d = new Date(to);
        if (!isNaN(d)) query.createdAt.$lt = d;
      }

      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt;
      }
    }

    const total = await Informe.countDocuments(query);

    const informes = await Informe.find(query)
      .populate('generatedBy', 'usuario nombre')
      .populate('tiendaId', 'nombre regional departamento ciudad')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const data = informes.map(mapInforme);

    res.set('Cache-Control', 'no-store');

    return res.json({
      ok: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data
    });
  } catch (err) {
    console.error('Error obteniendo historial por tienda:', err);

    return res.status(500).json({
      error: 'Error al obtener historial por tienda'
    });
  }
});

router.get('/:id/versiones', async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);

    await obtenerInformePermitido(id, req);

    const versiones = await listarVersionesInforme({
      informeId: id,
      page,
      limit
    });

    res.set('Cache-Control', 'no-store');

    return res.json({
      ok: true,
      ...versiones
    });
  } catch (err) {
    console.error('Error consultando versiones del informe:', err);

    return res.status(err.status || 500).json({
      error: err.message || 'Error al consultar versiones del informe'
    });
  }
});

router.get('/:id/versiones/:versionId', async (req, res) => {
  try {
    const { id, versionId } = req.params;

    await obtenerInformePermitido(id, req);

    const version = await obtenerVersionInforme({
      informeId: id,
      versionId
    });

    res.set('Cache-Control', 'no-store');

    return res.json({
      ok: true,
      version
    });
  } catch (err) {
    console.error('Error consultando versión del informe:', err);

    return res.status(err.status || 500).json({
      error: err.message || 'Error al consultar versión del informe'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const inf = await obtenerInformePermitido(id, req);

    return res.json(mapInforme(inf));
  } catch (err) {
    console.error('Error consultando informe:', err);

    return res.status(err.status || 500).json({
      error: err.message || 'Error al consultar informe'
    });
  }
});

router.post('/bulk-delete', async (req, res) => {
  try {
    if (!req.auth?.isAdmin) {
      return res.status(403).json({
        error: 'Solo admin puede eliminar informes.'
      });
    }

    const { ids } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'Debe enviar un arreglo "ids" con al menos un id.'
      });
    }

    const result = await eliminarInformesBulk({
      ids,
      requesterUserId: req.auth.userId,
      requesterSesionId: req.auth.sesionId,
      isAdmin: true
    });

    return res.json(result);
  } catch (err) {
    console.error('Error en bulk-delete informes:', err);

    return res.status(err.status || 500).json({
      error: err.message || 'Error al eliminar informes'
    });
  }
});

router.put(
  '/:id/editar-avanzado',
  upload.fields([
    { name: 'fotosPrevias', maxCount: 40 },
    { name: 'fotosPosteriores', maxCount: 40 },
    { name: 'acta', maxCount: 1 },
    { name: 'actaImagenes', maxCount: 20 }
  ]),
  async (req, res) => {
    try {
      if (!req.auth?.isAdmin) {
        return res.status(403).json({
          error: 'Solo admin puede editar informes.'
        });
      }

      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({
          error: 'Id de informe inválido'
        });
      }

      const informe = await Informe.findById(id);

      if (!informe) {
        return res.status(404).json({
          error: 'Informe no encontrado'
        });
      }

      if (typeof req.body?.numeroIncidencia === 'string' && req.body.numeroIncidencia.trim()) {
        const existente = await Informe.findOne({
          numeroIncidencia: req.body.numeroIncidencia.trim(),
          _id: { $ne: id }
        });

        if (existente) {
          return res.status(400).json({
            error: 'Ya existe un informe con ese número de incidencia.'
          });
        }
      }

      const { valoresNuevos, cambios } = await prepararValoresAvanzados({
        req,
        informe
      });

      if (cambios.length === 0) {
        const informePlano = informe.toObject();

        return res.json({
          ok: true,
          mensaje: 'No se detectaron cambios para actualizar',
          informe: mapInforme(informePlano)
        });
      }

      const versionSugerida = await obtenerNumeroVersionDisponible(informe._id, informe.versionActual || 1);
      const nuevaVersionActualSugerida = versionSugerida + 1;
      const resultadoPdf = await regenerarYSubirPdfInforme({
        informe,
        override: valoresNuevos,
        versionActual: nuevaVersionActualSugerida
      });

      const pdfNuevo = {
        url: resultadoPdf.url,
        publicId: resultadoPdf.publicId,
        mimeType: resultadoPdf.mimeType || 'application/pdf',
        includesActa: Boolean(resultadoPdf.includesActa)
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

      valoresNuevos.url = pdfNuevo.url;
      valoresNuevos.publicId = pdfNuevo.publicId;
      valoresNuevos.mimeType = pdfNuevo.mimeType;
      valoresNuevos.includesActa = pdfNuevo.includesActa;
      valoresNuevos.fuentesPersistentes = true;

      if (resultadoPdf.fuentes) {
        valoresNuevos.evidenciasPrevias = resultadoPdf.fuentes.evidenciasPrevias;
        valoresNuevos.evidenciasPosteriores = resultadoPdf.fuentes.evidenciasPosteriores;
        valoresNuevos.acta = resultadoPdf.fuentes.acta;
        valoresNuevos.actaImagenes = resultadoPdf.fuentes.actaImagenes;
      }

      const nuevaVersionActual = await guardarVersionActualAvanzada({
        informe,
        editadoPor: req.auth.userId,
        cambios,
        motivo: req.body?.motivo || ''
      });

      Object.keys(valoresNuevos).forEach((key) => {
        informe[key] = valoresNuevos[key];
      });

      informe.versionActual = nuevaVersionActual;
      informe.editadoPor = req.auth.userId;
      informe.editadoEn = new Date();

      await informe.save();

      const informeActualizado = await Informe.findById(id)
        .populate('generatedBy', 'usuario nombre')
        .populate('tiendaId', 'nombre regional departamento ciudad')
        .lean();

      return res.json({
        ok: true,
        mensaje: 'Informe actualizado correctamente',
        informe: mapInforme(informeActualizado)
      });
    } catch (err) {
      console.error('Error en edición avanzada de informe:', err);

      return res.status(err.status || 500).json({
        error: err.message || 'Error al actualizar informe'
      });
    }
  }
);

router.put('/:id', async (req, res) => {
  try {
    if (!req.auth?.isAdmin) {
      return res.status(403).json({
        error: 'Solo admin puede editar informes.'
      });
    }

    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        error: 'Id de informe inválido'
      });
    }

    const {
      title,
      numeroIncidencia,
      regional,
      includesActa,
      tiendaId,
      geolocalizacion,
      motivo
    } = req.body;

    const actualizarGeolocalizacion = debeActualizarGeolocalizacion(req.body || {});

    const informe = await editarInforme({
      id,
      title,
      numeroIncidencia,
      regional,
      includesActa,
      tiendaId,
      geolocalizacion: actualizarGeolocalizacion ? geolocalizacion : undefined,
      editadoPor: req.auth.userId,
      motivo
    });

    const informePlano = informe.toObject();

    return res.json({
      ok: true,
      mensaje: 'Informe actualizado correctamente',
      informe: mapInforme(informePlano)
    });
  } catch (err) {
    console.error('Error actualizando informe:', err);

    return res.status(err.status || 500).json({
      error: err.message || 'Error al actualizar informe'
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!req.auth?.isAdmin) {
      return res.status(403).json({
        error: 'Solo admin puede eliminar informes.'
      });
    }

    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        error: 'Id de informe inválido'
      });
    }

    const data = await eliminarInforme({
      id,
      requesterUserId: req.auth.userId,
      requesterSesionId: req.auth.sesionId,
      isAdmin: true
    });

    return res.json({
      ok: true,
      mensaje: 'Informe eliminado',
      ...data
    });
  } catch (err) {
    console.error('Error eliminando informe:', err);

    return res.status(err.status || 500).json({
      error: err.message || 'Error al eliminar informe'
    });
  }
});

module.exports = router;
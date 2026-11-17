const express = require('express');
const multer = require('multer');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const cloudinary = require('../utils/cloudinary');
const streamifier = require('streamifier');
const ActaDocumento = require('../models/actaDocumento');
const {
  procesarImagenActaSeguro,
  analizarDocumento,
  resolverCrop,
  normalizarScanMode,
  LIMITE_PIXELES_ENTRADA
} = require('../utils/actaScanner');
const {
  limpiarTexto,
  textoBusqueda,
  esSesionIdValido,
  esUrlCloudinarySegura
} = require('../utils/validaciones');

const router = express.Router();
const storage = multer.memoryStorage();
const actasEnMemoria = Object.create(null);

const MIME_IMAGENES_PERMITIDAS = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/tiff'
]);

const fileFilter = (req, file, cb) => {
  const isPdf = file.mimetype === 'application/pdf';
  const isImage = MIME_IMAGENES_PERMITIDAS.has(file.mimetype);

  if (isPdf || isImage) {
    return cb(null, true);
  }

  return cb(new Error('Tipo no permitido. Solo PDF o imágenes raster permitidas.'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 25,
    fields: 50,
    parts: 100
  }
});

const uploadActa = upload.fields([
  { name: 'acta', maxCount: 1 },
  { name: 'imagenes', maxCount: 20 },
  { name: 'imagen', maxCount: 20 },
  { name: 'paginas', maxCount: 20 }
]);

const uploadImagen = upload.fields([
  { name: 'imagen', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'foto', maxCount: 1 },
  { name: 'pagina', maxCount: 1 }
]);

const uploadPagina = upload.fields([
  { name: 'imagen', maxCount: 1 },
  { name: 'pagina', maxCount: 1 }
]);

function validarSesionPermitida(req, sesionId) {
  if (!req.auth) {
    const err = new Error('Autenticación requerida');
    err.status = 401;
    throw err;
  }

  if (!esSesionIdValido(sesionId)) {
    const err = new Error('sesionId inválido');
    err.status = 400;
    throw err;
  }

  if (req.auth.isAdmin) return;

  if (!sesionId || sesionId !== req.auth.sesionId) {
    const err = new Error('No autorizado para usar esta sesión');
    err.status = 403;
    throw err;
  }
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

async function eliminarCloudinary(publicId, resourceType) {
  if (!publicId) return false;

  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true
    });

    return true;
  } catch (error) {
    console.warn('No se pudo eliminar un recurso de Cloudinary:', error?.message || error);
    return false;
  }
}

function archivosDe(req, nombres = []) {
  if (req.file) return [req.file];

  if (!req.files) return [];

  return nombres.flatMap((nombre) => req.files[nombre] || []);
}

function normalizarImagen(img, indice) {
  return {
    url: img.url,
    public_id: img.public_id,
    nombre: textoBusqueda(img.nombre, 200),
    width: Number.isFinite(Number(img.width)) ? Number(img.width) : null,
    height: Number.isFinite(Number(img.height)) ? Number(img.height) : null,
    escaneada: Boolean(img.escaneada),
    scanMode: img.scanMode || 'clean',
    crop: img.crop || null,
    quad: img.quad || null,
    orden: Number.isFinite(Number(img.orden)) ? Number(img.orden) : indice,
    creadaEn: img.creadaEn || null
  };
}

function serializarDocumento(doc) {
  const imagenes = Array.isArray(doc.imagenes)
    ? doc.imagenes.map(normalizarImagen).sort((a, b) => a.orden - b.orden)
    : [];

  return {
    sesionId: doc.sesionId,
    usuarioId: doc.usuarioId || null,
    acta: doc.acta || null,
    imagenes
  };
}

async function cargarActaEnMemoria(sesionId) {
  if (!sesionId) return null;

  if (actasEnMemoria[sesionId]) {
    return actasEnMemoria[sesionId];
  }

  try {
    const doc = await ActaDocumento.findOne({ sesionId }).lean();

    if (!doc) return null;

    actasEnMemoria[sesionId] = serializarDocumento(doc);

    return actasEnMemoria[sesionId];
  } catch (error) {
    console.warn(
      'No se pudo cargar un acta desde MongoDB:',
      error?.message || error
    );

    return null;
  }
}

async function guardarActaEnDb(sesionId) {
  const store = actasEnMemoria[sesionId];

  if (!store) return false;

  try {
    await ActaDocumento.findOneAndUpdate(
      { sesionId },
      {
        $set: {
          sesionId,
          usuarioId: store.usuarioId || null,
          acta: store.acta || null,
          imagenes: (store.imagenes || []).map((img, indice) => ({
            ...img,
            orden: indice
          }))
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    return true;
  } catch (error) {
    console.error(
      'No se pudo persistir un acta:',
      error?.message || error
    );

    return false;
  }
}

async function eliminarActaEnDb(sesionId) {
  if (!sesionId) return false;

  try {
    await ActaDocumento.deleteOne({ sesionId });
    return true;
  } catch (error) {
    console.warn(
      'No se pudo eliminar un acta en MongoDB:',
      error?.message || error
    );

    return false;
  }
}

async function obtenerStore(sesionId, usuarioId) {
  let store = await cargarActaEnMemoria(sesionId);

  if (!store) {
    store = {
      sesionId,
      usuarioId: usuarioId || null,
      acta: null,
      imagenes: []
    };

    actasEnMemoria[sesionId] = store;
  }

  if (!store.usuarioId && usuarioId) {
    store.usuarioId = usuarioId;
  }

  return store;
}

function reordenarImagenes(store) {
  if (!store || !Array.isArray(store.imagenes)) return;

  store.imagenes.forEach((imagen, indice) => {
    imagen.orden = indice;
  });
}

function valorDeLista(valor, indice) {
  if (valor === undefined || valor === null || valor === '') return undefined;

  if (Array.isArray(valor)) {
    return valor[indice] ?? valor[0];
  }

  if (typeof valor === 'string' && valor.trim().startsWith('[')) {
    try {
      const lista = JSON.parse(valor);

      if (Array.isArray(lista)) {
        return lista[indice] ?? lista[0];
      }
    } catch (error) {
      return undefined;
    }
  }

  return indice === 0 ? valor : undefined;
}

function extraerQuad(req, indice) {
  const quadsRaw = req.body?.quads;

  if (quadsRaw) {
    let lista = quadsRaw;

    if (typeof lista === 'string') {
      try {
        lista = JSON.parse(lista);
      } catch (error) {
        lista = null;
      }
    }

    if (Array.isArray(lista) && lista.length > 0) {
      const pareceQuadSimple =
        lista.length === 4 &&
        lista.every(
          (punto) => Array.isArray(punto) || (punto && typeof punto === 'object')
        );

      if (pareceQuadSimple) {
        return indice === 0 ? lista : undefined;
      }

      return lista[indice] ?? lista[0];
    }
  }

  const desdeLista = valorDeLista(req.body?.quads, indice);

  if (desdeLista !== undefined) return desdeLista;

  return req.body?.quad;
}

function solicitaEscaneo(req) {
  const cuerpo = req.body || {};

  return [
    'scanMode',
    'scanModes',
    'modo',
    'crop',
    'crops',
    'quad',
    'quads',
    'maxWidth',
    'maxHeight',
    'quality'
  ].some(
    (clave) =>
      cuerpo[clave] !== undefined &&
      cuerpo[clave] !== null &&
      cuerpo[clave] !== ''
  );
}

function opcionesEscaneo(req, indice = 0) {
  const scanModeRaw =
    valorDeLista(req.body?.scanModes, indice) ??
    req.body?.scanMode ??
    req.body?.modo;

  const cropRaw =
    valorDeLista(req.body?.crops, indice) ??
    req.body?.crop;

  return {
    scanMode: normalizarScanMode(scanModeRaw, 'clean'),
    // Sin indicación explícita no se recorta: las páginas deben quedar completas.
    crop: cropRaw === undefined || cropRaw === null || cropRaw === '' ? false : resolverCrop(cropRaw),
    quad: extraerQuad(req, indice) || undefined,
    quadUnidades: req.body?.quadUnidades || undefined,
    maxWidth: req.body?.maxWidth,
    maxHeight: req.body?.maxHeight,
    quality: req.body?.quality
  };
}

async function subirImagenActa(file, sesionId) {
  // La subida es normal: se guarda la imagen tal cual llegó. El escaneo
  // (recorte/perspectiva/filtros) queda disponible solo de forma explícita
  // en /acta/procesar y no se aplica a las páginas almacenadas.
  const resultado = await procesarImagenActaSeguro(file.buffer, {
    sinProcesamiento: true,
    mimetype: file.mimetype
  });

  const subida = await uploadBufferToCloudinary(resultado.buffer, {
    folder: `actas/${sesionId}/imagenes`,
    resource_type: 'image'
  });

  return {
    url: subida.secure_url,
    public_id: subida.public_id,
    nombre: textoBusqueda(file.originalname, 200),
    width: resultado.width || subida.width || null,
    height: resultado.height || subida.height || null,
    escaneada: false,
    scanMode: 'original',
    crop: null,
    quad: null,
    orden: 0,
    creadaEn: new Date(),
    errorProcesamiento: resultado.error || null
  };
}

function respuestaStore(store, extra = {}) {
  const imagenes = store?.imagenes || [];

  return {
    ok: true,
    sesionId: store?.sesionId || null,
    acta: store?.acta || null,
    imagenes,
    paginas: imagenes.length,
    escaneadas: imagenes.filter((imagen) => imagen.escaneada).length,
    pdfPath: store?.sesionId ? `/acta/${store.sesionId}/pdf` : null,
    ...extra
  };
}

async function descargarBuffer(url) {
  if (!esUrlCloudinarySegura(url)) {
    throw new Error('URL de imagen no permitida');
  }

  const respuesta = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 50 * 1024 * 1024,
    maxRedirects: 0
  });

  return Buffer.from(respuesta.data);
}

router.post('/detectar', uploadImagen, async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.body?.sesionId || req.auth?.sesionId || '');

    validarSesionPermitida(req, sesionId);

    const file = archivosDe(req, ['imagen', 'image', 'foto', 'pagina'])[0];

    if (!file) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Falta la imagen a analizar'
      });
    }

    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El archivo debe ser una imagen'
      });
    }

    const opciones = opcionesEscaneo(req);
    const analisis = await analizarDocumento(file.buffer, opciones);

    if (!analisis) {
      return res.json({
        ok: true,
        detectado: false,
        quad: null,
        box: null,
        mensaje: 'No se detectó un documento. Usa el recorte completo o ajusta las esquinas manualmente.'
      });
    }

    return res.json({
      ok: true,
      ...analisis
    });
  } catch (error) {
    console.error('Error detectando documento:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.status ? error.message : 'No se pudo analizar la imagen'
    });
  }
});

router.post('/procesar', uploadImagen, async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.body?.sesionId || req.auth?.sesionId || '');

    validarSesionPermitida(req, sesionId);

    const file = archivosDe(req, ['imagen', 'image', 'foto', 'pagina'])[0];

    if (!file) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Falta la imagen a procesar'
      });
    }

    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El archivo debe ser una imagen'
      });
    }

    const opciones = opcionesEscaneo(req);
    const resultado = await procesarImagenActaSeguro(file.buffer, {
      ...opciones,
      sinProcesamiento: !solicitaEscaneo(req),
      mimetype: file.mimetype
    });

    const formatoJson =
      req.query.formato === 'json' ||
      req.body?.formato === 'json';

    if (formatoJson) {
      return res.json({
        ok: true,
        procesada: Boolean(resultado.procesada),
        scanMode: resultado.scanMode,
        width: resultado.width,
        height: resultado.height,
        crop: resultado.crop,
        quad: resultado.quad,
        metodo: resultado.metodo,
        error: resultado.error || null,
        imagen: `data:${resultado.mimetype};base64,${resultado.buffer.toString('base64')}`
      });
    }

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Acta-Escaneada', resultado.procesada ? '1' : '0');
    res.setHeader('X-Acta-Modo', resultado.scanMode || 'clean');
    res.setHeader('X-Acta-Metodo', resultado.metodo || 'completo');

    if (resultado.width) res.setHeader('X-Acta-Width', String(resultado.width));
    if (resultado.height) res.setHeader('X-Acta-Height', String(resultado.height));

    return res.type(resultado.mimetype).send(resultado.buffer);
  } catch (error) {
    console.error('Error procesando imagen de acta:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.status ? error.message : 'No se pudo procesar la imagen'
    });
  }
});

router.post('/subir', uploadActa, async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.body?.sesionId || req.auth?.sesionId || '');

    if (!sesionId) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Falta el sesionId'
      });
    }

    validarSesionPermitida(req, sesionId);

    const pdfFile = req.files?.acta?.[0] || null;
    const imageFiles = archivosDe(req, ['imagenes', 'imagen', 'paginas']);

    if (!pdfFile && imageFiles.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'No se subió ningún archivo'
      });
    }

    if (pdfFile && pdfFile.mimetype !== 'application/pdf') {
      return res.status(400).json({
        ok: false,
        mensaje: 'El campo "acta" debe ser un archivo PDF'
      });
    }

    const paginasInvalidas = imageFiles.filter(
      (file) => !file.mimetype || !file.mimetype.startsWith('image/')
    );

    if (paginasInvalidas.length > 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Las páginas del acta deben ser imágenes'
      });
    }

    const store = await obtenerStore(sesionId, req.auth?.userId);

    let actaSubida = null;

    if (pdfFile) {
      const pdfResult = await uploadBufferToCloudinary(pdfFile.buffer, {
        folder: `actas/${sesionId}`,
        resource_type: 'raw'
      });

      actaSubida = {
        url: pdfResult.secure_url,
        public_id: pdfResult.public_id,
        nombre: textoBusqueda(pdfFile.originalname, 200),
        mimetype: pdfFile.mimetype || 'application/pdf',
        size: pdfFile.size || pdfFile.buffer.length,
        subidaEn: new Date()
      };

      const anterior = store.acta;

      store.acta = actaSubida;

      if (anterior?.public_id && anterior.public_id !== actaSubida.public_id) {
        await eliminarCloudinary(anterior.public_id, 'raw');
      }
    }

    const nuevasImagenes = [];

    for (let indice = 0; indice < imageFiles.length; indice += 1) {
      const file = imageFiles[indice];
      const imagen = await subirImagenActa(file, sesionId);

      store.imagenes.push(imagen);
      nuevasImagenes.push(imagen);
    }

    reordenarImagenes(store);

    const persistido = await guardarActaEnDb(sesionId);

    return res.json({
      ...respuestaStore(store),
      mensaje: 'Carga y escaneo completados',
      acta: actaSubida || store.acta,
      imagenes: nuevasImagenes,
      persistido
    });
  } catch (error) {
    console.error('Error subiendo acta/imágenes:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.status ? error.message : 'Error al subir el acta o las imágenes'
    });
  }
});

router.post('/:sesionId/pagina', uploadPagina, async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.params.sesionId);

    validarSesionPermitida(req, sesionId);

    const file = archivosDe(req, ['imagen', 'pagina'])[0];

    if (!file) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Falta la imagen de la página'
      });
    }

    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La página del acta debe ser una imagen'
      });
    }

    const store = await obtenerStore(sesionId, req.auth?.userId);
    const imagen = await subirImagenActa(file, sesionId);

    store.imagenes.push(imagen);
    reordenarImagenes(store);

    const persistido = await guardarActaEnDb(sesionId);

    return res.status(201).json({
      ...respuestaStore(store),
      mensaje: 'Página escaneada y agregada',
      imagen,
      persistido
    });
  } catch (error) {
    console.error('Error agregando página al acta:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.status ? error.message : 'No se pudo agregar la página'
    });
  }
});

router.get('/:sesionId/pdf', async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.params.sesionId);

    validarSesionPermitida(req, sesionId);

    const store = await cargarActaEnMemoria(sesionId);

    if (!store || !Array.isArray(store.imagenes) || store.imagenes.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'El acta no tiene páginas escaneadas'
      });
    }

    const paginas = [];

    for (const imagen of store.imagenes) {
      try {
        const buffer = await descargarBuffer(imagen.url);

        if (!buffer || buffer.length === 0) continue;

        const metadata = await sharp(buffer, {
          limitInputPixels: LIMITE_PIXELES_ENTRADA,
          failOn: 'none'
        }).metadata();

        if (metadata.width && metadata.height) {
          paginas.push(buffer);
        } else {
          console.warn('Una página del acta no tiene dimensiones válidas');
        }
      } catch (error) {
        console.warn(
          'No se pudo descargar o validar una página del acta:',
          error?.message || error
        );
      }
    }

    if (paginas.length === 0) {
      return res.status(502).json({
        ok: false,
        mensaje: 'No se pudieron descargar las páginas del acta'
      });
    }

    const nombreArchivo = `ACTA-${sesionId.replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`;
    const descargar = ['1', 'true', 'si', 'sí'].includes(
      String(req.query.descargar || '').toLowerCase()
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${descargar ? 'attachment' : 'inline'}; filename="${nombreArchivo}"`
    );
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const doc = new PDFDocument({
      autoFirstPage: false,
      margin: 18,
      size: 'A4',
      info: {
        Title: `Acta escaneada ${sesionId}`,
        Author: 'Cubica PhotApp'
      }
    });

    doc.on('error', (error) => {
      console.error('Error generando PDF del acta:', error?.message || error);

      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          mensaje: 'No se pudo generar el PDF del acta'
        });
      } else {
        res.destroy();
      }
    });

    doc.pipe(res);

    for (const buffer of paginas) {
      let imagenPdf;

      try {
        imagenPdf = doc.openImage(buffer);
      } catch (error) {
        console.warn('Se omitió una página inválida al generar el acta:', error?.message || error);
        continue;
      }

      const horizontal = imagenPdf.width > imagenPdf.height;

      doc.addPage({
        size: 'A4',
        layout: horizontal ? 'landscape' : 'portrait',
        margin: 18
      });

      const margen = 18;
      const anchoDisponible = doc.page.width - margen * 2;
      const altoDisponible = doc.page.height - margen * 2;

      doc.image(imagenPdf, margen, margen, {
        fit: [anchoDisponible, altoDisponible],
        align: 'center',
        valign: 'center'
      });
    }

    doc.end();
  } catch (error) {
    console.error('Error generando PDF del acta:', error);

    if (res.headersSent) {
      return res.destroy();
    }

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.status ? error.message : 'No se pudo generar el PDF del acta'
    });
  }
});

router.patch('/:sesionId/orden', async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.params.sesionId);

    validarSesionPermitida(req, sesionId);

    const store = await cargarActaEnMemoria(sesionId);

    if (!store) {
      return res.status(404).json({
        ok: false,
        mensaje: 'No existe un acta para esta sesión'
      });
    }

    const entrada =
      req.body?.orden ||
      req.body?.paginas ||
      req.body?.imagenes;

    if (!Array.isArray(entrada) || entrada.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Envía un arreglo con el orden de las páginas'
      });
    }

    const claves = entrada
      .map((item) => {
        if (typeof item === 'string') return item;

        if (item && typeof item === 'object') {
          return item.public_id || item.publicId || item.id || item.url || '';
        }

        return '';
      })
      .filter(Boolean);

    if (claves.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'No se recibieron identificadores de páginas válidos'
      });
    }

    const posiciones = new Map();

    claves.forEach((clave, indice) => {
      if (!posiciones.has(clave)) {
        posiciones.set(clave, indice);
      }
    });

    const posicionDe = (imagen) => {
      const candidatos = [imagen.public_id, imagen.publicId, imagen.url].filter(Boolean);

      for (const candidato of candidatos) {
        if (posiciones.has(candidato)) return posiciones.get(candidato);
      }

      return Number.MAX_SAFE_INTEGER;
    };

    store.imagenes.sort((a, b) => posicionDe(a) - posicionDe(b));
    reordenarImagenes(store);

    const persistido = await guardarActaEnDb(sesionId);

    return res.json({
      ...respuestaStore(store),
      mensaje: 'Orden de páginas actualizado',
      persistido
    });
  } catch (error) {
    console.error('Error reordenando páginas del acta:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.status ? error.message : 'No se pudo actualizar el orden'
    });
  }
});

router.get('/:sesionId', async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.params.sesionId);

    if (!sesionId) {
      return res.status(400).json({
        ok: false,
        mensaje: 'sesionId inválido'
      });
    }

    validarSesionPermitida(req, sesionId);

    const store = await cargarActaEnMemoria(sesionId);

    if (!store) {
      return res.json({
        ok: true,
        sesionId,
        acta: null,
        imagenes: [],
        paginas: 0,
        escaneadas: 0,
        pdfPath: `/acta/${sesionId}/pdf`
      });
    }

    return res.json(respuestaStore(store));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.status ? error.message : 'Error al consultar acta'
    });
  }
});

router.delete('/:sesionId/item', async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.params.sesionId);
    const publicId = limpiarTexto(
      req.body?.public_id ||
      req.body?.publicId ||
      req.query?.public_id ||
      req.query?.publicId
    );

    if (!sesionId || !publicId) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Faltan sesionId o public_id'
      });
    }

    validarSesionPermitida(req, sesionId);

    const store = await cargarActaEnMemoria(sesionId);

    if (!store) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Archivo no encontrado en esta sesión'
      });
    }

    if (store.acta?.public_id === publicId) {
      await eliminarCloudinary(publicId, 'raw');
      store.acta = null;
    } else {
      const indice = store.imagenes.findIndex((imagen) => imagen.public_id === publicId);

      if (indice === -1) {
        return res.status(404).json({
          ok: false,
          mensaje: 'Archivo no encontrado en esta sesión'
        });
      }

      await eliminarCloudinary(publicId, 'image');
      store.imagenes.splice(indice, 1);
      reordenarImagenes(store);
    }

    const persistido = await guardarActaEnDb(sesionId);

    return res.json({
      ...respuestaStore(store),
      mensaje: 'Archivo eliminado',
      persistido
    });
  } catch (error) {
    console.error('Error eliminando archivo:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.status ? error.message : 'No se pudo eliminar el archivo'
    });
  }
});

router.delete('/:sesionId', async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.params.sesionId);

    if (!sesionId) {
      return res.status(400).json({
        ok: false,
        mensaje: 'sesionId inválido'
      });
    }

    validarSesionPermitida(req, sesionId);

    const store = await cargarActaEnMemoria(sesionId);
    const eliminados = {
      actaPdf: false,
      imagenes: 0
    };

    if (store?.acta?.public_id) {
      eliminados.actaPdf = await eliminarCloudinary(store.acta.public_id, 'raw');
    }

    if (Array.isArray(store?.imagenes)) {
      for (const imagen of store.imagenes) {
        if (!imagen?.public_id) continue;

        const eliminada = await eliminarCloudinary(imagen.public_id, 'image');

        if (eliminada) eliminados.imagenes += 1;
      }
    }

    delete actasEnMemoria[sesionId];
    await eliminarActaEnDb(sesionId);

    return res.json({
      ok: true,
      mensaje: 'Acta e imágenes eliminadas',
      eliminados
    });
  } catch (error) {
    console.error('Error eliminando acta:', error);

    return res.status(error.status || 500).json({
      ok: false,
      mensaje: error.status ? error.message : 'No se pudo eliminar el acta'
    });
  }
});

router.use((error, req, res, next) => {
  if (!error) return next();

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      mensaje: 'Error al recibir los archivos',
      detalle: error.message
    });
  }

  console.error('Error en el escáner de actas:', error);

  return res.status(error.status || 500).json({
    ok: false,
    mensaje: error.status ? error.message : 'Error interno en el escáner de actas'
  });
});

module.exports = {
  router,
  actasEnMemoria,
  cargarActaEnMemoria,
  guardarActaEnDb,
  eliminarActaEnDb
};

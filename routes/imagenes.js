const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');

const router = express.Router();
const Imagen = require('../models/imagen');
const cloudinary = require('../utils/cloudinary.js');
const {
  limpiarTexto,
  textoBusqueda,
  esSesionIdValido
} = require('../utils/validaciones');

const DIRECTORIO_UPLOADS = path.join(__dirname, '../uploads');
fs.mkdirSync(DIRECTORIO_UPLOADS, { recursive: true });

const MIME_A_EXTENSION = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/tiff': '.tiff'
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DIRECTORIO_UPLOADS),
  filename: (req, file, cb) => {
    const extension = MIME_A_EXTENSION[file.mimetype] || '.bin';
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (Object.prototype.hasOwnProperty.call(MIME_A_EXTENSION, file.mimetype)) {
    return cb(null, true);
  }

  return cb(new Error('Formato de imagen no permitido'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
    fields: 20,
    parts: 25
  }
});

function limpiarArchivoLocal(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn('No se pudo eliminar archivo temporal:', err?.message || err);
  }
}

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

  if (sesionId !== req.auth.sesionId) {
    const err = new Error('No autorizado para usar esta sesión');
    err.status = 403;
    throw err;
  }
}

router.post('/subir', upload.single('imagen'), async (req, res) => {
  const sesionId = limpiarTexto(req.body.sesionId || req.auth?.sesionId || '');
  const tipo = limpiarTexto(req.body.tipo);
  const ubicacion = textoBusqueda(req.body.ubicacion, 300);
  const observacion = textoBusqueda(req.body.observacion, 1000);

  try {
    if (!req.file || !tipo || !ubicacion) {
      limpiarArchivoLocal(req.file?.path);

      return res.status(400).json({
        mensaje: 'Falta imagen, tipo o ubicación'
      });
    }

    validarSesionPermitida(req, sesionId);

    if (!['previa', 'posterior'].includes(tipo)) {
      limpiarArchivoLocal(req.file.path);

      return res.status(400).json({
        mensaje: 'Tipo de imagen inválido. Debe ser "previa" o "posterior"'
      });
    }

    const resultado = await cloudinary.uploader.upload(req.file.path, {
      folder: `evidencias/${sesionId}`,
      resource_type: 'image'
    });

    const nombreOriginal = textoBusqueda(
      path.basename(req.file.originalname || ''),
      200
    );
    const nombreBase = nombreOriginal
      .replace(path.extname(nombreOriginal), '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'imagen';

    const nuevaImagen = new Imagen({
      nombreOriginal: nombreBase,
      nombreArchivoOriginal: nombreOriginal,
      url: resultado.secure_url,
      sesionId,
      tipo,
      ubicacion,
      observacion
    });

    await nuevaImagen.save();

    limpiarArchivoLocal(req.file.path);

    return res.status(201).json({
      mensaje: 'Imagen subida y registrada exitosamente',
      url: resultado.secure_url,
      sesionId,
      tipo,
      ubicacion
    });
  } catch (err) {
    limpiarArchivoLocal(req.file?.path);

    console.error('Error al subir imagen:', err?.message || err);

    return res.status(err.status || 500).json({
      mensaje: err.status ? err.message : 'Error interno al subir imagen'
    });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const Imagen = require('../models/imagen');
const cloudinary = require('../utils/cloudinary.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const nombre = `${Date.now()}${ext}`;
    cb(null, nombre);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype && file.mimetype.startsWith('image/')) {
    return cb(null, true);
  }

  return cb(new Error('Formato de imagen no permitido'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024
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

function limpiarTexto(valor) {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
}

function validarSesionPermitida(req, sesionId) {
  if (!req.auth) {
    const err = new Error('Autenticación requerida');
    err.status = 401;
    throw err;
  }

  if (req.auth.isAdmin) return;

  if (!sesionId || sesionId !== req.auth.sesionId) {
    const err = new Error('No autorizado para usar esta sesión');
    err.status = 403;
    throw err;
  }
}

router.post('/subir', upload.single('imagen'), async (req, res) => {
  const sesionId = limpiarTexto(req.body.sesionId || req.auth?.sesionId || '');
  const tipo = limpiarTexto(req.body.tipo);
  const ubicacion = limpiarTexto(req.body.ubicacion);
  const observacion = limpiarTexto(req.body.observacion);

  try {
    if (!req.file || !sesionId || !tipo || !ubicacion) {
      limpiarArchivoLocal(req.file?.path);

      return res.status(400).json({
        mensaje: 'Falta imagen, sesionId, tipo o ubicación'
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

    const nombreBase = path.basename(req.file.originalname, path.extname(req.file.originalname))
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_');

    const nuevaImagen = new Imagen({
      nombreOriginal: nombreBase,
      nombreArchivoOriginal: req.file.originalname,
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

    console.error('Error al subir imagen:', err);

    return res.status(err.status || 500).json({
      mensaje: err.status ? err.message : 'Error interno al subir imagen'
    });
  }
});

module.exports = router;
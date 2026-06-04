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
    const nombre = Date.now() + ext;
    cb(null, nombre);
  }
});


const fileFilter = (req, file, cb) => {
  const tiposPermitidos = ['image/jpeg', 'image/png', 'image/jpg', "image/*"];
  if (tiposPermitidos.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de imagen no permitido'), false);
  }
};

const upload = multer({ storage, fileFilter });


router.post('/subir', upload.single('imagen'), async (req, res) => {
  const { sesionId, tipo, ubicacion, observacion } = req.body;


  if (!req.file || !sesionId || !tipo || !ubicacion) {
    return res.status(400).json({ mensaje: 'Falta imagen, sesionId, tipo o ubicación' });
  }

  if (!['previa', 'posterior'].includes(tipo)) {
    return res.status(400).json({ mensaje: 'Tipo de imagen inválido. Debe ser "previa" o "posterior"' });
  }

  try {
    
    const resultado = await cloudinary.uploader.upload(req.file.path, {
      folder: 'mi-app'
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
      observacion: observacion || '' 
    });

    await nuevaImagen.save();

  
    fs.unlinkSync(req.file.path);

    res.status(201).json({
      mensaje: 'Imagen subida y registrada exitosamente',
      url: resultado.secure_url
    });
  } catch (err) {
    console.error('Error al subir imagen:', err);
    res.status(500).json({ mensaje: 'Error interno al subir imagen' });
  }
});

module.exports = router;

const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const router = express.Router();

// Configuración de multer en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Objeto temporal en memoria para asociar actas por sesión
const actasEnMemoria = {};

router.post('/subir', upload.single('acta'), async (req, res) => {
  const { sesionId } = req.body;

  if (!req.file) {
    return res.status(400).json({ mensaje: 'No se subió ningún archivo PDF' });
  }

  try {
    // Subir a Cloudinary (resource_type: 'raw' para PDF)
    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'actas', resource_type: 'raw' },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    // Guardar en memoria (URL + public_id para borrarlo luego)
    actasEnMemoria[sesionId] = {
      url: resultado.secure_url,
      public_id: resultado.public_id
    };

    res.json({ mensaje: 'Acta subida correctamente', url: resultado.secure_url });

  } catch (error) {
    console.error('Error subiendo acta a Cloudinary:', error);
    res.status(500).json({ mensaje: 'Error al subir el acta' });
  }
});

module.exports = { router, actasEnMemoria };

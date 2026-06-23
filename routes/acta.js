const express = require('express');
const multer = require('multer');
const cloudinary = require('../utils/cloudinary');
const streamifier = require('streamifier');
const { procesarImagenActaSeguro } = require('../utils/actaScanner');

const router = express.Router();
const storage = multer.memoryStorage();
const actasEnMemoria = {};

const fileFilter = (req, file, cb) => {
  const isPdf = file.mimetype === 'application/pdf';
  const isImage = file.mimetype && file.mimetype.startsWith('image/');

  if (isPdf || isImage) {
    return cb(null, true);
  }

  return cb(new Error('Tipo no permitido. Solo PDF o imágenes.'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 20
  }
});

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

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, res) => {
      if (err) return reject(err);
      return resolve(res);
    });

    streamifier.createReadStream(buffer).pipe(stream);
  });
}

async function subirImagenActaProcesada(img, sesionId) {
  const imagenProcesada = await procesarImagenActaSeguro(img.buffer, {
    mimetype: img.mimetype,
    crop: true,
    scanMode: 'color'
  });

  const uploadOptions = {
    folder: `actas/${sesionId}/imagenes`,
    resource_type: 'image'
  };

  if (imagenProcesada.procesada) {
    uploadOptions.format = 'jpg';
  }

  const result = await uploadBufferToCloudinary(imagenProcesada.buffer, uploadOptions);

  return {
    url: result.secure_url,
    public_id: result.public_id,
    escaneada: Boolean(imagenProcesada.procesada),
    width: imagenProcesada.width || result.width || null,
    height: imagenProcesada.height || result.height || null,
    crop: imagenProcesada.crop || null
  };
}

function obtenerItemSesion(sesionId, publicId) {
  const data = actasEnMemoria[sesionId];

  if (!data) return null;

  if (data.acta?.public_id === publicId) {
    return {
      tipo: 'raw',
      clase: 'acta'
    };
  }

  const imagen = data.imagenes.find((item) => item.public_id === publicId);

  if (imagen) {
    return {
      tipo: 'image',
      clase: 'imagen'
    };
  }

  return null;
}

router.post(
  '/subir',
  upload.fields([
    { name: 'acta', maxCount: 1 },
    { name: 'imagenes', maxCount: 20 }
  ]),
  async (req, res) => {
    try {
      const sesionId = limpiarTexto(req.body.sesionId || req.auth?.sesionId || '');

      if (!sesionId) {
        return res.status(400).json({
          mensaje: 'Falta el sesionId'
        });
      }

      validarSesionPermitida(req, sesionId);

      const pdfFile = req.files?.acta?.[0] || null;
      const imageFiles = req.files?.imagenes || [];

      if (!pdfFile && imageFiles.length === 0) {
        return res.status(400).json({
          mensaje: 'No se subió ningún archivo'
        });
      }

      if (!actasEnMemoria[sesionId]) {
        actasEnMemoria[sesionId] = {
          acta: null,
          imagenes: []
        };
      }

      let actaSubida = null;

      if (pdfFile) {
        const pdfResult = await uploadBufferToCloudinary(pdfFile.buffer, {
          folder: `actas/${sesionId}`,
          resource_type: 'raw'
        });

        actaSubida = {
          url: pdfResult.secure_url,
          public_id: pdfResult.public_id
        };

        actasEnMemoria[sesionId].acta = actaSubida;
      }

      const imagenesSubidas = [];

      for (const img of imageFiles) {
        const imagenSubida = await subirImagenActaProcesada(img, sesionId);
        imagenesSubidas.push(imagenSubida);
      }

      if (imagenesSubidas.length > 0) {
        actasEnMemoria[sesionId].imagenes.push(...imagenesSubidas);
      }

      return res.json({
        ok: true,
        mensaje: 'Carga completada',
        sesionId,
        acta: actaSubida,
        imagenes: imagenesSubidas
      });
    } catch (error) {
      console.error('Error subiendo acta/imagenes:', error);

      return res.status(error.status || 500).json({
        mensaje: error.status ? error.message : 'Error al subir el acta o las imágenes'
      });
    }
  }
);

router.get('/:sesionId', (req, res) => {
  try {
    const sesionId = limpiarTexto(req.params.sesionId);

    if (!sesionId) {
      return res.status(400).json({
        mensaje: 'sesionId inválido'
      });
    }

    validarSesionPermitida(req, sesionId);

    return res.json({
      ok: true,
      sesionId,
      ...(actasEnMemoria[sesionId] || {
        acta: null,
        imagenes: []
      })
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      mensaje: error.status ? error.message : 'Error al consultar acta'
    });
  }
});

router.delete('/:sesionId/item', async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.params.sesionId);
    const publicId = limpiarTexto(req.body?.public_id);

    if (!sesionId || !publicId) {
      return res.status(400).json({
        mensaje: 'Faltan sesionId o public_id'
      });
    }

    validarSesionPermitida(req, sesionId);

    const item = obtenerItemSesion(sesionId, publicId);

    if (!item) {
      return res.status(404).json({
        mensaje: 'Archivo no encontrado en esta sesión'
      });
    }

    await cloudinary.uploader.destroy(publicId, {
      resource_type: item.tipo
    });

    const data = actasEnMemoria[sesionId];

    if (data) {
      if (item.clase === 'acta') {
        data.acta = null;
      }

      if (item.clase === 'imagen') {
        data.imagenes = data.imagenes.filter((x) => x.public_id !== publicId);
      }
    }

    return res.json({
      ok: true,
      mensaje: 'Archivo eliminado'
    });
  } catch (error) {
    console.error('Error eliminando archivo:', error);

    return res.status(error.status || 500).json({
      mensaje: error.status ? error.message : 'No se pudo eliminar el archivo'
    });
  }
});

router.delete('/:sesionId', async (req, res) => {
  try {
    const sesionId = limpiarTexto(req.params.sesionId);

    if (!sesionId) {
      return res.status(400).json({
        mensaje: 'sesionId inválido'
      });
    }

    validarSesionPermitida(req, sesionId);

    const data = actasEnMemoria[sesionId];

    if (data?.acta?.public_id) {
      await cloudinary.uploader.destroy(data.acta.public_id, {
        resource_type: 'raw'
      });
    }

    if (Array.isArray(data?.imagenes)) {
      for (const img of data.imagenes) {
        if (img?.public_id) {
          await cloudinary.uploader.destroy(img.public_id, {
            resource_type: 'image'
          });
        }
      }
    }

    delete actasEnMemoria[sesionId];

    return res.json({
      ok: true,
      mensaje: 'Acta e imágenes eliminadas'
    });
  } catch (error) {
    console.error('Error eliminando acta:', error);

    return res.status(error.status || 500).json({
      mensaje: error.status ? error.message : 'No se pudo eliminar el acta'
    });
  }
});

module.exports = {
  router,
  actasEnMemoria
};
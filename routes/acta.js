// backend/acta.js
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const router = express.Router();

/* ========= Multer en memoria + filtro de tipos ========= */
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const isPdf = file.mimetype === 'application/pdf';
  const isImage = file.mimetype.startsWith('image/');
  if (isPdf || isImage) return cb(null, true);
  cb(new Error('Tipo no permitido. Solo PDF o imágenes.'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024, files: 20 }, 
});


const actasEnMemoria = {}; 

/* ========= Helper: subir buffer a Cloudinary ========= */
function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });
}


router.post(
  '/subir',
  upload.fields([
    { name: 'acta', maxCount: 1 },
    { name: 'imagenes', maxCount: 20 },
  ]),
  async (req, res) => {
    try {
      const { sesionId } = req.body;
      if (!sesionId) return res.status(400).json({ mensaje: 'Falta el sesionId' });

      const pdfFile = req.files?.acta?.[0] || null;
      const imageFiles = req.files?.imagenes || [];

      if (!pdfFile && imageFiles.length === 0) {
        return res.status(400).json({ mensaje: 'No se subió ningún archivo (PDF o imágenes)' });
      }

      if (!actasEnMemoria[sesionId]) {
        actasEnMemoria[sesionId] = { acta: null, imagenes: [] };
      }

      // PDF (resource_type: 'raw')
      let actaSubida = null;
      if (pdfFile) {
        const pdfResult = await uploadBufferToCloudinary(pdfFile.buffer, {
          folder: `actas/${sesionId}`,
          resource_type: 'raw',
        });
        actaSubida = { url: pdfResult.secure_url, public_id: pdfResult.public_id };
        actasEnMemoria[sesionId].acta = actaSubida;
      }

      // Imágenes (resource_type: 'image')
      let imagenesSubidas = [];
      if (imageFiles.length > 0) {
        const results = await Promise.all(
          imageFiles.map((img) =>
            uploadBufferToCloudinary(img.buffer, {
              folder: `actas/${sesionId}/imagenes`,
              resource_type: 'image',
            })
          )
        );
        imagenesSubidas = results.map((r) => ({ url: r.secure_url, public_id: r.public_id }));
        actasEnMemoria[sesionId].imagenes.push(...imagenesSubidas);
      }

      res.json({
        ok: true,
        mensaje: 'Carga completada',
        sesionId,
        acta: actaSubida,
        imagenes: imagenesSubidas,
      });
    } catch (error) {
      console.error('Error subiendo acta/imagenes:', error);
      res.status(500).json({ mensaje: 'Error al subir el acta o las imágenes' });
    }
  }
);

/* GET /:sesionId (ver lo guardado en memoria) ========= */
router.get('/:sesionId', (req, res) => {
  const { sesionId } = req.params;
  res.json({
    ok: true,
    sesionId,
    ...(actasEnMemoria[sesionId] || { acta: null, imagenes: [] }),
  });
});

/* DELETE /:sesionId/item (borra un archivo de Cloudinary y memoria)
Body JSON:
- public_id: string (obligatorio)
- tipo: 'raw' | 'image' (obligatorio)  -> 'raw' para PDF, 'image' para imágenes
*/
router.delete('/:sesionId/item', async (req, res) => {
  try {
    const { sesionId } = req.params;
    const { public_id, tipo } = req.body || {};
    if (!public_id || !tipo) {
      return res.status(400).json({ mensaje: 'Faltan public_id o tipo' });
    }

    await cloudinary.uploader.destroy(public_id, { resource_type: tipo });

    const data = actasEnMemoria[sesionId];
    if (data) {
      if (data.acta?.public_id === public_id) data.acta = null;
      data.imagenes = data.imagenes.filter((x) => x.public_id !== public_id);
    }

    res.json({ ok: true, mensaje: 'Archivo eliminado' });
  } catch (error) {
    console.error('Error eliminando archivo:', error);
    res.status(500).json({ mensaje: 'No se pudo eliminar el archivo' });
  }
});

/*DELETE /:sesionId (limpia memoria; NO borra Cloudinary) ========= */
router.delete('/:sesionId', (req, res) => {
  const { sesionId } = req.params;
  delete actasEnMemoria[sesionId];
  res.json({ ok: true, mensaje: 'Acta e imágenes eliminadas de memoria' });
});

module.exports = { router, actasEnMemoria };

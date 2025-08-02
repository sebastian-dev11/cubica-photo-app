const axios = require('axios');
const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const Imagen = require('../models/imagen');
const cloudinary = require('../utils/cloudinary');

router.get('/generar/:sesionId', async (req, res) => {
  const { sesionId } = req.params;

  try {
    const imagenes = await Imagen.find({ sesionId }).sort({ fechaSubida: 1 });

    if (imagenes.length === 0) {
      return res.status(404).send('No hay imágenes para esta sesión');
    }

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=informe_tecnico_${sesionId}.pdf`);
    doc.pipe(res);

    // 🎨 Portada estilizada
    const fechaActual = new Date().toLocaleString('es-CO', {
      dateStyle: 'full',
      timeStyle: 'short'
    });

    doc.fillColor('#007BFF').fontSize(26).text('Informe Técnico', { align: 'center' });
    doc.moveDown(2);
    doc.fillColor('black').fontSize(16).text(`Sesión: ${sesionId}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Generado: ${fechaActual}`, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(10).fillColor('gray')
      .text('Este informe contiene evidencia fotográfica del antes y después de la instalación.', { align: 'center' });
    doc.addPage();

    // 🔀 Emparejar por orden de subida
    const previas = imagenes.filter(img => img.tipo === 'previa').sort((a, b) => a.fechaSubida - b.fechaSubida);
    const posteriores = imagenes.filter(img => img.tipo === 'posterior').sort((a, b) => a.fechaSubida - b.fechaSubida);

    const pares = [];
    const minLength = Math.min(previas.length, posteriores.length);
    for (let i = 0; i < minLength; i++) {
      pares.push({ previa: previas[i], posterior: posteriores[i] });
    }

    const imageWidth = 240;
    const imageHeight = 170;
    const gapX = 50;
    const startX = doc.page.margins.left;
    let contadorPagina = 1;

    for (const { previa, posterior } of pares) {
      const previaImg = await axios.get(previa.url, { responseType: 'arraybuffer' });
      const posteriorImg = await axios.get(posterior.url, { responseType: 'arraybuffer' });

      let y = doc.y;

      doc.rect(startX - 10, y - 10, imageWidth * 2 + gapX + 20, imageHeight + 70)
        .fillOpacity(0.05).fill('#e6f0ff').fillOpacity(1);

      doc.image(Buffer.from(previaImg.data), startX, y, { fit: [imageWidth, imageHeight] });
      doc.image(Buffer.from(posteriorImg.data), startX + imageWidth + gapX, y, { fit: [imageWidth, imageHeight] });

      doc.fillColor('#003366').fontSize(12);
      doc.text('Antes de la instalación', startX, y + imageHeight + 5, { width: imageWidth, align: 'center' });
      doc.text('Después de la instalación', startX + imageWidth + gapX, y + imageHeight + 5, { width: imageWidth, align: 'center' });

      doc.moveDown().moveTo(startX, doc.y + 20).lineTo(550, doc.y + 20).strokeColor('#cccccc').stroke();
      doc.fontSize(10).fillColor('gray').text(`Página ${contadorPagina++}`, 500, 750, { align: 'right' });

      doc.addPage();
    }

    doc.end();

    // 🧹 Eliminar imágenes de Cloudinary y MongoDB
    for (const img of imagenes) {
      const publicId = getPublicIdFromUrl(img.url);
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (err) {
          console.warn(`⚠️ No se pudo eliminar ${publicId} de Cloudinary`);
        }
      }
    }

    await Imagen.deleteMany({ sesionId });
    console.log(`🧹 Imágenes de sesión ${sesionId} eliminadas`);
  } catch (err) {
    console.error('Error al generar PDF:', err);
    res.status(500).send('Error al generar el PDF');
  }
});

// 🔍 Obtener public_id desde la URL de Cloudinary
function getPublicIdFromUrl(url) {
  const match = url.match(/\/v\d+\/(.+)\.(jpg|png|jpeg)/);
  return match ? match[1] : null;
}

module.exports = router;

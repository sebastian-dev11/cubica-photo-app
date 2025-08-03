const axios = require('axios');
const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const Imagen = require('../models/imagen');
const cloudinary = require('../utils/cloudinary');

const LOGO_CUBICA_URL = 'https://res.cloudinary.com/drygjoxaq/image/upload/v1754102481/022e3445-0819-4ebc-962a-d9f0d772bf86_kmyqbw.jpg';
const LOGO_D1_URL = 'https://res.cloudinary.com/drygjoxaq/image/upload/v1754170886/D1_Logo_l5rfzk.jpg';

router.get('/generar/:sesionId', async (req, res) => {
  const { sesionId } = req.params;
  const ubicacion = req.query.ubicacion || 'Sitio no especificado';

  try {
    const imagenes = await Imagen.find({ sesionId }).sort({ fechaSubida: 1 });

    if (imagenes.length === 0) {
      return res.status(404).send('No hay imágenes para esta sesión');
    }

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=informe_tecnico_${sesionId}.pdf`);
    doc.pipe(res);

    const fechaActual = new Date().toLocaleString('es-CO', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'America/Bogota'
    });

    // 🧾 Portada con logo Cubica
    const logoCubica = await axios.get(LOGO_CUBICA_URL, { responseType: 'arraybuffer' });
    doc.image(Buffer.from(logoCubica.data), doc.page.width - 150, 40, { width: 120 });//Derecha

    const logoD1 = await axios.get(LOGO_D1_URL, { responseType: 'arraybuffer' });
    doc.image(Buffer.from(logoD1.data), 50, 40, { width: 100 }); // izquierda

    doc.fillColor('black').fontSize(24).text('Informe Técnico', 50, 100, { align: 'center' });
    doc.moveDown();
    doc.fillColor('black').fontSize(16).text(`Sesión: ${sesionId}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('black').text(ubicacion, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('black').text(`Generado: ${fechaActual}`, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(10).fillColor('gray')
      .text('Este informe contiene evidencia fotográfica del antes y después de la instalación.', { align: 'center', lineGap: 2 });
      
    doc.moveDown(0.5);

    // 🖼️ Agrupar y emparejar imágenes
    const previas = imagenes.filter(img => img.tipo === 'previa');
    const posteriores = imagenes.filter(img => img.tipo === 'posterior');

    const pares = [];
    const minLength = Math.min(previas.length, posteriores.length);
    for (let i = 0; i < minLength; i++) {
      pares.push({ previa: previas[i], posterior: posteriores[i] });
    }

    const imageWidth = 220;
    const imageHeight = 160;
    const gapX = 60;
    const startX = doc.page.margins.left;
    let y = doc.y;

    for (const { previa, posterior } of pares) {
      const previaImg = await axios.get(previa.url, { responseType: 'arraybuffer' });
      const posteriorImg = await axios.get(posterior.url, { responseType: 'arraybuffer' });

      doc.image(Buffer.from(previaImg.data), startX, y, { fit: [imageWidth, imageHeight] });
      doc.image(Buffer.from(posteriorImg.data), startX + imageWidth + gapX, y, { fit: [imageWidth, imageHeight] });

      doc.fontSize(11).fillColor('#003366');
      doc.text('Antes de la instalación', startX, y + imageHeight + 5, { width: imageWidth, align: 'center' });
      doc.text('Después de la instalación', startX + imageWidth + gapX, y + imageHeight + 5, { width: imageWidth, align: 'center' });

      y += imageHeight + 60;
      if (y + imageHeight > doc.page.height - 100) {
        doc.addPage();
        y = doc.y;
      }
    }

    doc.end();

    // 🧹 Eliminar imágenes
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
  } catch (err) {
    console.error('Error al generar PDF:', err);
    res.status(500).send('Error al generar el PDF');
  }
});

function getPublicIdFromUrl(url) {
  const match = url.match(/\/v\d+\/(.+)\.(jpg|png|jpeg)/);
  return match ? match[1] : null;
}

module.exports = router;

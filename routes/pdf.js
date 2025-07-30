const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const Imagen = require('../models/imagen');

router.get('/generar/:sesionId', async (req, res) => {
  const { sesionId } = req.params;

  try {
    const imagenes = await Imagen.find({ sesionId });

    if (imagenes.length === 0) {
      return res.status(404).send('No hay imágenes para esta sesión');
    }

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=informe_tecnico_${sesionId}.pdf`);
    doc.pipe(res);

    // 🏷️ Portada
    const fechaActual = new Date().toLocaleString('es-CO', {
      dateStyle: 'full',
      timeStyle: 'short'
    });

    doc.fontSize(26).text('Informe Técnico', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text(`Sesión ID: ${sesionId}`, { align: 'center' });
    doc.fontSize(14).text(`Fecha de generación: ${fechaActual}`, { align: 'center' });
    doc.addPage();

    // 🖼️ Agrupar imágenes por pares
    const previas = imagenes.filter(img => img.tipo === 'previa');
    const posteriores = imagenes.filter(img => img.tipo === 'posterior');

    const pares = [];

    previas.forEach(previa => {
      const posterior = posteriores.find(p => p.nombreOriginal === previa.nombreOriginal);
      if (posterior) {
        pares.push({ previa, posterior });
      }
    });

    const imageWidth = 250;
    const imageHeight = 180;
    const gapX = 40;
    const gapY = 40;
    const startX = doc.page.margins.left;

    for (let i = 0; i < pares.length; i += 2) {
      const par1 = pares[i];
      const par2 = pares[i + 1];

      let y = doc.y;

      // Primer par
      if (par1) {
        doc.image(par1.previa.url, startX, y, { fit: [imageWidth, imageHeight] });
        doc.image(par1.posterior.url, startX + imageWidth + gapX, y, { fit: [imageWidth, imageHeight] });

        doc.fontSize(12).text('Foto previa a la instalación', startX, y + imageHeight + 5, {
          width: imageWidth,
          align: 'center'
        });
        doc.text('Foto posterior a la instalación', startX + imageWidth + gapX, y + imageHeight + 5, {
          width: imageWidth,
          align: 'center'
        });

        y += imageHeight + gapY + 20;
      }

      // Segundo par
      if (par2) {
        doc.image(par2.previa.url, startX, y, { fit: [imageWidth, imageHeight] });
        doc.image(par2.posterior.url, startX + imageWidth + gapX, y, { fit: [imageWidth, imageHeight] });

        doc.fontSize(12).text('Foto previa a la instalación', startX, y + imageHeight + 5, {
          width: imageWidth,
          align: 'center'
        });
        doc.text('Foto posterior a la instalación', startX + imageWidth + gapX, y + imageHeight + 5, {
          width: imageWidth,
          align: 'center'
        });
      }

      doc.addPage();
    }

    doc.end();
  } catch (err) {
    console.error('Error al generar PDF:', err);
    res.status(500).send('Error al generar el PDF');
  }
});

module.exports = router;
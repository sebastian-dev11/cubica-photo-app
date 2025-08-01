/*const axios = require('axios');
const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const Imagen = require('../models/imagen');

// 🔁 Función para obtener el buffer de una imagen desde una URL
const obtenerBufferImagen = async (url) => {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data, 'binary');
};

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
        const previaBuffer1 = await obtenerBufferImagen(par1.previa.url);
        const posteriorBuffer1 = await obtenerBufferImagen(par1.posterior.url);

        doc.image(previaBuffer1, startX, y, { fit: [imageWidth, imageHeight] });
        doc.image(posteriorBuffer1, startX + imageWidth + gapX, y, { fit: [imageWidth, imageHeight] });

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
        const previaBuffer2 = await obtenerBufferImagen(par2.previa.url);
        const posteriorBuffer2 = await obtenerBufferImagen(par2.posterior.url);

        doc.image(previaBuffer2, startX, y, { fit: [imageWidth, imageHeight] });
        doc.image(posteriorBuffer2, startX + imageWidth + gapX, y, { fit: [imageWidth, imageHeight] });

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

module.exports = router;*/

const axios = require('axios');
const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const Imagen = require('../models/imagen');
const cloudinary = require('../utils/cloudinary');

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

    // 🎨 Portada estilizada
    const fechaActual = new Date().toLocaleString('es-CO', {
      dateStyle: 'full',
      timeStyle: 'short'
    });

    doc.fillColor('#003366')
      .fontSize(30)
      .text('📋 Informe Técnico', { align: 'center' });

    doc.moveDown();
    doc.fontSize(18).fillColor('black').text(`Sesión: ${sesionId}`, { align: 'center' });
    doc.fontSize(14).text(`Generado: ${fechaActual}`, { align: 'center' });

    doc.moveDown(4);
    doc.fontSize(12).fillColor('gray').text('Este informe contiene evidencia fotográfica del antes y después de la instalación.', {
      align: 'center'
    });

    doc.addPage();

    // 🖼️ Agrupar imágenes por nombre
    const previas = imagenes.filter(img => img.tipo === 'previa');
    const posteriores = imagenes.filter(img => img.tipo === 'posterior');

    const pares = [];
    previas.forEach(previa => {
      const posterior = posteriores.find(p => p.nombreOriginal === previa.nombreOriginal);
      if (posterior) {
        pares.push({ previa, posterior });
      }
    });

    const imageWidth = 240;
    const imageHeight = 170;
    const gapX = 50;
    const startX = doc.page.margins.left;
    let contadorPagina = 1;

    for (let i = 0; i < pares.length; i++) {
      const { previa, posterior } = pares[i];

      const previaImg = await axios.get(previa.url, { responseType: 'arraybuffer' });
      const posteriorImg = await axios.get(posterior.url, { responseType: 'arraybuffer' });

      let y = doc.y;

      doc.rect(startX - 10, y - 10, imageWidth * 2 + gapX + 20, imageHeight + 70)
        .fillOpacity(0.05).fill('#e6f0ff').fillOpacity(1);

      doc.image(Buffer.from(previaImg.data), startX, y, { fit: [imageWidth, imageHeight] });
      doc.image(Buffer.from(posteriorImg.data), startX + imageWidth + gapX, y, { fit: [imageWidth, imageHeight] });

      doc.fillColor('#003366').fontSize(12);
      doc.text('🔹 Antes de la instalación', startX, y + imageHeight + 5, { width: imageWidth, align: 'center' });
      doc.text('🔸 Después de la instalación', startX + imageWidth + gapX, y + imageHeight + 5, { width: imageWidth, align: 'center' });

      doc.moveDown().moveTo(startX, doc.y + 20).lineTo(550, doc.y + 20).strokeColor('#cccccc').stroke();

      doc.fontSize(10).fillColor('gray').text(`Página ${contadorPagina++}`, 500, 750, { align: 'right' });

      doc.addPage();
    }

    doc.end();

    // ✅ Después de generar el PDF: borrar imágenes
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

    // 🗑️ Eliminar documentos de MongoDB
    await Imagen.deleteMany({ sesionId });
    console.log(`🧹 Imágenes de sesión ${sesionId} eliminadas`);
  } catch (err) {
    console.error('Error al generar PDF:', err);
    res.status(500).send('Error al generar el PDF');
  }
});

// 🔍 Función para obtener el public_id desde la URL de Cloudinary
function getPublicIdFromUrl(url) {
  const match = url.match(/\/v\d+\/(.+)\.(jpg|png|jpeg)/);
  return match ? match[1] : null;
}

module.exports = router;

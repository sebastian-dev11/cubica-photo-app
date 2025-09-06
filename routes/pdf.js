// routes/pdf.js
const axios = require('axios');
const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const PDFMerger = require('pdf-merger-js');

const Imagen = require('../models/imagen');
const { actasEnMemoria } = require('./acta');
const Tienda = require('../models/tienda');
const { guardarInforme } = require('../services/informeService');
const cloudinary = require('../utils/cloudinary');

const LOGO_CUBICA_URL = 'https://res.cloudinary.com/drygjoxaq/image/upload/v1754102481/022e3445-0819-4ebc-962a-d9f0d772bf86_kmyqbw.jpg';
const LOGO_D1_URL = 'https://res.cloudinary.com/drygjoxaq/image/upload/v1754170886/D1_Logo_l5rfzk.jpg';

/* ========= Helper seguro para descargar binarios ========= */
async function safeGetBuffer(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(resp.data);
  } catch (err) {
    console.warn('No se pudo descargar:', url, err?.message || err);
    return null;
  }
}

router.get('/generar/:sesionId', async (req, res) => {
  const { sesionId } = req.params;
  const { tiendaId } = req.query;
  let ubicacion = req.query.ubicacion || 'Sitio no especificado';

  // Enriquecer ubicación con datos de la tienda
  if (tiendaId) {
    try {
      const tienda = await Tienda.findById(tiendaId);
      if (tienda) {
        ubicacion = `${tienda.nombre} - ${tienda.departamento}, ${tienda.ciudad}`;
      }
    } catch (e) {
      console.warn('No se pudo obtener la tienda para el PDF:', e?.message || e);
    }
  }

  const tempDir = path.join(__dirname, '../uploads/temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const pdfImagenesPath = path.join(tempDir, `pdf-imagenes-${sesionId}.pdf`);
  const pdfFinalPath = path.join(tempDir, `pdf-final-${sesionId}.pdf`);

  try {
    const imagenes = await Imagen.find({ sesionId }).sort({ fechaSubida: 1 });
    if (imagenes.length === 0) {
      return res.status(404).send('No hay imágenes para esta sesión');
    }

    // 1) PDF con imágenes
    await new Promise(async (resolve) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(pdfImagenesPath);
      doc.pipe(stream);

      const fechaActual = new Date().toLocaleString('es-CO', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'America/Bogota'
      });

      // Logos (seguros: si no descargan, se omiten)
      const logoCubicaBuf = await safeGetBuffer(LOGO_CUBICA_URL);
      if (logoCubicaBuf) doc.image(logoCubicaBuf, doc.page.width - 150, 40, { width: 120 });

      const logoD1Buf = await safeGetBuffer(LOGO_D1_URL);
      if (logoD1Buf) doc.image(logoD1Buf, 50, 40, { width: 100 });

      // Títulos
      doc.fillColor('black').fontSize(24).text('Informe Técnico', 50, 100, { align: 'center' });
      doc.moveDown();
      doc.fontSize(14).text(ubicacion, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Generado: ${fechaActual}`, { align: 'center' });
      doc.moveDown(2);
      doc.fontSize(10).fillColor('gray')
        .text('Este informe contiene evidencia fotográfica del antes y después de la instalación.', { align: 'center', lineGap: 2 });

      // Pares de imágenes
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

      for (let i = 0; i < pares.length; i++) {
        const { previa, posterior } = pares[i];

        const previaBuf = await safeGetBuffer(previa?.url);
        const posteriorBuf = await safeGetBuffer(posterior?.url);
        if (!previaBuf || !posteriorBuf) {
          console.warn('Se omite un par por URL inválida/indescargable');
          continue;
        }

        doc.image(previaBuf, startX, y, { fit: [imageWidth, imageHeight] });
        doc.image(posteriorBuf, startX + imageWidth + gapX, y, { fit: [imageWidth, imageHeight] });

        // Etiquetas
        doc.fontSize(11).fillColor('#003366')
          .text('Antes de la instalación', startX, y + imageHeight + 5, { width: imageWidth, align: 'center' })
          .text('Después de la instalación', startX + imageWidth + gapX, y + imageHeight + 5, { width: imageWidth, align: 'center' });

        // Observaciones
        doc.fontSize(9).fillColor('gray');
        let maxObsHeight = 0;
        if (previa.observacion) {
          const h = doc.heightOfString(previa.observacion, { width: imageWidth });
          doc.text(previa.observacion, startX, y + imageHeight + 25, { width: imageWidth, align: 'center' });
          maxObsHeight = Math.max(maxObsHeight, h);
        }
        if (posterior.observacion) {
          const h = doc.heightOfString(posterior.observacion, { width: imageWidth });
          doc.text(posterior.observacion, startX + imageWidth + gapX, y + imageHeight + 25, { width: imageWidth, align: 'center' });
          maxObsHeight = Math.max(maxObsHeight, h);
        }

        // Línea divisoria
        const lineaY = y + imageHeight + 25 + maxObsHeight + 10;
        doc.moveTo(startX, lineaY).lineTo(startX + imageWidth * 2 + gapX, lineaY)
          .strokeColor('#cccccc').lineWidth(0.5).stroke();

        y = lineaY + 20;

        if ((i + 1) % 2 === 0 && i !== pares.length - 1) {
          doc.addPage();
          y = doc.y;
        }
      }

      doc.end();
      stream.on('finish', resolve);
    });

    // 2) Fusionar con acta si existe (compatible con estructura nueva y antigua)
    const merger = new PDFMerger();
    await merger.add(pdfImagenesPath);

    const store = actasEnMemoria[sesionId]; // puede ser { acta:{url,public_id}, imagenes:[] } o { url, public_id }
    const actaUrl = store?.acta?.url || store?.url || null;
    const actaPublicId = store?.acta?.public_id || store?.public_id || null;
    const hadActa = Boolean(actaUrl);

    if (hadActa) {
      const actaPath = path.join(tempDir, `acta-${sesionId}.pdf`);
      try {
        const actaBuf = await safeGetBuffer(actaUrl);
        if (actaBuf && actaBuf.slice(0, 4).toString('utf8') === '%PDF') {
          fs.writeFileSync(actaPath, actaBuf);
          await merger.add(actaPath);
        } else {
          console.warn(`El acta para ${sesionId} no es un PDF válido o no se pudo descargar`);
        }
        if (actaPublicId) {
          try {
            await cloudinary.uploader.destroy(actaPublicId, { resource_type: 'raw' });
          } catch (e) {
            console.warn('No se pudo borrar acta en Cloudinary:', e?.message || e);
          }
        }
      } finally {
        if (fs.existsSync(actaPath)) fs.unlinkSync(actaPath);
        // mantener imágenes de acta en memoria si existieran; solo limpiamos el PDF para no re-duplicar
        if (store?.acta) store.acta = null;
        else delete actasEnMemoria[sesionId]; // compat antigua
      }
    }

    await merger.save(pdfFinalPath);

    // 3) Guardar en Cloudinary + Mongo mediante el servicio
    try {
      const finalBuffer = fs.readFileSync(pdfFinalPath);
      await guardarInforme({
        title: `Informe técnico ${sesionId}`,
        sesionId,
        buffer: finalBuffer,
        includesActa: hadActa
      });
    } catch (err) {
      console.error(`Error guardando informe ${sesionId}:`, err);
    }

    // 4) Descargar al cliente
    res.download(pdfFinalPath, `informe_tecnico_${sesionId}.pdf`, () => {
      if (fs.existsSync(pdfImagenesPath)) fs.unlinkSync(pdfImagenesPath);
      if (fs.existsSync(pdfFinalPath)) fs.unlinkSync(pdfFinalPath);
    });

    // 5) Limpieza de imágenes originales en Cloudinary y base de datos
    for (const img of imagenes) {
      const publicId = getPublicIdFromUrl(img.url);
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (err) {
          console.warn(`No se pudo eliminar ${publicId} de Cloudinary:`, err?.message || err);
        }
      }
    }

    // Eliminar registros de esas imágenes en Mongo
    await Imagen.deleteMany({ sesionId });

  } catch (err) {
    console.error('Error al generar PDF:', err);
    res.status(500).send('Error al generar el PDF');
  }
});

// Utilidad: extrae publicId desde una URL de Cloudinary
function getPublicIdFromUrl(url) {
  const match = (url || '').match(/\/v\d+\/(.+)\.(jpg|png|jpeg)/);
  return match ? match[1] : null;
}

module.exports = router;

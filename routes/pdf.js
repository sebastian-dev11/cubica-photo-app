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

// Descarga binarios de forma segura
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

// Dibuja imagen centrada en una caja
function centerImageInBox(doc, imgBuffer, boxX, boxY, boxW, boxH) {
  const img = doc.openImage(imgBuffer);
  const iw = img.width || 1;
  const ih = img.height || 1;
  const scale = Math.min(boxW / iw, boxH / ih);
  const drawW = Math.max(1, Math.floor(iw * scale));
  const drawH = Math.max(1, Math.floor(ih * scale));
  const drawX = boxX + Math.floor((boxW - drawW) / 2);
  const drawY = boxY + Math.floor((boxH - drawH) / 2);
  doc.image(imgBuffer, drawX, drawY, { width: drawW, height: drawH });
  return { drawX, drawY, drawW, drawH };
}

// Extrae publicId desde URL de Cloudinary (evidencias)
function getPublicIdFromUrl(url) {
  const match = (url || '').match(/\/v\d+\/(.+)\.(jpg|png|jpeg)/);
  return match ? match[1] : null;
}

// Limpia archivos temporales por sesionId
function cleanupTempsBySession(sesionId) {
  try {
    const tempDir = path.join(__dirname, '../uploads/temp');
    const toDelete = [
      path.join(tempDir, `pdf-imagenes-${sesionId}.pdf`),
      path.join(tempDir, `pdf-final-${sesionId}.pdf`),
      path.join(tempDir, `acta-${sesionId}.pdf`),
      path.join(tempDir, `acta-imgs-${sesionId}.pdf`)
    ];
    for (const p of toDelete) { if (fs.existsSync(p)) fs.unlinkSync(p); }
  } catch (e) {
    console.warn('No se pudo limpiar temporales por sesión:', sesionId, e?.message || e);
  }
}

// Destruye un recurso en Cloudinary con control de tipo
async function destroyCloudinary(publicId, resourceType) {
  try {
    if (!publicId) return { ok: false, error: 'publicId vacío' };
    const res = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    return { ok: true, res };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/* =========================================================
   NUEVA RUTA: reset de sesión (barrer evidencias y acta)
   Uso previsto desde el front al "Reiniciar flujo" o "Cerrar sesión"
   POST /pdf/session/reset/:sesionId
   Respuesta: { ok:true, deleted:{imagenesN, actaPdf, actaImgsN} }
========================================================= */
router.post('/session/reset/:sesionId', async (req, res) => {
  const { sesionId } = req.params;
  if (!sesionId || typeof sesionId !== 'string') {
    return res.status(400).json({ ok: false, error: 'sesionId inválido' });
  }

  const deleted = { imagenesN: 0, actaPdf: false, actaImgsN: 0 };
  try {
    // 1) Evidencias: borrar en Cloudinary y Mongo
    const imagenes = await Imagen.find({ sesionId }).lean();
    for (const img of imagenes) {
      const pid = getPublicIdFromUrl(img?.url);
      if (pid) {
        const r = await destroyCloudinary(pid, 'image');
        if (!r.ok) console.warn('No se pudo borrar evidencia en Cloudinary:', pid, r.error);
      }
    }
    if (imagenes.length > 0) {
      await Imagen.deleteMany({ sesionId });
      deleted.imagenesN = imagenes.length;
    }

    // 2) Acta en memoria: PDF y/o imágenes
    const store = actasEnMemoria[sesionId];
    if (store && typeof store === 'object') {
      if (store.acta && store.acta.public_id) {
        const r = await destroyCloudinary(store.acta.public_id, 'raw');
        if (!r.ok) console.warn('No se pudo borrar acta (PDF) en Cloudinary:', store.acta.public_id, r.error);
        deleted.actaPdf = true;
      }
      if (Array.isArray(store.imagenes) && store.imagenes.length > 0) {
        for (const it of store.imagenes) {
          if (it?.public_id) {
            const r = await destroyCloudinary(it.public_id, 'image');
            if (!r.ok) console.warn('No se pudo borrar imagen de acta en Cloudinary:', it.public_id, r.error);
            deleted.actaImgsN += 1;
          }
        }
      }
      delete actasEnMemoria[sesionId];
    }

    // 3) Limpiar temporales locales
    cleanupTempsBySession(sesionId);

    return res.status(200).json({ ok: true, deleted });
  } catch (e) {
    console.error('Error en reset de sesión:', sesionId, e?.message || e);
    return res.status(500).json({ ok: false, error: 'Error interno al resetear sesión' });
  }
});

router.get('/generar/:sesionId', async (req, res) => {
  const { sesionId } = req.params;
  const { tiendaId } = req.query;
  const wantsJson = req.query.format === 'json' || (req.get('accept') || '').includes('application/json');

  let ubicacion = req.query.ubicacion || 'Sitio no especificado';
  if (tiendaId) {
    try {
      const tienda = await Tienda.findById(tiendaId);
      if (tienda) ubicacion = `${tienda.nombre} - ${tienda.departamento}, ${tienda.ciudad}`;
    } catch (e) {
      console.warn('No se pudo obtener la tienda para el PDF:', e?.message || e);
    }
  }

  const tempDir = path.join(__dirname, '../uploads/temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const pdfImagenesPath = path.join(tempDir, `pdf-imagenes-${sesionId}.pdf`);
  const pdfFinalPath = path.join(tempDir, `pdf-final-${sesionId}.pdf`);

  // Limpia archivos temporales
  const cleanupTemps = () => {
    try {
      if (fs.existsSync(pdfImagenesPath)) fs.unlinkSync(pdfImagenesPath);
      if (fs.existsSync(pdfFinalPath)) fs.unlinkSync(pdfFinalPath);
      const maybeActaImgsPath = path.join(tempDir, `acta-imgs-${sesionId}.pdf`);
      if (fs.existsSync(maybeActaImgsPath)) fs.unlinkSync(maybeActaImgsPath);
    } catch (e) {
      console.warn('No se pudo limpiar temporales:', e?.message || e);
    }
  };

  // Limpia evidencias (Cloudinary + Mongo) en background
  const cleanupEvidencesAsync = async (imagenes) => {
    try {
      for (const img of imagenes || []) {
        const publicId = getPublicIdFromUrl(img.url);
        if (publicId) {
          try { await cloudinary.uploader.destroy(publicId); }
          catch (err) { console.warn(`No se pudo eliminar ${publicId} de Cloudinary:`, err?.message || err); }
        }
      }
      await Imagen.deleteMany({ sesionId });
    } catch (e) {
      console.warn('No se pudo limpiar evidencias:', e?.message || e);
    }
  };

  try {
    const imagenes = await Imagen.find({ sesionId }).sort({ fechaSubida: 1 });
    if (imagenes.length === 0) {
      return res.status(404).send('No hay imágenes para esta sesión');
    }

    // 1) PDF de evidencias
    await new Promise(async (resolve) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(pdfImagenesPath);
      doc.pipe(stream);

      const fechaActual = new Date().toLocaleString('es-CO', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'America/Bogota'
      });

      const logoCubicaBuf = await safeGetBuffer(LOGO_CUBICA_URL);
      if (logoCubicaBuf) doc.image(logoCubicaBuf, doc.page.width - 150, 40, { width: 120 });
      const logoD1Buf = await safeGetBuffer(LOGO_D1_URL);
      if (logoD1Buf) doc.image(logoD1Buf, 50, 40, { width: 100 });

      doc.fillColor('black').fontSize(24).text('Informe Técnico', 50, 100, { align: 'center' });
      doc.moveDown();
      doc.fontSize(14).text(ubicacion, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Generado: ${fechaActual}`, { align: 'center' });
      doc.moveDown(2);
      doc.fontSize(10).fillColor('gray')
        .text('Este informe contiene evidencia fotográfica del antes y después de la instalación.', { align: 'center', lineGap: 2 });

      const previas = imagenes.filter(img => img.tipo === 'previa');
      const posteriores = imagenes.filter(img => img.tipo === 'posterior');
      const pares = [];
      const minLength = Math.min(previas.length, posteriores.length);
      for (let i = 0; i < minLength; i++) pares.push({ previa: previas[i], posterior: posteriores[i] });

      const boxW = 220;
      const boxH = 160;
      const gapX = 60;
      const startX = doc.page.margins.left;
      let y = doc.y;

      for (let i = 0; i < pares.length; i++) {
        const { previa, posterior } = pares[i];
        const previaBuf = await safeGetBuffer(previa?.url);
        const posteriorBuf = await safeGetBuffer(posterior?.url);
        if (!previaBuf || !posteriorBuf) continue;

        const leftX = startX;
        const rightX = startX + boxW + gapX;

        centerImageInBox(doc, previaBuf, leftX, y, boxW, boxH);
        centerImageInBox(doc, posteriorBuf, rightX, y, boxW, boxH);

        const labelsY = y + boxH + 5;
        doc.fontSize(11).fillColor('#003366')
          .text('Antes de la instalación', leftX, labelsY, { width: boxW, align: 'center' })
          .text('Después de la instalación', rightX, labelsY, { width: boxW, align: 'center' });

        doc.fontSize(9).fillColor('gray');
        const obsY = labelsY + 20;
        let maxObsHeight = 0;
        if (previa.observacion) {
          const h = doc.heightOfString(previa.observacion, { width: boxW });
          doc.text(previa.observacion, leftX, obsY, { width: boxW, align: 'center' });
          maxObsHeight = Math.max(maxObsHeight, h);
        }
        if (posterior.observacion) {
          const h = doc.heightOfString(posterior.observacion, { width: boxW });
          doc.text(posterior.observacion, rightX, obsY, { width: boxW, align: 'center' });
          maxObsHeight = Math.max(maxObsHeight, h);
        }

        const lineaY = obsY + maxObsHeight + 10;
        doc.moveTo(startX, lineaY).lineTo(startX + boxW * 2 + gapX, lineaY)
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

    // 2) Fusionar con ACTA
    const merger = new PDFMerger();
    await merger.add(pdfImagenesPath);

    const store = actasEnMemoria[sesionId];
    const actaUrl = store?.acta?.url || store?.url || null;
    const actaPublicId = store?.acta?.public_id || store?.public_id || null;

    let hadActaPdf = false;
    let hadActaImgs = false;

    if (actaUrl) {
      const actaPath = path.join(__dirname, '../uploads/temp', `acta-${sesionId}.pdf`);
      try {
        const actaBuf = await safeGetBuffer(actaUrl);
        if (actaBuf && actaBuf.slice(0, 4).toString('utf8') === '%PDF') {
          fs.writeFileSync(actaPath, actaBuf);
          await merger.add(actaPath);
          hadActaPdf = true;
        } else {
          console.warn(`El acta para ${sesionId} no es un PDF válido o no se pudo descargar`);
        }
        if (actaPublicId) {
          try { await cloudinary.uploader.destroy(actaPublicId, { resource_type: 'raw' }); }
          catch (e) { console.warn('No se pudo borrar acta (PDF) en Cloudinary:', e?.message || e); }
        }
      } finally {
        if (fs.existsSync(actaPath)) fs.unlinkSync(actaPath);
        if (store?.acta) store.acta = null;
        else if (actaUrl) delete actasEnMemoria[sesionId];
      }
    }

    const actaImgsArray = Array.isArray(store?.imagenes) ? store.imagenes : [];
    let actaImgsPath = null;
    const actaImgsPublicIds = [];

    if (actaImgsArray.length > 0) {
      actaImgsPath = path.join(__dirname, '../uploads/temp', `acta-imgs-${sesionId}.pdf`);
      await new Promise(async (resolve) => {
        const doc = new PDFDocument({ autoFirstPage: false, margin: 40 });
        const stream = fs.createWriteStream(actaImgsPath);
        doc.pipe(stream);

        for (const it of actaImgsArray) {
          const imgBuf = await safeGetBuffer(it?.url);
          if (!imgBuf) continue;
          doc.addPage();
          const boxX = doc.page.margins.left;
          const boxY = doc.page.margins.top;
          const boxW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          const boxH = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
          centerImageInBox(doc, imgBuf, boxX, boxY, boxW, boxH);
          if (it?.public_id) actaImgsPublicIds.push(it.public_id);
        }

        doc.end();
        stream.on('finish', () => resolve());
      });

      if (fs.existsSync(actaImgsPath)) {
        await merger.add(actaImgsPath);
        hadActaImgs = true;
      }
    }

    await merger.save(pdfFinalPath);

    // Borrar imágenes del acta (Cloudinary) ahora que ya se incrustaron
    if (actaImgsPublicIds.length > 0) {
      for (const pid of actaImgsPublicIds) {
        try { await cloudinary.uploader.destroy(pid, { resource_type: 'image' }); }
        catch (e) { console.warn('No se pudo borrar imagen de acta en Cloudinary:', pid, e?.message || e); }
      }
    }

    if (store && Array.isArray(store.imagenes)) {
      store.imagenes = [];
      if (!store.acta || store.acta === null) {
        if (!hadActaPdf && store.imagenes.length === 0) delete actasEnMemoria[sesionId];
      }
    }

    // 3) Sube a Cloudinary + guarda en Mongo. Debe devolver metadata con url.
    let uploadMeta = null;
    try {
      const finalBuffer = fs.readFileSync(pdfFinalPath);
      uploadMeta = await guardarInforme({
        title: `Informe técnico ${sesionId}`,
        sesionId,
        buffer: finalBuffer,
        includesActa: hadActaPdf || hadActaImgs
      });
    } catch (err) {
      console.error(`Error guardando informe ${sesionId}:`, err);
    }

    // 4) Responder en JSON o descargar
    if (wantsJson) {
      cleanupTemps();

      const cloudUrl =
        uploadMeta?.url ||
        uploadMeta?.secure_url ||
        uploadMeta?.cloudinary?.secure_url ||
        uploadMeta?.informe?.url ||
        null;

      if (!cloudUrl) {
        setImmediate(() => cleanupEvidencesAsync(imagenes));
        return res.status(500).json({ ok: false, error: 'No se obtuvo URL del informe en Cloudinary' });
      }

      setImmediate(() => cleanupEvidencesAsync(imagenes));

      return res.status(201).json({
        ok: true,
        url: cloudUrl,
        public_id: uploadMeta?.public_id || uploadMeta?.cloudinary?.public_id || uploadMeta?.informe?.public_id || null,
        includesActa: hadActaPdf || hadActaImgs,
        sesionId,
        tiendaId: tiendaId || null,
        ubicacion
      });
    }

    // Modo descarga: envía el archivo y limpia al terminar (incluye evidencias)
    res.download(pdfFinalPath, `informe_tecnico_${sesionId}.pdf`, () => {
      cleanupTemps();
      setImmediate(() => cleanupEvidencesAsync(imagenes));
    });

  } catch (err) {
    console.error('Error al generar PDF:', err);
    cleanupTemps();
    if (wantsJson) {
      return res.status(500).json({ ok: false, error: 'Error al generar el PDF' });
    }
    res.status(500).send('Error al generar el PDF');
  }
});

module.exports = router;

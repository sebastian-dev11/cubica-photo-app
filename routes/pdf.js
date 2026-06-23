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

const LOGO_CUBICA_URL = 'https://res.cloudinary.com/drygjoxaq/image/upload/v1773871245/LOGO_CUBICA_NUEVO_v3rsq5.jpg';
const LOGO_D1_URL = 'https://res.cloudinary.com/drygjoxaq/image/upload/v1773875275/D1_LOGO_NUEVO_kj1bdh.jpg';

function isCloudinaryUrl(url) {
  return typeof url === 'string' && /res\.cloudinary\.com/.test(url);
}

function insertTransformInCloudinaryUrl(url, transformStr) {
  try {
    if (!isCloudinaryUrl(url)) return url;

    const uploadSegment = '/upload/';
    const idx = url.indexOf(uploadSegment);

    if (idx === -1) return url;

    const afterUpload = url.slice(idx + uploadSegment.length);
    const alreadyHasTransforms = !afterUpload.startsWith('v');

    if (alreadyHasTransforms) return url;

    const before = url.slice(0, idx + uploadSegment.length);
    const after = url.slice(idx + uploadSegment.length);

    return `${before}${transformStr}/${after}`;
  } catch {
    return url;
  }
}

function buildTransformedUrl(url) {
  return insertTransformInCloudinaryUrl(url, 'f_jpg,q_75,w_1800');
}

function buildLogoUrl(url) {
  return insertTransformInCloudinaryUrl(url, 'f_png,q_auto,w_400');
}

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

function getPublicIdFromUrl(url) {
  const match = (url || '').match(/\/v\d+\/(.+)\.(jpg|png|jpeg|webp|gif|heic|heif|bmp|tif|tiff)/i);
  return match ? match[1] : null;
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

function cleanupTempsBySession(sesionId) {
  try {
    const tempDir = path.join(__dirname, '../uploads/temp');
    const toDelete = [
      path.join(tempDir, `pdf-imagenes-${sesionId}.pdf`),
      path.join(tempDir, `pdf-final-${sesionId}.pdf`),
      path.join(tempDir, `acta-${sesionId}.pdf`),
      path.join(tempDir, `acta-imgs-${sesionId}.pdf`)
    ];

    for (const p of toDelete) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) {
    console.warn('No se pudo limpiar temporales por sesión:', sesionId, e?.message || e);
  }
}

async function destroyCloudinary(publicId, resourceType) {
  try {
    if (!publicId) return { ok: false, error: 'publicId vacío' };

    const res = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });

    return { ok: true, res };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function normalizarNumero(valor) {
  const num = Number(valor);

  return Number.isFinite(num) ? num : null;
}

function normalizarFecha(valor) {
  if (!valor) return null;

  const fecha = new Date(valor);

  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function normalizarGeolocalizacionDesdeQuery(query = {}) {
  const latitud = normalizarNumero(query.latitud);
  const longitud = normalizarNumero(query.longitud);

  const tieneCoordenadas =
    latitud !== null &&
    longitud !== null &&
    latitud >= -90 &&
    latitud <= 90 &&
    longitud >= -180 &&
    longitud <= 180;

  if (!tieneCoordenadas) {
    return {
      latitud: null,
      longitud: null,
      precision: null,
      altitud: null,
      precisionAltitud: null,
      fechaCaptura: null,
      mapsUrl: '',
      origen: 'none'
    };
  }

  const mapsUrl =
    typeof query.mapsUrl === 'string' && query.mapsUrl.trim()
      ? query.mapsUrl.trim()
      : `https://www.google.com/maps?q=${latitud},${longitud}`;

  return {
    latitud,
    longitud,
    precision: normalizarNumero(query.precision),
    altitud: normalizarNumero(query.altitud),
    precisionAltitud: normalizarNumero(query.precisionAltitud),
    fechaCaptura: normalizarFecha(query.fechaCaptura) || new Date(),
    mapsUrl,
    origen: ['browser', 'manual'].includes(query.geoOrigen) ? query.geoOrigen : 'browser'
  };
}

function tieneGeolocalizacion(geolocalizacion) {
  return (
    geolocalizacion &&
    geolocalizacion.latitud !== null &&
    geolocalizacion.longitud !== null
  );
}

function formatearCoordenada(valor) {
  const num = Number(valor);

  if (!Number.isFinite(num)) return '';

  return num.toFixed(6);
}

function formatearFechaGeo(fecha) {
  try {
    return new Date(fecha).toLocaleString('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Bogota'
    });
  } catch {
    return '';
  }
}

function renderGeolocalizacion(doc, geolocalizacion) {
  if (!tieneGeolocalizacion(geolocalizacion)) {
    return;
  }

  const latitud = formatearCoordenada(geolocalizacion.latitud);
  const longitud = formatearCoordenada(geolocalizacion.longitud);
  const precision = normalizarNumero(geolocalizacion.precision);
  const fecha = formatearFechaGeo(geolocalizacion.fechaCaptura);
  const precisionTexto = precision !== null ? ` | Precisión: ${Math.round(precision)} m` : '';
  const fechaTexto = fecha ? ` | Capturada: ${fecha}` : '';

  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('gray').text(
    `GPS: ${latitud}, ${longitud}${precisionTexto}${fechaTexto}`,
    { align: 'center' }
  );

  if (geolocalizacion.mapsUrl) {
    doc.moveDown(0.1);
    doc.fontSize(9).fillColor('#003366').text(
      'Ver ubicación en Google Maps',
      {
        align: 'center',
        link: geolocalizacion.mapsUrl,
        underline: true
      }
    );
  }

  doc.fillColor('black');
}

function computeImagePageLayout(doc, pairsOnPage, contentTop, isFirstPage) {
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const marginTop = doc.page.margins.top;
  const marginBottom = doc.page.margins.bottom;

  const availableWidth = doc.page.width - marginLeft - marginRight;
  const gapX = 24;
  const boxW = Math.floor((availableWidth - gapX) / 2);

  const labelGap = 8;
  const labelH = 18;
  const obsGap = 6;
  const obsReserve = 36;
  const lineGap = 14;
  const bottomGap = isFirstPage ? 0 : 12;
  const firstPagePadding = isFirstPage ? 16 : 0;

  const pageTop = isFirstPage ? contentTop + 18 : marginTop;
  const pageBottom = doc.page.height - marginBottom;
  const availableHeight = Math.max(0, pageBottom - pageTop - firstPagePadding * 2);
  const reservedByPair = labelGap + labelH + obsGap + obsReserve + lineGap + bottomGap;
  const boxH = Math.max(180, Math.floor((availableHeight - pairsOnPage * reservedByPair) / pairsOnPage));
  const pairStepY = boxH + reservedByPair;
  const contentHeight = pairsOnPage * pairStepY;
  const startY = pageTop + firstPagePadding + Math.max(0, Math.floor((availableHeight - contentHeight) / 2));

  return {
    startX: marginLeft,
    gapX,
    boxW,
    boxH,
    labelGap,
    obsGap,
    pairStepY,
    startY
  };
}

async function renderEvidencePairs(doc, pares, firstPageTopY) {
  if (!Array.isArray(pares) || pares.length === 0) {
    return;
  }

  let index = 0;
  let isFirstPage = true;

  while (index < pares.length) {
    const pairsPerPage = isFirstPage ? 1 : 2;
    const pagePairs = pares.slice(index, index + pairsPerPage);

    if (!isFirstPage) {
      doc.addPage();
    }

    const layout = computeImagePageLayout(doc, pagePairs.length, firstPageTopY, isFirstPage);

    for (let i = 0; i < pagePairs.length; i++) {
      const { previa, posterior } = pagePairs[i];
      const y = layout.startY + i * layout.pairStepY;

      const previaUrl = isCloudinaryUrl(previa?.url) ? buildTransformedUrl(previa.url) : previa?.url;
      const posteriorUrl = isCloudinaryUrl(posterior?.url) ? buildTransformedUrl(posterior.url) : posterior?.url;

      const previaBuf = await safeGetBuffer(previaUrl);
      const posteriorBuf = await safeGetBuffer(posteriorUrl);

      if (!previaBuf || !posteriorBuf) {
        continue;
      }

      const leftX = layout.startX;
      const rightX = layout.startX + layout.boxW + layout.gapX;

      centerImageInBox(doc, previaBuf, leftX, y, layout.boxW, layout.boxH);
      centerImageInBox(doc, posteriorBuf, rightX, y, layout.boxW, layout.boxH);

      const labelsY = y + layout.boxH + layout.labelGap;

      doc.fontSize(12).fillColor('#003366')
        .text('Antes de la instalación', leftX, labelsY, { width: layout.boxW, align: 'center' })
        .text('Después de la instalación', rightX, labelsY, { width: layout.boxW, align: 'center' });

      const obsY = labelsY + 20;
      let maxObsHeight = 0;

      doc.fontSize(9).fillColor('gray');

      if (previa.observacion) {
        const h = doc.heightOfString(previa.observacion, { width: layout.boxW });
        doc.text(previa.observacion, leftX, obsY, { width: layout.boxW, align: 'center' });
        maxObsHeight = Math.max(maxObsHeight, h);
      }

      if (posterior.observacion) {
        const h = doc.heightOfString(posterior.observacion, { width: layout.boxW });
        doc.text(posterior.observacion, rightX, obsY, { width: layout.boxW, align: 'center' });
        maxObsHeight = Math.max(maxObsHeight, h);
      }

      const lineY = obsY + maxObsHeight + 14;

      doc.moveTo(layout.startX, lineY)
        .lineTo(layout.startX + layout.boxW * 2 + layout.gapX, lineY)
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .stroke();
    }

    index += pagePairs.length;
    isFirstPage = false;
  }
}

router.post('/session/reset/:sesionId', async (req, res) => {
  const { sesionId } = req.params;

  try {
    if (!sesionId || typeof sesionId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'sesionId inválido'
      });
    }

    validarSesionPermitida(req, sesionId);

    const deleted = {
      imagenesN: 0,
      actaPdf: false,
      actaImgsN: 0
    };

    const imagenes = await Imagen.find({ sesionId }).lean();

    for (const img of imagenes) {
      const pid = getPublicIdFromUrl(img?.url);

      if (pid) {
        const r = await destroyCloudinary(pid, 'image');

        if (!r.ok) {
          console.warn('No se pudo borrar evidencia en Cloudinary:', pid, r.error);
        }
      }
    }

    if (imagenes.length > 0) {
      await Imagen.deleteMany({ sesionId });
      deleted.imagenesN = imagenes.length;
    }

    const store = actasEnMemoria[sesionId];

    if (store && typeof store === 'object') {
      if (store.acta && store.acta.public_id) {
        const r = await destroyCloudinary(store.acta.public_id, 'raw');

        if (!r.ok) {
          console.warn('No se pudo borrar acta en Cloudinary:', store.acta.public_id, r.error);
        }

        deleted.actaPdf = true;
      }

      if (Array.isArray(store.imagenes) && store.imagenes.length > 0) {
        for (const it of store.imagenes) {
          if (it?.public_id) {
            const r = await destroyCloudinary(it.public_id, 'image');

            if (!r.ok) {
              console.warn('No se pudo borrar imagen de acta en Cloudinary:', it.public_id, r.error);
            }

            deleted.actaImgsN += 1;
          }
        }
      }

      delete actasEnMemoria[sesionId];
    }

    cleanupTempsBySession(sesionId);

    return res.status(200).json({
      ok: true,
      deleted
    });
  } catch (e) {
    console.error('Error en reset de sesión:', sesionId, e?.message || e);

    return res.status(e.status || 500).json({
      ok: false,
      error: e.status ? e.message : 'Error interno al resetear sesión'
    });
  }
});

router.get('/generar/:sesionId', async (req, res) => {
  const { sesionId } = req.params;
  const tiendaId = (req.query.tiendaId || '').toString().trim();
  const wantsJson = req.query.format === 'json' || (req.get('accept') || '').includes('application/json');
  const numeroIncidencia = (req.query.numeroIncidencia || '').toString().trim();
  const geolocalizacion = normalizarGeolocalizacionDesdeQuery(req.query);

  let ubicacion = req.query.ubicacion || 'Sitio no especificado';
  let regionalStr = '';
  let regionalBd = 'OTRA';
  let tiendaSeleccionada = null;

  try {
    validarSesionPermitida(req, sesionId);
  } catch (err) {
    if (wantsJson) {
      return res.status(err.status || 500).json({
        ok: false,
        error: err.message
      });
    }

    return res.status(err.status || 500).send(err.message);
  }

  if (tiendaId) {
    try {
      const tienda = await Tienda.findById(tiendaId).lean();

      if (tienda) {
        tiendaSeleccionada = tienda;
        ubicacion = `${tienda.nombre} - ${tienda.departamento}, ${tienda.ciudad}`;
        regionalStr = `Regional: ${tienda.regional}`;
        regionalBd = tienda.regional;
      }
    } catch (e) {
      console.warn('No se pudo obtener la tienda para el PDF:', e?.message || e);
    }
  }

  const tempDir = path.join(__dirname, '../uploads/temp');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const pdfImagenesPath = path.join(tempDir, `pdf-imagenes-${sesionId}.pdf`);
  const pdfFinalPath = path.join(tempDir, `pdf-final-${sesionId}.pdf`);

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

  const cleanupEvidencesAsync = async (imagenes) => {
    try {
      for (const img of imagenes || []) {
        const publicId = getPublicIdFromUrl(img.url);

        if (publicId) {
          try {
            await cloudinary.uploader.destroy(publicId, {
              resource_type: 'image'
            });
          } catch (err) {
            console.warn(`No se pudo eliminar ${publicId} de Cloudinary:`, err?.message || err);
          }
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
      if (wantsJson) {
        return res.status(404).json({
          ok: false,
          error: 'No hay imágenes para esta sesión'
        });
      }

      return res.status(404).send('No hay imágenes para esta sesión');
    }

    await new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const stream = fs.createWriteStream(pdfImagenesPath);

        doc.pipe(stream);

        const fechaActual = new Date().toLocaleString('es-CO', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone: 'America/Bogota'
        });

        const logoCubicaBuf = await safeGetBuffer(buildLogoUrl(LOGO_CUBICA_URL));

        if (logoCubicaBuf) {
          doc.image(logoCubicaBuf, doc.page.width - 150, 40, { width: 120 });
        }

        const logoD1Buf = await safeGetBuffer(buildLogoUrl(LOGO_D1_URL));

        if (logoD1Buf) {
          doc.image(logoD1Buf, 50, 40, { width: 100 });
        }

        doc.fillColor('black').fontSize(24).text('Informe técnico', 50, 100, { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text(ubicacion, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(12).text(`Generado: ${fechaActual}`, { align: 'center' });

        if (numeroIncidencia) {
          const display = numeroIncidencia.toString().replace(/\s+/g, ' ').trim();

          doc.moveDown(0.3);
          doc.fontSize(12).fillColor('black').text(`Incidencia: ${display}`, { align: 'center' });
        }

        if (regionalStr) {
          doc.moveDown(0.3);
          doc.fontSize(12).fillColor('black').text(regionalStr, { align: 'center' });
        }

        renderGeolocalizacion(doc, geolocalizacion);

        doc.moveDown(1.5);
        doc.fontSize(10).fillColor('gray').text(
          'Este informe contiene evidencia fotográfica del antes y después de la instalación.',
          { align: 'center', lineGap: 2 }
        );

        const firstPageTopY = doc.y;

        const previas = imagenes.filter((img) => img.tipo === 'previa');
        const posteriores = imagenes.filter((img) => img.tipo === 'posterior');
        const pares = [];
        const minLength = Math.min(previas.length, posteriores.length);

        for (let i = 0; i < minLength; i++) {
          pares.push({
            previa: previas[i],
            posterior: posteriores[i]
          });
        }

        await renderEvidencePairs(doc, pares, firstPageTopY);

        doc.end();

        stream.on('finish', resolve);
        stream.on('error', reject);
      } catch (err) {
        reject(err);
      }
    });

    const merger = new PDFMerger();

    await merger.add(pdfImagenesPath);

    const store = actasEnMemoria[sesionId];
    const actaUrl = store?.acta?.url || store?.url || null;
    const actaPublicId = store?.acta?.public_id || store?.public_id || null;

    let hadActaPdf = false;
    let hadActaImgs = false;

    if (actaUrl) {
      const actaPath = path.join(tempDir, `acta-${sesionId}.pdf`);

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
          try {
            await cloudinary.uploader.destroy(actaPublicId, {
              resource_type: 'raw'
            });
          } catch (e) {
            console.warn('No se pudo borrar acta en Cloudinary:', e?.message || e);
          }
        }
      } finally {
        if (fs.existsSync(actaPath)) fs.unlinkSync(actaPath);

        if (store?.acta) {
          store.acta = null;
        } else if (actaUrl) {
          delete actasEnMemoria[sesionId];
        }
      }
    }

    const actaImgsArray = Array.isArray(store?.imagenes) ? store.imagenes : [];
    let actaImgsPath = null;
    const actaImgsPublicIds = [];

    if (actaImgsArray.length > 0) {
      actaImgsPath = path.join(tempDir, `acta-imgs-${sesionId}.pdf`);

      await new Promise(async (resolve, reject) => {
        try {
          const doc = new PDFDocument({ autoFirstPage: false, margin: 40 });
          const stream = fs.createWriteStream(actaImgsPath);

          doc.pipe(stream);

          for (const it of actaImgsArray) {
            const imgUrl = isCloudinaryUrl(it?.url) ? buildTransformedUrl(it.url) : it?.url;
            const imgBuf = await safeGetBuffer(imgUrl);

            if (!imgBuf) continue;

            doc.addPage();

            const boxX = doc.page.margins.left;
            const boxY = doc.page.margins.top;
            const boxW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
            const boxH = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

            centerImageInBox(doc, imgBuf, boxX, boxY, boxW, boxH);

            if (it?.public_id) {
              actaImgsPublicIds.push(it.public_id);
            }
          }

          doc.end();

          stream.on('finish', resolve);
          stream.on('error', reject);
        } catch (err) {
          reject(err);
        }
      });

      if (fs.existsSync(actaImgsPath)) {
        await merger.add(actaImgsPath);
        hadActaImgs = true;
      }
    }

    await merger.save(pdfFinalPath);

    if (actaImgsPublicIds.length > 0) {
      for (const pid of actaImgsPublicIds) {
        try {
          await cloudinary.uploader.destroy(pid, {
            resource_type: 'image'
          });
        } catch (e) {
          console.warn('No se pudo borrar imagen de acta en Cloudinary:', pid, e?.message || e);
        }
      }
    }

    if (store && Array.isArray(store.imagenes)) {
      store.imagenes = [];

      if (!store.acta || store.acta === null) {
        if (!hadActaPdf && store.imagenes.length === 0) {
          delete actasEnMemoria[sesionId];
        }
      }
    }

    let uploadMeta = null;

    try {
      const finalBuffer = fs.readFileSync(pdfFinalPath);

      uploadMeta = await guardarInforme({
        title: `Informe técnico ${sesionId}`,
        generatedBy: req.auth.userId,
        sesionId,
        buffer: finalBuffer,
        includesActa: hadActaPdf || hadActaImgs,
        numeroIncidencia,
        regional: regionalBd,
        tiendaId: tiendaSeleccionada?._id || tiendaId || null,
        tienda: tiendaSeleccionada,
        geolocalizacion
      });
    } catch (err) {
      console.error(`Error guardando informe ${sesionId}:`, err);
    }

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

        return res.status(500).json({
          ok: false,
          error: 'No se obtuvo URL del informe en Cloudinary'
        });
      }

      setImmediate(() => cleanupEvidencesAsync(imagenes));

      return res.status(201).json({
        ok: true,
        id: uploadMeta?._id?.toString() || null,
        url: cloudUrl,
        publicId: uploadMeta?.publicId || null,
        includesActa: hadActaPdf || hadActaImgs,
        sesionId,
        tiendaId: tiendaSeleccionada?._id?.toString() || tiendaId || null,
        tienda: tiendaSeleccionada
          ? {
              _id: tiendaSeleccionada._id?.toString(),
              nombre: tiendaSeleccionada.nombre,
              regional: tiendaSeleccionada.regional,
              departamento: tiendaSeleccionada.departamento,
              ciudad: tiendaSeleccionada.ciudad
            }
          : null,
        ubicacion,
        numeroIncidencia: numeroIncidencia || '',
        generatedBy: req.auth.userId,
        geolocalizacion
      });
    }

    return res.download(pdfFinalPath, `informe_tecnico_${sesionId}.pdf`, () => {
      cleanupTemps();
      setImmediate(() => cleanupEvidencesAsync(imagenes));
    });
  } catch (err) {
    console.error('Error al generar PDF:', err);
    cleanupTemps();

    if (wantsJson) {
      return res.status(500).json({
        ok: false,
        error: 'Error al generar el PDF'
      });
    }

    return res.status(500).send('Error al generar el PDF');
  }
});

module.exports = router;
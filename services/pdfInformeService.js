const axios = require('axios');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const PDFMerger = require('pdf-merger-js');
const crypto = require('crypto');
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

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function limpiarTexto(valor) {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
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

function toPlain(value) {
  if (!value) return {};
  return typeof value.toObject === 'function' ? value.toObject({ depopulate: true }) : value;
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

function esPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.slice(0, 4).toString('utf8') === '%PDF';
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

function tieneGeolocalizacion(geolocalizacion) {
  return (
    geolocalizacion &&
    geolocalizacion.latitud !== null &&
    geolocalizacion.longitud !== null &&
    geolocalizacion.latitud !== undefined &&
    geolocalizacion.longitud !== undefined
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
  const gapX = 34;
  const boxW = Math.floor((availableWidth - gapX) / 2);
  const boxH = isFirstPage ? 205 : 225;

  const labelGap = 8;
  const labelH = 18;
  const obsGap = 6;
  const obsReserve = 32;
  const lineGap = 16;
  const bottomGap = 18;

  const pairStepY = boxH + labelGap + labelH + obsGap + obsReserve + lineGap + bottomGap;

  const pageTop = isFirstPage ? contentTop + 18 : marginTop;
  const pageBottom = doc.page.height - marginBottom;
  const availableHeight = Math.max(0, pageBottom - pageTop);
  const contentHeight = pairsOnPage * pairStepY;

  const startY = pageTop + Math.max(0, Math.floor((availableHeight - contentHeight) / 2));

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

function construirUbicacion(data, override) {
  if (override.ubicacion) {
    return limpiarTexto(override.ubicacion);
  }

  const tiendaNombre = limpiarTexto(override.tiendaNombre || data.tiendaNombre);
  const departamento = limpiarTexto(override.tiendaDepartamento || data.tiendaDepartamento);
  const ciudad = limpiarTexto(override.tiendaCiudad || data.tiendaCiudad);

  if (tiendaNombre && departamento && ciudad) {
    return `${tiendaNombre} - ${departamento}, ${ciudad}`;
  }

  if (tiendaNombre) {
    return tiendaNombre;
  }

  return 'Sitio no especificado';
}

function obtenerFuentes(informe, override = {}) {
  const data = toPlain(informe);

  return {
    title: limpiarTexto(override.title || data.title || 'Informe técnico'),
    numeroIncidencia: limpiarTexto(
      override.numeroIncidencia !== undefined
        ? override.numeroIncidencia
        : data.numeroIncidencia
    ),
    regional: limpiarTexto(
      override.regional !== undefined
        ? override.regional
        : data.regional
    ),
    ubicacion: construirUbicacion(data, override),
    geolocalizacion: override.geolocalizacion || data.geolocalizacion || null,
    evidenciasPrevias: Array.isArray(override.evidenciasPrevias)
      ? override.evidenciasPrevias
      : Array.isArray(data.evidenciasPrevias)
        ? data.evidenciasPrevias
        : [],
    evidenciasPosteriores: Array.isArray(override.evidenciasPosteriores)
      ? override.evidenciasPosteriores
      : Array.isArray(data.evidenciasPosteriores)
        ? data.evidenciasPosteriores
        : [],
    acta: override.acta !== undefined
      ? override.acta
      : data.acta || null,
    actaImagenes: Array.isArray(override.actaImagenes)
      ? override.actaImagenes
      : Array.isArray(data.actaImagenes)
        ? data.actaImagenes
        : []
  };
}

function crearParesEvidencia(previas, posteriores) {
  const pares = [];
  const minLength = Math.min(previas.length, posteriores.length);

  for (let i = 0; i < minLength; i++) {
    pares.push({
      previa: previas[i],
      posterior: posteriores[i]
    });
  }

  return pares;
}

async function escribirPdfEvidencias({
  pdfImagenesPath,
  fuentes
}) {
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
      doc.fontSize(14).text(fuentes.ubicacion, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Generado: ${fechaActual}`, { align: 'center' });

      if (fuentes.numeroIncidencia) {
        doc.moveDown(0.3);
        doc.fontSize(12).fillColor('black').text(`Incidencia: ${fuentes.numeroIncidencia}`, { align: 'center' });
      }

      if (fuentes.regional) {
        doc.moveDown(0.3);
        doc.fontSize(12).fillColor('black').text(`Regional: ${fuentes.regional}`, { align: 'center' });
      }

      renderGeolocalizacion(doc, fuentes.geolocalizacion);

      doc.moveDown(1.5);
      doc.fontSize(10).fillColor('gray').text(
        'Este informe contiene evidencia fotográfica del antes y después de la instalación.',
        { align: 'center', lineGap: 2 }
      );

      const firstPageTopY = doc.y;
      const pares = crearParesEvidencia(fuentes.evidenciasPrevias, fuentes.evidenciasPosteriores);

      await renderEvidencePairs(doc, pares, firstPageTopY);

      doc.end();

      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function agregarActaPdf({
  merger,
  tempDir,
  token,
  acta
}) {
  if (!acta || !acta.url) {
    return false;
  }

  const actaPath = path.join(tempDir, `regenerar-acta-${token}.pdf`);

  try {
    const actaBuf = await safeGetBuffer(acta.url);

    if (!esPdfBuffer(actaBuf)) {
      return false;
    }

    fs.writeFileSync(actaPath, actaBuf);
    await merger.add(actaPath);

    return true;
  } finally {
    if (fs.existsSync(actaPath)) {
      fs.unlinkSync(actaPath);
    }
  }
}

async function crearPdfActaImagenes({
  tempDir,
  token,
  actaImagenes
}) {
  if (!Array.isArray(actaImagenes) || actaImagenes.length === 0) {
    return null;
  }

  const actaImgsPath = path.join(tempDir, `regenerar-acta-imgs-${token}.pdf`);
  let paginasAgregadas = 0;

  await new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ autoFirstPage: false, margin: 40 });
      const stream = fs.createWriteStream(actaImgsPath);

      doc.pipe(stream);

      for (const it of actaImagenes) {
        const imgUrl = isCloudinaryUrl(it?.url) ? buildTransformedUrl(it.url) : it?.url;
        const imgBuf = await safeGetBuffer(imgUrl);

        if (!imgBuf) continue;

        doc.addPage();

        const boxX = doc.page.margins.left;
        const boxY = doc.page.margins.top;
        const boxW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const boxH = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

        centerImageInBox(doc, imgBuf, boxX, boxY, boxW, boxH);
        paginasAgregadas += 1;
      }

      doc.end();

      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });

  if (paginasAgregadas === 0) {
    if (fs.existsSync(actaImgsPath)) {
      fs.unlinkSync(actaImgsPath);
    }

    return null;
  }

  return actaImgsPath;
}

async function generarPdfInformeBufferDesdeFuentes({
  informe,
  override = {}
}) {
  const data = toPlain(informe);

  if (!data || !data._id) {
    const err = new Error('El informe es obligatorio para regenerar el PDF.');
    err.status = 400;
    throw err;
  }

  const fuentes = obtenerFuentes(data, override);
  const token = `${data._id.toString()}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const tempDir = path.join(__dirname, '../uploads/temp');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const pdfImagenesPath = path.join(tempDir, `regenerar-imagenes-${token}.pdf`);
  const pdfFinalPath = path.join(tempDir, `regenerar-final-${token}.pdf`);
  let actaImgsPath = null;

  try {
    await escribirPdfEvidencias({
      pdfImagenesPath,
      fuentes
    });

    const merger = new PDFMerger();

    await merger.add(pdfImagenesPath);

    const hadActaPdf = await agregarActaPdf({
      merger,
      tempDir,
      token,
      acta: fuentes.acta
    });

    actaImgsPath = await crearPdfActaImagenes({
      tempDir,
      token,
      actaImagenes: fuentes.actaImagenes
    });

    let hadActaImgs = false;

    if (actaImgsPath && fs.existsSync(actaImgsPath)) {
      await merger.add(actaImgsPath);
      hadActaImgs = true;
    }

    await merger.save(pdfFinalPath);

    const buffer = fs.readFileSync(pdfFinalPath);

    return {
      buffer,
      includesActa: hadActaPdf || hadActaImgs,
      fuentes
    };
  } finally {
    const archivos = [pdfImagenesPath, pdfFinalPath, actaImgsPath];

    for (const archivo of archivos) {
      if (archivo && fs.existsSync(archivo)) {
        fs.unlinkSync(archivo);
      }
    }
  }
}

function subirBufferPdfCloudinary({
  buffer,
  title,
  informeId,
  versionActual,
  overwrite = false
}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('El buffer del PDF es obligatorio.');
  }

  if (!esPdfBuffer(buffer)) {
    throw new Error('El archivo generado no parece ser un PDF válido.');
  }

  const hash8 = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 8);
  const baseId = slugify(`${title || 'informe_tecnico'}_${informeId || 'sin_id'}_v${versionActual || 1}`);
  const publicId = `${baseId}_${hash8}.pdf`;

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'informes',
        public_id: publicId,
        overwrite,
        format: 'pdf'
      },
      (error, result) => {
        if (error) return reject(error);

        return resolve({
          url: result.secure_url,
          publicId: result.public_id,
          mimeType: 'application/pdf'
        });
      }
    );

    uploadStream.end(buffer);
  });
}

async function regenerarYSubirPdfInforme({
  informe,
  override = {},
  versionActual = null
}) {
  const data = toPlain(informe);
  const resultado = await generarPdfInformeBufferDesdeFuentes({
    informe,
    override
  });

  const subida = await subirBufferPdfCloudinary({
    buffer: resultado.buffer,
    title: override.title || data.title || 'Informe técnico',
    informeId: data._id,
    versionActual: versionActual || data.versionActual || 1
  });

  return {
    ...subida,
    includesActa: resultado.includesActa,
    fuentes: resultado.fuentes
  };
}

module.exports = {
  generarPdfInformeBufferDesdeFuentes,
  subirBufferPdfCloudinary,
  regenerarYSubirPdfInforme
};
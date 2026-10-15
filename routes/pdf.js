const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const previewRouter = express.Router();
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const PDFMerger = require('pdf-merger-js');

const Imagen = require('../models/imagen');
const Informe = require('../models/informe');
const { actasEnMemoria } = require('./acta');
const Tienda = require('../models/tienda');
const { guardarInforme } = require('../services/informeService');
const cloudinary = require('../utils/cloudinary');

const LOGO_CUBICA_URL = 'https://res.cloudinary.com/drygjoxaq/image/upload/v1773871245/LOGO_CUBICA_NUEVO_v3rsq5.jpg';
const LOGO_D1_URL = 'https://res.cloudinary.com/drygjoxaq/image/upload/v1773875275/D1_LOGO_NUEVO_kj1bdh.jpg';

function construirNombreArchivoDescarga(numeroIncidencia, tiendaNombre) {
  const incidencia =
    typeof numeroIncidencia === 'string'
      ? numeroIncidencia.replace(/\s+/g, ' ').trim()
      : '';

  const tienda =
    typeof tiendaNombre === 'string'
      ? tiendaNombre.replace(/\s+/g, ' ').trim()
      : '';

  return `INFORME TÉCNICO-${incidencia || 'SIN INCIDENCIA'}-${tienda || 'SIN TIENDA'}`
    .toLocaleUpperCase('es-CO')
    .replace(/[\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
}

function obtenerSecretoVistaPrevia() {
  return process.env.PDF_PREVIEW_SECRET || process.env.JWT_SECRET || process.env.TOKEN_SECRET || '';
}

function crearTokenVistaPrevia(informeId, nombreArchivo) {
  const secret = obtenerSecretoVistaPrevia();

  if (!secret) {
    throw new Error('Falta configurar la clave para firmar la vista previa del PDF');
  }

  const payload = Buffer.from(JSON.stringify({
    id: String(informeId),
    filename: nombreArchivo,
    exp: Date.now() + 24 * 60 * 60 * 1000
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function verificarTokenVistaPrevia(token) {
  const partes = typeof token === 'string' ? token.split('.') : [];

  if (partes.length !== 2) return null;

  const [payloadCodificado, firmaRecibida] = partes;
  const secret = obtenerSecretoVistaPrevia();

  if (!secret) return null;

  const firmaEsperada = crypto
    .createHmac('sha256', secret)
    .update(payloadCodificado)
    .digest('base64url');

  const recibida = Buffer.from(firmaRecibida);
  const esperada = Buffer.from(firmaEsperada);

  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadCodificado, 'base64url').toString('utf8'));

    if (
      typeof payload.id !== 'string' ||
      typeof payload.filename !== 'string' ||
      !payload.filename.toLowerCase().endsWith('.pdf') ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Date.now()
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function normalizarUrlPdfCloudinary(url) {
  if (typeof url !== 'string') return '';

  return url.replace(/\/raw\/upload\/fl_attachment:[^/]+\//i, '/raw/upload/');
}

function construirUrlVistaPrevia(req, token) {
  const protocolo = String(req.get('x-forwarded-proto') || req.protocol)
    .split(',')[0]
    .trim();
  const host = req.get('host');

  return `${protocolo}://${host}/pdf-preview/${token}`;
}

previewRouter.get('/:token', async (req, res) => {
  const payload = verificarTokenVistaPrevia(req.params.token);

  if (!payload) {
    return res.status(404).send('El enlace de vista previa no es válido o ha vencido.');
  }

  try {
    const informe = await Informe.findById(payload.id).lean();

    if (!informe) {
      return res.status(404).send('No se encontró el informe solicitado.');
    }

    let urlPdf = '';
    const publicId = informe.publicId || informe.public_id || '';

    if (publicId) {
      try {
        const recurso = await cloudinary.api.resource(publicId, {
          resource_type: 'raw'
        });
        urlPdf = normalizarUrlPdfCloudinary(
          recurso?.secure_url || recurso?.url || ''
        );
      } catch (cloudinaryError) {
        console.warn(
          'No se pudo localizar el PDF por publicId en Cloudinary:',
          cloudinaryError?.message || cloudinaryError
        );
      }
    }

    if (!urlPdf) {
      urlPdf = normalizarUrlPdfCloudinary(informe.url);
    }

    if (!urlPdf) {
      return res.status(404).send('El informe no tiene un PDF disponible en Cloudinary.');
    }

    const respuesta = await axios.get(urlPdf, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 100 * 1024 * 1024
    });

    const nombreAscii = payload.filename
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '_');

    const nombreCodificado = encodeURIComponent(payload.filename)
      .replace(/[!'()*]/g, caracter => `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreAscii}"; filename*=UTF-8''${nombreCodificado}`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return res.status(200).send(Buffer.from(respuesta.data));
  } catch (error) {
    console.error('Error cargando la vista previa del informe:', error?.message || error);
    return res.status(502).send('No fue posible cargar el PDF.');
  }
});

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

  doc.image(imgBuffer, drawX, drawY, {
    width: drawW,
    height: drawH
  });

  return {
    drawX,
    drawY,
    drawW,
    drawH
  };
}

function getPublicIdFromUrl(url) {
  const match = (url || '').match(
    /\/v\d+\/(.+)\.(jpg|png|jpeg|webp|gif|heic|heif|bmp|tif|tiff)/i
  );

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
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
  } catch (e) {
    console.warn(
      'No se pudo limpiar temporales por sesión:',
      sesionId,
      e?.message || e
    );
  }
}

async function destroyCloudinary(publicId, resourceType) {
  try {
    if (!publicId) {
      return {
        ok: false,
        error: 'publicId vacío'
      };
    }

    const res = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });

    return {
      ok: true,
      res
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e)
    };
  }
}

function normalizarNumero(valor) {
  const num = Number(valor);

  return Number.isFinite(num) ? num : null;
}

function normalizarFecha(valor) {
  if (!valor) return null;

  const fecha = new Date(valor);

  return Number.isNaN(fecha.getTime())
    ? null
    : fecha;
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
    typeof query.mapsUrl === 'string' &&
    query.mapsUrl.trim()
      ? query.mapsUrl.trim()
      : `https://www.google.com/maps?q=${latitud},${longitud}`;

  return {
    latitud,
    longitud,
    precision: normalizarNumero(query.precision),
    altitud: normalizarNumero(query.altitud),
    precisionAltitud: normalizarNumero(
      query.precisionAltitud
    ),
    fechaCaptura:
      normalizarFecha(query.fechaCaptura) ||
      new Date(),
    mapsUrl,
    origen: ['browser', 'manual'].includes(
      query.geoOrigen
    )
      ? query.geoOrigen
      : 'browser'
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
    return new Date(fecha).toLocaleString(
      'es-CO',
      {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Bogota'
      }
    );
  } catch {
    return '';
  }
}

function renderGeolocalizacion(doc, geolocalizacion) {
  if (!tieneGeolocalizacion(geolocalizacion)) {
    return;
  }

  const latitud = formatearCoordenada(
    geolocalizacion.latitud
  );

  const longitud = formatearCoordenada(
    geolocalizacion.longitud
  );

  const precision = normalizarNumero(
    geolocalizacion.precision
  );

  const fecha = formatearFechaGeo(
    geolocalizacion.fechaCaptura
  );

  const precisionTexto =
    precision !== null
      ? ` | Precisión: ${Math.round(precision)} m`
      : '';

  const fechaTexto =
    fecha
      ? ` | Capturada: ${fecha}`
      : '';

  doc.moveDown(0.3);

  doc
    .fontSize(9)
    .fillColor('gray')
    .text(
      `GPS: ${latitud}, ${longitud}${precisionTexto}${fechaTexto}`,
      {
        align: 'center'
      }
    );

  if (geolocalizacion.mapsUrl) {
    doc.moveDown(0.1);

    doc
      .fontSize(9)
      .fillColor('#003366')
      .text(
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

function computeImagePageLayout(
  doc,
  pairsOnPage,
  contentTop,
  isFirstPage
) {
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const marginTop = doc.page.margins.top;
  const marginBottom = doc.page.margins.bottom;

  const availableWidth =
    doc.page.width -
    marginLeft -
    marginRight;

  const gapX = 34;

  const boxW = Math.floor(
    (availableWidth - gapX) / 2
  );

  const boxH =
    isFirstPage
      ? 205
      : 225;

  const labelGap = 8;
  const labelH = 18;
  const obsGap = 6;
    const obsReserve = 32;
  const lineGap = 16;
  const bottomGap = 18;

  const pairStepY =
    boxH +
    labelGap +
    labelH +
    obsGap +
    obsReserve +
    lineGap +
    bottomGap;

  const pageTop =
    isFirstPage
      ? contentTop + 18
      : marginTop;

  const pageBottom =
    doc.page.height -
    marginBottom;

  const availableHeight =
    Math.max(
      0,
      pageBottom - pageTop
    );

  const contentHeight =
    pairsOnPage *
    pairStepY;

  const startY =
    pageTop +
    Math.max(
      0,
      Math.floor(
        (availableHeight - contentHeight) / 2
      )
    );

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

async function renderEvidencePairs(
  doc,
  pares,
  firstPageTopY
) {
  if (
    !Array.isArray(pares) ||
    pares.length === 0
  ) {
    return;
  }

  let index = 0;
  let isFirstPage = true;

  while (index < pares.length) {
    const pairsPerPage =
      isFirstPage
        ? 1
        : 2;

    const pagePairs =
      pares.slice(
        index,
        index + pairsPerPage
              );

    if (!isFirstPage) {
      doc.addPage();
    }

    const layout =
      computeImagePageLayout(
        doc,
        pagePairs.length,
        firstPageTopY,
        isFirstPage
      );

    for (
      let i = 0;
      i < pagePairs.length;
      i++
    ) {
      const {
        previa,
        posterior
      } = pagePairs[i];

      const y =
        layout.startY +
        i * layout.pairStepY;

      const previaUrl =
        isCloudinaryUrl(previa?.url)
          ? buildTransformedUrl(previa.url)
          : previa?.url;

      const posteriorUrl =
        isCloudinaryUrl(posterior?.url)
          ? buildTransformedUrl(posterior.url)
          : posterior?.url;

      const previaBuf =
        await safeGetBuffer(previaUrl);

      const posteriorBuf =
        await safeGetBuffer(posteriorUrl);

      if (
        !previaBuf ||
        !posteriorBuf
      ) {
        continue;
      }

      const leftX =
        layout.startX;

      const rightX =
        layout.startX +
        layout.boxW +
        layout.gapX;

      centerImageInBox(
        doc,
        previaBuf,
        leftX,
        y,
        layout.boxW,
        layout.boxH
      );

      centerImageInBox(
        doc,
        posteriorBuf,
        rightX,
        y,
        layout.boxW,
        layout.boxH
      );

      const labelsY =
        y +
        layout.boxH +
        layout.labelGap;

      doc
        .fontSize(12)
        .fillColor('#003366')
        .text(
          'Antes de la instalación',
          leftX,
          labelsY,
          {
            width: layout.boxW,
            align: 'center'
          }
        )
        .text(
          'Después de la instalación',
          rightX,
          labelsY,
          {
            width: layout.boxW,
            align: 'center'
          }
        );

      const obsY =
        labelsY + 20;

      let maxObsHeight = 0;

      doc
        .fontSize(9)
        .fillColor('gray');

      if (previa.observacion) {
        const h =
          doc.heightOfString(
            previa.observacion,
            {
              width: layout.boxW
            }
          );

        doc.text(
          previa.observacion,
          leftX,
          obsY,
          {
            width: layout.boxW,
            align: 'center'
          }
        );

        maxObsHeight =
          Math.max(
            maxObsHeight,
            h
          );
      }

      if (posterior.observacion) {
        const h =
          doc.heightOfString(
            posterior.observacion,
            {
              width: layout.boxW
            }
          );

        doc.text(
          posterior.observacion,
          rightX,
          obsY,
          {
            width: layout.boxW,
            align: 'center'
          }
        );

        maxObsHeight =
          Math.max(
            maxObsHeight,
            h
          );
      }

      const lineY =
        obsY +
        maxObsHeight +
        14;

      doc
        .moveTo(
          layout.startX,
          lineY
        )
        .lineTo(
          layout.startX +
          layout.boxW * 2 +
          layout.gapX,
          lineY
        )
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .stroke();
    }

    index += pagePairs.length;
    isFirstPage = false;
  }
}

router.post(
  '/session/reset/:sesionId',
  async (req, res) => {
    const { sesionId } = req.params;

    try {
      if (
        !sesionId ||
        typeof sesionId !== 'string'
              ) {
        return res.status(400).json({
          ok: false,
          error: 'sesionId inválido'
        });
      }

      validarSesionPermitida(
        req,
        sesionId
      );

      const deleted = {
        imagenesN: 0,
        actaPdf: false,
        actaImgsN: 0
      };

      const imagenes =
        await Imagen
          .find({ sesionId })
          .lean();

      for (const img of imagenes) {
        const pid =
          getPublicIdFromUrl(
            img?.url
          );

        if (pid) {
          const r =
            await destroyCloudinary(
              pid,
              'image'
            );

          if (!r.ok) {
            console.warn(
              'No se pudo borrar evidencia en Cloudinary:',
              pid,
              r.error
            );
          }
        }
      }

      if (imagenes.length > 0) {
        await Imagen.deleteMany({
          sesionId
        });

        deleted.imagenesN =
          imagenes.length;
      }

      const store =
        actasEnMemoria[sesionId];

      if (
        store &&
        typeof store === 'object'
      ) {
        if (
          store.acta &&
          store.acta.public_id
        ) {
          const r =
            await destroyCloudinary(
              store.acta.public_id,
              'raw'
            );

          if (!r.ok) {
            console.warn(
              'No se pudo borrar acta en Cloudinary:',
              store.acta.public_id,
              r.error
            );
          }

          deleted.actaPdf = true;
        }

        if (
          Array.isArray(store.imagenes) &&
          store.imagenes.length > 0
        ) {
          for (
            const it of store.imagenes
          ) {
            if (it?.public_id) {
              const r =
                await destroyCloudinary(
                  it.public_id,
                  'image'
                );

              if (!r.ok) {
                console.warn(
                  'No se pudo borrar imagen de acta en Cloudinary:',
                  it.public_id,
                  r.error
                );
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
      console.error(
        'Error en reset de sesión:',
        sesionId,
        e?.message || e
      );

      return res.status(
        e.status || 500
      ).json({
        ok: false,
        error:
          e.status
            ? e.message
            : 'Error interno al resetear sesión'
      });
    }
  }
);

router.get('/preview-link/:informeId', async (req, res) => {
  const informeId = String(req.params.informeId || '');

  if (!/^[a-f\d]{24}$/i.test(informeId)) {
    return res.status(400).json({
      ok: false,
      error: 'Id de informe inválido'
    });
  }

  try {
    const informe = await Informe.findById(informeId)
      .populate('generatedBy', 'usuario nombre')
      .populate('tiendaId', 'nombre regional departamento ciudad')
      .lean();

    if (!informe) {
      return res.status(404).json({
        ok: false,
        error: 'No se encontró el informe solicitado'
      });
    }

    const propietarioId = String(
      informe.generatedBy?._id || informe.generatedBy || ''
    );
    const usuarioId = String(req.auth?.userId || '');

    if (!req.auth?.isAdmin && (!usuarioId || propietarioId !== usuarioId)) {
      return res.status(403).json({
        ok: false,
        error: 'No estás autorizado para visualizar este informe'
      });
    }

    const publicId = informe.publicId || informe.public_id || '';
    let urlPdf = '';

    if (publicId) {
      try {
        const recurso = await cloudinary.api.resource(publicId, {
          resource_type: 'raw'
        });
        urlPdf = normalizarUrlPdfCloudinary(
          recurso?.secure_url || recurso?.url || ''
        );
      } catch (cloudinaryError) {
        console.warn(
          'No se pudo localizar el PDF por publicId en Cloudinary:',
          cloudinaryError?.message || cloudinaryError
        );
      }
    }

    if (!urlPdf) {
      urlPdf = normalizarUrlPdfCloudinary(informe.url);
    }

    if (!urlPdf) {
      return res.status(404).json({
        ok: false,
                error: 'El informe no tiene una URL ni un recurso PDF disponible en Cloudinary'
      });
    }

    const tiendaNombre =
      informe.tiendaNombre ||
      informe.tiendaId?.nombre ||
      '';

    const nombreArchivo = construirNombreArchivoDescarga(
      String(informe.numeroIncidencia || ''),
      String(tiendaNombre)
    );

    const tokenVistaPrevia = crearTokenVistaPrevia(
      informe._id.toString(),
      `${nombreArchivo}.pdf`
    );

    res.set('Cache-Control', 'no-store');

    return res.json({
      ok: true,
      previewUrl: construirUrlVistaPrevia(req, tokenVistaPrevia),
      filename: `${nombreArchivo}.pdf`
    });
  } catch (error) {
    console.error(
      'Error creando enlace de vista previa:',
      error?.message || error
    );

    return res.status(500).json({
      ok: false,
      error: 'No se pudo crear el enlace de vista previa'
    });
  }
});

router.get(
  '/generar/:sesionId',
  async (req, res) => {
    const { sesionId } = req.params;

    const tiendaId =
      (
        req.query.tiendaId ||
        ''
      )
        .toString()
        .trim();

    const wantsJson =
      req.query.format === 'json' ||
      (
        req.get('accept') ||
        ''
      ).includes(
        'application/json'
      );

    const numeroIncidencia =
      (
        req.query.numeroIncidencia ||
        ''
      )
        .toString()
        .trim();

    const geolocalizacion =
      normalizarGeolocalizacionDesdeQuery(
        req.query
      );

    let ubicacion =
      req.query.ubicacion ||
      'Sitio no especificado';

    let regionalStr = '';
    let regionalBd = 'OTRA';
    let tiendaSeleccionada = null;

    try {
      validarSesionPermitida(
        req,
        sesionId
      );
    } catch (err) {
      if (wantsJson) {
        return res.status(
          err.status || 500
        ).json({
          ok: false,
          error: err.message
        });
      }

      return res.status(
        err.status || 500
      ).send(
        err.message
      );
    }

    if (tiendaId) {
      try {
        const tienda =
          await Tienda
            .findById(tiendaId)
            .lean();

        if (tienda) {
          tiendaSeleccionada =
            tienda;

          ubicacion =
            `${tienda.nombre} - ` +
            `${tienda.departamento}, ` +
            `${tienda.ciudad}`;

          regionalStr =
            `Regional: ${tienda.regional}`;

          regionalBd =
            tienda.regional;
        }
      } catch (e) {
        console.warn(
          'No se pudo obtener la tienda para el PDF:',
          e?.message || e
        );
      }
    }

    const tempDir =
      path.join(
        __dirname,
        '../uploads/temp'
      );

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(
        tempDir,
        {
          recursive: true
        }
      );
    }

    const pdfImagenesPath =
      path.join(
        tempDir,
        `pdf-imagenes-${sesionId}.pdf`
      );

    const pdfFinalPath =
      path.join(
        tempDir,
        `pdf-final-${sesionId}.pdf`
      );

    const cleanupTemps = () => {
      try {
        if (
          fs.existsSync(
            pdfImagenesPath
          )
        ) {
          fs.unlinkSync(
            pdfImagenesPath
          );
        }

        if (
          fs.existsSync(
            pdfFinalPath
          )
        ) {
          fs.unlinkSync(
            pdfFinalPath
          );
        }

        const maybeActaImgsPath =
          path.join(
            tempDir,
            `acta-imgs-${sesionId}.pdf`
          );

        if (
          fs.existsSync(
            maybeActaImgsPath
          )
        ) {
          fs.unlinkSync(
            maybeActaImgsPath
          );
        }
      } catch (e) {
        console.warn(
                    'No se pudo limpiar temporales:',
          e?.message || e
        );
      }
    };

    const destroyCloudinaryWithRetry = async (
      publicId,
      resourceType,
      maxAttempts = 3
    ) => {
      if (!publicId) {
        return {
          ok: false,
          reason: 'publicId vacío'
        };
      }

      let lastError = null;

      for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
      ) {
        try {
          const result =
            await cloudinary.uploader.destroy(
              publicId,
              {
                resource_type:
                  resourceType,
                invalidate: true
              }
            );

          if (
            result?.result === 'ok' ||
            result?.result === 'not found'
          ) {
            return {
              ok: true,
              result:
                result?.result ||
                'ok'
            };
          }

          lastError =
            new Error(
              `Cloudinary respondió: ${
                result?.result ||
                'resultado desconocido'
              }`
            );
        } catch (err) {
          lastError = err;
        }

        if (
          attempt < maxAttempts
        ) {
          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                attempt * 500
              )
          );
        }
      }

      return {
        ok: false,
        error:
          lastError?.message ||
          'No se pudo eliminar el archivo'
      };
    };

    const cleanupSessionAssetsAsync = async ({
      imagenes = [],
      actaPublicId = null,
      actaImgsPublicIds = []
    }) => {
      const imageResults = [];

      try {
        for (const img of imagenes) {
          const publicId =
            img?.public_id ||
            img?.publicId ||
            getPublicIdFromUrl(
              img?.url
            );

          if (!publicId) {
            console.warn(
              'No se encontró public_id para eliminar evidencia:',
              img?._id?.toString() ||
              img?.url ||
              'imagen desconocida'
            );

            imageResults.push({
              imageId:
                img?._id?.toString() ||
                null,
              publicId: null,
              ok: false
            });

            continue;
          }

          const result =
            await destroyCloudinaryWithRetry(
              publicId,
              'image'
            );

          if (!result.ok) {
            console.warn(
              `No se pudo eliminar ${publicId} de Cloudinary:`,
              result.error ||
              result.reason
            );
          }

          imageResults.push({
            imageId:
              img?._id?.toString() ||
              null,
            publicId,
            ok: result.ok
          });
        }

        let actaDeleted = true;

        if (actaPublicId) {
          const result =
            await destroyCloudinaryWithRetry(
              actaPublicId,
              'raw'
            );

          actaDeleted =
            result.ok;

          if (!result.ok) {
            console.warn(
              `No se pudo eliminar el acta ${actaPublicId} de Cloudinary:`,
              result.error ||
              result.reason
            );
          }
        }

        const actaImageResults = [];

        for (
          const publicId of
          actaImgsPublicIds
        ) {
          if (!publicId) {
            actaImageResults.push({
              publicId: null,
              ok: false
            });

            continue;
          }

          const result =
            await destroyCloudinaryWithRetry(
              publicId,
              'image'
            );

          if (!result.ok) {
            console.warn(
              `No se pudo eliminar imagen de acta ${publicId} de Cloudinary:`,
              result.error ||
              result.reason
            );
          }

          actaImageResults.push({
            publicId,
            ok: result.ok
          });
        }

        const failedImageIds =
          imageResults
            .filter(
              (item) =>
                !item.ok &&
                item.imageId
                            )
            .map(
              (item) =>
                item.imageId
            );

        if (
          failedImageIds.length > 0
        ) {
          const successfulImageIds =
            imageResults
              .filter(
                (item) =>
                  item.ok &&
                  item.imageId
              )
              .map(
                (item) =>
                  item.imageId
              );

          if (
            successfulImageIds.length > 0
          ) {
            await Imagen.deleteMany({
              _id: {
                $in:
                  successfulImageIds
              },
              sesionId
            });
          }

          console.warn(
            `La sesión ${sesionId} conserva ${failedImageIds.length} registro(s) de evidencia porque no se pudieron eliminar correctamente de Cloudinary.`
          );
        } else {
          await Imagen.deleteMany({
            sesionId
          });
        }

        const allActaImagesDeleted =
          actaImageResults.every(
            (item) =>
              item.ok
          );

        if (
          actaDeleted &&
          allActaImagesDeleted
        ) {
          delete actasEnMemoria[
            sesionId
          ];
        } else {
          console.warn(
            `Se conserva temporalmente la información del acta de la sesión ${sesionId} porque algunos archivos no pudieron eliminarse de Cloudinary.`
          );
        }

        const failedImages =
          imageResults.filter(
            (item) =>
              !item.ok
          ).length;

        const failedActaImages =
          actaImageResults.filter(
            (item) =>
              !item.ok
          ).length;

        console.log(
          `Limpieza de sesión ${sesionId} finalizada. ` +
          `Evidencias eliminadas: ` +
          `${imageResults.length - failedImages}/${imageResults.length}. ` +
          `Imágenes de acta eliminadas: ` +
          `${actaImageResults.length - failedActaImages}/${actaImageResults.length}. ` +
          `Acta PDF eliminada: ` +
          `${actaPublicId ? actaDeleted : true}.`
        );

        return {
          ok:
            failedImages === 0 &&
            failedActaImages === 0 &&
            actaDeleted,
          failedImages,
          failedActaImages,
          actaDeleted
        };
      } catch (e) {
        console.warn(
          'No se pudieron limpiar los archivos de la sesión:',
          e?.message || e
        );

        return {
          ok: false,
          error:
            e?.message ||
            String(e)
        };
      }
    };

    try {
      const imagenes =
        await Imagen
          .find({ sesionId })
          .sort({
            fechaSubida: 1
          });

      if (
        imagenes.length === 0
      ) {
        if (wantsJson) {
          return res.status(404).json({
            ok: false,
            error:
              'No hay imágenes para esta sesión'
          });
        }

        return res.status(404).send(
          'No hay imágenes para esta sesión'
        );
      }

      await new Promise(
        async (
          resolve,
          reject
        ) => {
          try {
            const doc =
              new PDFDocument({
                margin: 50
              });

            const stream =
              fs.createWriteStream(
                pdfImagenesPath
              );

            doc.pipe(stream);

            const fechaActual =
              new Date().toLocaleString(
                'es-CO',
                {
                  dateStyle: 'full',
                  timeStyle: 'short',
                  timeZone:
                    'America/Bogota'
                }
              );

            const logoCubicaBuf =
              await safeGetBuffer(
                buildLogoUrl(
                  LOGO_CUBICA_URL
                )
              );

            if (logoCubicaBuf) {
              doc.image(
                logoCubicaBuf,
                doc.page.width - 150,
                40,
                {
                  width: 120
                }
              );
            }

            const logoD1Buf =
              await safeGetBuffer(
                buildLogoUrl(
                  LOGO_D1_URL
                )
              );

            if (logoD1Buf) {
              doc.image(
                logoD1Buf,
                50,
                40,
                {
                  width: 100
                }
              );
            }

            doc
              .fillColor('black')
              .fontSize(24)
              .text(
                                'Informe técnico',
                50,
                100,
                {
                  align: 'center'
                }
              );

            doc.moveDown();

            doc
              .fontSize(14)
              .text(
                ubicacion,
                {
                  align: 'center'
                }
              );

            doc.moveDown(0.5);

            doc
              .fontSize(12)
              .text(
                `Generado: ${fechaActual}`,
                {
                  align: 'center'
                }
              );

            if (numeroIncidencia) {
              const display =
                numeroIncidencia
                  .toString()
                  .replace(
                    /\s+/g,
                    ' '
                  )
                  .trim();

              doc.moveDown(0.3);

              doc
                .fontSize(12)
                .fillColor('black')
                .text(
                  `Incidencia: ${display}`,
                  {
                    align: 'center'
                  }
                );
            }

            if (regionalStr) {
              doc.moveDown(0.3);

              doc
                .fontSize(12)
                .fillColor('black')
                .text(
                  regionalStr,
                  {
                    align: 'center'
                  }
                );
            }

            renderGeolocalizacion(
              doc,
              geolocalizacion
            );

            doc.moveDown(1.5);

            doc
              .fontSize(10)
              .fillColor('gray')
              .text(
                'Este informe contiene evidencia fotográfica del antes y después de la instalación.',
                {
                  align: 'center',
                  lineGap: 2
                }
              );

            const firstPageTopY =
              doc.y;

            const previas =
              imagenes.filter(
                (img) =>
                  img.tipo === 'previa'
              );

            const posteriores =
              imagenes.filter(
                (img) =>
                  img.tipo === 'posterior'
              );

            const pares = [];

            const minLength =
              Math.min(
                previas.length,
                posteriores.length
              );

            for (
              let i = 0;
              i < minLength;
              i++
            ) {
              pares.push({
                previa:
                  previas[i],
                posterior:
                  posteriores[i]
              });
            }

            await renderEvidencePairs(
              doc,
              pares,
              firstPageTopY
            );

            doc.end();

            stream.on(
              'finish',
              resolve
            );

            stream.on(
              'error',
              reject
            );
          } catch (err) {
            reject(err);
          }
        }
      );

      const merger = new PDFMerger();

      const store = actasEnMemoria[sesionId];
      const actaUrl =
        store?.acta?.url ||
        store?.url ||
        null;

      const actaPublicId =
        store?.acta?.public_id ||
        store?.public_id ||
        null;

      const actaImgsArray =
        Array.isArray(store?.imagenes)
          ? store.imagenes
          : [];

      const actaImgsPublicIds =
        actaImgsArray
          .map(
            (item) =>
              item?.public_id ||
              item?.publicId ||
              null
          )
          .filter(Boolean);

      let hadActaPdf = false;
      let hadActaImgs = false;

      if (actaUrl) {
        const actaPath =
          path.join(
            tempDir,
            `acta-${sesionId}.pdf`
          );

        try {
          const actaBuf =
            await safeGetBuffer(actaUrl);

          if (
            actaBuf &&
            actaBuf
              .slice(0, 4)
              .toString('utf8') === '%PDF'
          ) {
            fs.writeFileSync(
              actaPath,
              actaBuf
            );

            await merger.add(
              actaPath
            );
                        hadActaPdf = true;
          } else {
            console.warn(
              `El acta para ${sesionId} no es un PDF válido o no se pudo descargar`
            );
          }
        } finally {
          if (
            fs.existsSync(
              actaPath
            )
          ) {
            fs.unlinkSync(
              actaPath
            );
          }
        }
      }

      let actaImgsPath = null;

      if (
        actaImgsArray.length > 0
      ) {
        actaImgsPath =
          path.join(
            tempDir,
            `acta-imgs-${sesionId}.pdf`
          );

        await new Promise(
          async (
            resolve,
            reject
          ) => {
            try {
              const doc =
                new PDFDocument({
                  autoFirstPage: false,
                  margin: 40
                });

              const stream =
                fs.createWriteStream(
                  actaImgsPath
                );

              doc.pipe(stream);

              for (
                const it of actaImgsArray
              ) {
                const imgUrl =
                  isCloudinaryUrl(
                    it?.url
                  )
                    ? buildTransformedUrl(
                        it.url
                      )
                    : it?.url;

                const imgBuf =
                  await safeGetBuffer(
                    imgUrl
                  );

                if (!imgBuf) {
                  continue;
                }

                doc.addPage();

                const boxX =
                  doc.page.margins.left;

                const boxY =
                  doc.page.margins.top;

                const boxW =
                  doc.page.width -
                  doc.page.margins.left -
                  doc.page.margins.right;

                const boxH =
                  doc.page.height -
                  doc.page.margins.top -
                  doc.page.margins.bottom;

                centerImageInBox(
                  doc,
                  imgBuf,
                  boxX,
                  boxY,
                  boxW,
                  boxH
                );
              }

              doc.end();

              stream.on(
                'finish',
                resolve
              );

              stream.on(
                'error',
                reject
              );
            } catch (err) {
              reject(err);
            }
          }
        );

        if (
          fs.existsSync(
            actaImgsPath
          )
        ) {
          await merger.add(
            actaImgsPath
          );

          hadActaImgs = true;
        }
      }

      await merger.add(
        pdfImagenesPath
      );

      await merger.save(
        pdfFinalPath
      );

      let uploadMeta = null;

      try {
        const finalBuffer =
          fs.readFileSync(
            pdfFinalPath
          );

        uploadMeta =
          await guardarInforme({
            title:
              `Informe técnico ${sesionId}`,
            generatedBy:
              req.auth.userId,
            sesionId,
            buffer:
              finalBuffer,
            includesActa:
              hadActaPdf ||
              hadActaImgs,
            numeroIncidencia,
            regional:
              regionalBd,
            tiendaId:
              tiendaSeleccionada?._id ||
              tiendaId ||
              null,
            tienda:
              tiendaSeleccionada,
            geolocalizacion
          });
      } catch (err) {
        console.error(
          `Error guardando informe ${sesionId}:`,
          err
        );
      }

      if (wantsJson) {
        cleanupTemps();

        const cloudUrlOriginal =
          uploadMeta?.url ||
          uploadMeta?.secure_url ||
          uploadMeta?.cloudinary?.secure_url ||
          uploadMeta?.informe?.url ||
          null;

        const cloudUrl = normalizarUrlPdfCloudinary(cloudUrlOriginal);

        if (!cloudUrl) {
          return res.status(500).json({
            ok: false,
            error:
              'No se obtuvo URL del informe en Cloudinary'
          });
        }

        const nombreArchivo = construirNombreArchivoDescarga(
          numeroIncidencia,
          tiendaSeleccionada?.nombre
        );
                const informeId = uploadMeta?._id?.toString() || null;

        const tokenVistaPrevia = informeId
          ? crearTokenVistaPrevia(informeId, `${nombreArchivo}.pdf`)
          : null;

        const previewUrl = tokenVistaPrevia
          ? construirUrlVistaPrevia(req, tokenVistaPrevia)
          : null;

        await cleanupSessionAssetsAsync({
          imagenes,
          actaPublicId,
          actaImgsPublicIds
        });

        return res.status(201).json({
          ok: true,
          id: informeId,
          url:
            cloudUrl,
          previewUrl,
          filename: `${nombreArchivo}.pdf`,
          publicId:
            uploadMeta?.publicId ||
            null,
          includesActa:
            hadActaPdf ||
            hadActaImgs,
          sesionId,
          tiendaId:
            tiendaSeleccionada?._id?.toString() ||
            tiendaId ||
            null,
          tienda:
            tiendaSeleccionada
              ? {
                  _id:
                    tiendaSeleccionada._id?.toString(),
                  nombre:
                    tiendaSeleccionada.nombre,
                  regional:
                    tiendaSeleccionada.regional,
                  departamento:
                    tiendaSeleccionada.departamento,
                  ciudad:
                    tiendaSeleccionada.ciudad
                }
              : null,
          ubicacion,
          numeroIncidencia:
            numeroIncidencia ||
            '',
          generatedBy:
            req.auth.userId,
          geolocalizacion
        });
      }

      const nombreArchivo = construirNombreArchivoDescarga(
        numeroIncidencia,
        tiendaSeleccionada?.nombre
      );

      return res.download(
        pdfFinalPath,
        `${nombreArchivo}.pdf`,
        (downloadError) => {
          cleanupTemps();

          if (!downloadError) {
            cleanupSessionAssetsAsync({
              imagenes,
              actaPublicId,
              actaImgsPublicIds
            }).catch(
              (cleanupError) => {
                console.warn(
                  'Error durante la limpieza posterior a la descarga:',
                  cleanupError?.message ||
                  cleanupError
                );
              }
            );
          }
        }
      );
    } catch (err) {
      console.error(
        'Error al generar PDF:',
        err
      );

      cleanupTemps();

      if (wantsJson) {
        return res.status(500).json({
          ok: false,
          error:
            'Error al generar el PDF'
        });
      }

      return res.status(500).send(
        'Error al generar el PDF'
      );
    }
  }
);

router.previewRouter = previewRouter;

module.exports = router;
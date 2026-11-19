const express = require('express');
const router = express.Router();
const previewRouter = express.Router();
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const PDFMerger = require('pdf-merger-js');

const Imagen = require('../models/imagen');
const Informe = require('../models/informe');
const {
  actasEnMemoria,
  cargarActaEnMemoria,
  guardarActaEnDb,
  eliminarActaEnDb
} = require('./acta');
const Tienda = require('../models/tienda');
const { guardarInforme } = require('../services/informeService');
const objectStorage = require('../utils/objectStorage');
const {
  esSesionIdValido,
  esUrlCloudinarySegura,
  limpiarTexto,
  textoBusqueda
} = require('../utils/validaciones');
const {
  construirNombreArchivoDescarga,
  construirUrlVistaPrevia,
  crearTokenVistaPrevia,
  verificarTokenVistaPrevia
} = require('../utils/pdfPreview');

const LOGO_CUBICA_PATH = path.join(__dirname, '../assets/logos/logo-cubica.png');
const LOGO_D1_PATH = path.join(__dirname, '../assets/logos/logo-d1.jpg');

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

    const pdfBuffer = await objectStorage.downloadBuffer(informe, {
      maxBytes: 100 * 1024 * 1024
    });

    if (pdfBuffer.slice(0, 4).toString('utf8') !== '%PDF') {
      return res.status(404).send('El archivo del informe no es un PDF válido.');
    }

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

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error('Error cargando la vista previa del informe:', error?.message || error);
    return res.status(502).send('No fue posible cargar el PDF.');
  }
});

async function safeGetBuffer(file) {
  try {
    return await objectStorage.downloadBuffer(file, {
      maxBytes: 100 * 1024 * 1024
    });
  } catch (err) {
    console.warn('No se pudo descargar un recurso:', err?.message || err);
    return null;
  }
}

function leerLogo(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    console.warn('No se pudo leer un logo local:', error?.message || error);
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

function getPublicIdFromUrl(url, resourceType = 'image') {
  if (!esUrlCloudinarySegura(url)) return null;

  try {
    const segmentos = new URL(url).pathname.split('/').filter(Boolean);
    const indiceUpload = segmentos.indexOf('upload');

    if (indiceUpload === -1 || indiceUpload === segmentos.length - 1) {
      return null;
    }

    let restantes = segmentos.slice(indiceUpload + 1);
    const indiceVersion = restantes.findIndex((s) => /^v\d+$/.test(s));

    if (indiceVersion !== -1) {
      restantes = restantes.slice(indiceVersion + 1);
    } else {
      // Sin versión: descarta segmentos de transformación (contienen comas o
      // prefijos tipo c_/w_/q_) antes del public_id.
      restantes = restantes.filter(
        (s) =>
          !s.includes(',') &&
          !/^(?:c_|w_|h_|q_|f_|fl_|e_|x_|y_|g_|r_|a_|b_|d_|t_|o_|l_|s_|p_|u_)/i.test(s)
      );
    }

    if (restantes.length === 0) return null;

    const ultimo = restantes[restantes.length - 1];
    const extension = path.extname(ultimo);

    if (!extension) return restantes.join('/') || null;

    if (resourceType !== 'raw') {
      restantes[restantes.length - 1] = ultimo.slice(0, -extension.length);
    }

    return restantes.join('/') || null;
  } catch {
    return null;
  }
}

function validarSesionPermitida(req, sesionId) {
  if (!req.auth) {
    const err = new Error('Autenticación requerida');
    err.status = 401;
    throw err;
  }

  if (!esSesionIdValido(sesionId)) {
    const err = new Error('sesionId inválido');
    err.status = 400;
    throw err;
  }

  if (req.auth.isAdmin) return;

  if (sesionId !== req.auth.sesionId) {
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

async function deleteStoredFile(file, resourceType) {
  try {
    if (!file) {
      return {
        ok: false,
        error: 'Referencia de archivo vacía'
      };
    }

    const reference = typeof file === 'string'
      ? { url: file }
      : {
          ...file,
          publicId:
            file.publicId ||
            file.public_id ||
            getPublicIdFromUrl(file.url, resourceType)
        };
    const deleted = await objectStorage.deleteObject(reference, {
      publicId: reference.publicId || reference.public_id,
      resourceType
    });

    return {
      ok: deleted
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

      const previaBuf = await objectStorage.getOptimizedImageBuffer(previa, {
        width: 1200,
        quality: 60
      }).catch((error) => {
        console.warn('No se pudo optimizar la evidencia previa:', error?.message || error);
        return null;
      });

      const posteriorBuf = await objectStorage.getOptimizedImageBuffer(posterior, {
        width: 1200,
        quality: 60
      }).catch((error) => {
        console.warn('No se pudo optimizar la evidencia posterior:', error?.message || error);
        return null;
      });

      if (
        !previaBuf ||
        !posteriorBuf
      ) {
        throw new Error('No se pudo cargar una pareja completa de evidencias; se conserva la sesión para reintentar.');
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
      if (!esSesionIdValido(sesionId)) {
        return res.status(400).json({
          ok: false,
          error: 'sesionId inválido'
        });
      }

      validarSesionPermitida(
        req,
        sesionId
      );

      await cargarActaEnMemoria(sesionId);

      const deleted = {
        imagenesN: 0,
        actaPdf: false,
        actaImgsN: 0
      };
      let todosEliminados = true;

      const imagenes =
        await Imagen
          .find({ sesionId })
          .lean();

      const imagenesEliminadas = [];

      for (const img of imagenes) {
        const resultado = await deleteStoredFile(img, 'image');

        if (resultado.ok) {
          imagenesEliminadas.push(img._id);
        } else {
          todosEliminados = false;
          console.warn(
            'No se pudo borrar una evidencia de la sesión:',
            img?.storageKey || img?.url,
            resultado.error
          );
        }
      }

      if (imagenesEliminadas.length > 0) {
        await Imagen.deleteMany({
          _id: { $in: imagenesEliminadas },
          sesionId
        });

        deleted.imagenesN =
          imagenesEliminadas.length;
      }

      const store =
        actasEnMemoria[sesionId];

      if (
        store &&
        typeof store === 'object'
      ) {
        if (
          store.acta &&
          (store.acta.public_id || store.acta.storageKey || store.acta.url)
        ) {
          const r = await deleteStoredFile(store.acta, 'raw');

          if (!r.ok) {
            todosEliminados = false;
            console.warn(
              'No se pudo borrar el PDF del acta:',
              store.acta.storageKey || store.acta.public_id,
              r.error
            );
          } else {
            deleted.actaPdf = true;
            store.acta = null;
          }
        }

        if (
          Array.isArray(store.imagenes) &&
          store.imagenes.length > 0
        ) {
          const restantes = [];

          for (const it of store.imagenes) {
            const r = await deleteStoredFile(it, 'image');

            if (r.ok) {
              deleted.actaImgsN += 1;
            } else {
              todosEliminados = false;
              restantes.push(it);
              console.warn(
                'No se pudo borrar una imagen del acta:',
                it?.storageKey || it?.public_id,
                r.error
              );
            }
          }

          store.imagenes = restantes;
        }

        if (!store.acta && store.imagenes.length === 0) {
          delete actasEnMemoria[sesionId];
          await eliminarActaEnDb(sesionId);
        } else {
          await guardarActaEnDb(sesionId);
        }
      }

      cleanupTempsBySession(sesionId);

      return res.status(200).json({
        ok: todosEliminados,
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

    if (!await objectStorage.objectExists(informe)) {
      return res.status(404).json({
        ok: false,
        error: 'No se encontró el PDF del informe en el almacenamiento'
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

    const tiendaId = limpiarTexto(req.query.tiendaId);

    const wantsJson =
      req.query.format === 'json' ||
      (
        req.get('accept') ||
        ''
      ).includes(
        'application/json'
      );

    if (!esSesionIdValido(sesionId)) {
      const error = 'sesionId inválido';

      if (wantsJson) {
        return res.status(400).json({ ok: false, error });
      }

      return res.status(400).send(error);
    }

    res.set('Cache-Control', 'no-store');

    const numeroIncidencia = textoBusqueda(req.query.numeroIncidencia, 120);

    const geolocalizacion =
      normalizarGeolocalizacionDesdeQuery(
        req.query
      );

    let ubicacion =
      textoBusqueda(req.query.ubicacion, 300) ||
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

    const deleteStoredWithRetry = async (
      file,
      resourceType,
      maxAttempts = 3
    ) => {
      if (!file) {
        return {
          ok: false,
          reason: 'Referencia de archivo vacía'
        };
      }

      let lastError = null;

      for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
      ) {
        try {
          const result = await deleteStoredFile(file, resourceType);

          if (result.ok) {
            return {
              ok: true,
              result: 'ok'
            };
          }

          lastError =
            new Error(
              result?.error || result?.reason || 'No se pudo borrar el archivo'
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
      actaFile = null,
      actaImages = []
    }) => {
      const imageResults = [];

      try {
        for (const img of imagenes) {
          const reference = {
            ...img.toObject?.() || img,
            publicId:
              img?.publicId ||
              img?.public_id ||
              getPublicIdFromUrl(img?.url)
          };

          if (
            !reference.storageKey &&
            !reference.url &&
            !reference.publicId
          ) {
            console.warn(
              'No se encontró referencia para eliminar evidencia:',
              img?._id?.toString() ||
              img?.url ||
              'imagen desconocida'
            );

            imageResults.push({
              imageId:
                img?._id?.toString() ||
                null,
              storageKey: null,
              ok: false
            });

            continue;
          }

          const result = await deleteStoredWithRetry(reference, 'image');

          if (!result.ok) {
            console.warn(
              `No se pudo eliminar la evidencia ${reference.storageKey || reference.publicId || reference.url}:`,
              result.error ||
              result.reason
            );
          }

          imageResults.push({
            imageId:
              img?._id?.toString() ||
              null,
            referenceKey:
              reference.storageKey ||
              reference.publicId ||
              reference.url ||
              null,
            ok: result.ok
          });
        }

        let actaDeleted = !actaFile;

        if (actaFile) {
          const reference = {
            ...actaFile,
            publicId:
              actaFile.publicId ||
              actaFile.public_id ||
              getPublicIdFromUrl(actaFile.url, 'raw')
          };
          const result = await deleteStoredWithRetry(reference, 'raw');

          actaDeleted =
            result.ok;

          if (!result.ok) {
            console.warn(
              `No se pudo eliminar el acta ${reference.storageKey || reference.publicId || reference.url}:`,
              result.error ||
              result.reason
            );
          }
        }

        const actaImageResults = [];

        for (const image of actaImages) {
          const reference = {
            ...image,
            publicId:
              image?.publicId ||
              image?.public_id ||
              getPublicIdFromUrl(image?.url)
          };

          if (
            !reference.storageKey &&
            !reference.url &&
            !reference.publicId
          ) {
            actaImageResults.push({
              storageKey: null,
              ok: false
            });

            continue;
          }

          const result = await deleteStoredWithRetry(reference, 'image');

          if (!result.ok) {
            console.warn(
              `No se pudo eliminar imagen de acta ${reference.storageKey || reference.publicId || reference.url}:`,
              result.error ||
              result.reason
            );
          }

          actaImageResults.push({
            referenceKey:
              reference.storageKey ||
              reference.publicId ||
              reference.url ||
              null,
            ok: result.ok
          });
        }

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

        // Se eliminan solo los registros cuyo asset fue borrado.
        // Un deleteMany por sesión borraría imágenes subidas después de la
        // consulta inicial, dejando sus archivos huérfanos en la nube.
        if (successfulImageIds.length > 0) {
          await Imagen.deleteMany({
            _id: {
              $in: successfulImageIds
            },
            sesionId
          });
        }

        if (
          failedImageIds.length > 0
        ) {
          console.warn(
            `La sesión ${sesionId} conserva ${failedImageIds.length} registro(s) de evidencia porque no se pudieron eliminar correctamente del almacenamiento.`
          );
        }

        const allActaImagesDeleted =
          actaImageResults.every(
            (item) =>
              item.ok
          );

        const store = actasEnMemoria[sesionId];
        if (store) {
          if (actaDeleted && actaFile) store.acta = null;
          store.imagenes = store.imagenes.filter((image) =>
            actaImageResults.some(
              (result) =>
                !result.ok &&
                result.referenceKey ===
                  (image.storageKey || image.public_id || image.publicId || image.url)
            )
          );

          if (!store.acta && store.imagenes.length === 0) {
            delete actasEnMemoria[sesionId];
            await eliminarActaEnDb(sesionId);
          } else {
            await guardarActaEnDb(sesionId);
          }
        } else if (!actaDeleted || !allActaImagesDeleted) {
          console.warn(
            `Se conserva temporalmente la información del acta de la sesión ${sesionId}; algunos archivos no se pudieron eliminar.`
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
          `${actaFile ? actaDeleted : true}.`
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
          let doc;
          let stream;

          try {
            doc =
              new PDFDocument({
                margin: 50
              });

            stream =
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

            const logoCubicaBuf = leerLogo(LOGO_CUBICA_PATH);

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

            const logoD1Buf = leerLogo(LOGO_D1_PATH);

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

            if (previas.length === 0 || posteriores.length === 0) {
              throw new Error(
                'La sesión debe incluir al menos una evidencia previa y una posterior para generar el informe.'
              );
            }

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
            try {
              doc?.end();
            } catch {}
            stream?.destroy();
            reject(err);
          }
        }
      );

      const merger = new PDFMerger();

      await cargarActaEnMemoria(sesionId);

      const store = actasEnMemoria[sesionId];
      const actaFile = store?.acta || (
        store?.url
          ? {
              url: store.url,
              public_id: store.public_id || '',
              storageProvider: store.storageProvider || '',
              storageKey: store.storageKey || ''
            }
          : null
      );

      const actaImgsArray =
        Array.isArray(store?.imagenes)
          ? store.imagenes
          : [];

      let hadActaPdf = false;
      let hadActaImgs = false;

      if (actaFile) {
        const actaPath =
          path.join(
            tempDir,
            `acta-${sesionId}.pdf`
          );

        try {
          const actaBuf = await safeGetBuffer(actaFile);

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
            throw new Error(
              `No se pudo descargar un PDF válido del acta de la sesión ${sesionId}; se conservan los archivos para reintentar.`
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
            let doc;
            let stream;

            try {
              doc =
                new PDFDocument({
                  autoFirstPage: false,
                  margin: 40
                });

              stream =
                fs.createWriteStream(
                  actaImgsPath
                );

              doc.pipe(stream);

              for (
                const it of actaImgsArray
              ) {
                const imgBuf = await objectStorage.getOptimizedImageBuffer(it, {
                  width: 1600,
                  quality: 75
                }).catch((error) => {
                  console.warn(
                    'No se pudo optimizar una página del acta:',
                    error?.message || error
                  );
                  return null;
                });

                if (!imgBuf) {
                  throw new Error(
                    `No se pudo cargar una página del acta de la sesión ${sesionId}; se conservan los archivos para reintentar.`
                  );
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
              try {
                doc.end();
              } catch {}
              stream.destroy();
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
      let informeGuardado = false;

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

        informeGuardado = true;
      } catch (err) {
        console.error(
          `Error guardando informe ${sesionId}:`,
          err
        );
      }

      // La limpieza depende solo de que el informe haya quedado guardado.
      // Así no se omite si después falla la construcción de la respuesta.
      if (informeGuardado) {
        try {
          await cleanupSessionAssetsAsync({
            imagenes,
            actaFile,
            actaImages: actaImgsArray
          });
        } catch (cleanupError) {
          console.warn(
            'Error durante la limpieza posterior al guardado del informe:',
            cleanupError?.message || cleanupError
          );
        }
      }

      if (wantsJson) {
        cleanupTemps();

        if (!uploadMeta?.url) {
          return res.status(500).json({
            ok: false,
            error: 'No se guardó correctamente el archivo del informe'
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
        const urlRespuesta = objectStorage.getProvider(uploadMeta) === 'r2'
          ? previewUrl
          : uploadMeta.url;

        return res.status(201).json({
          ok: true,
          id: informeId,
          url: urlRespuesta,
          previewUrl,
          filename: `${nombreArchivo}.pdf`,
          publicId:
            objectStorage.getProvider(uploadMeta) === 'r2'
              ? null
              : uploadMeta?.publicId || null,
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
        () => {
          cleanupTemps();
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

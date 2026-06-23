const sharp = require('sharp');

const DEFAULT_OPTIONS = {
  maxWidth: 1800,
  maxHeight: 2400,
  quality: 90,
  crop: true,
  previewWidth: 1000,
  cropPaddingRatio: 0.018,
  documentThreshold: 132,
  minRowCoverage: 0.13,
  minColCoverage: 0.13,
  minDocumentAreaRatio: 0.16,
  scanMode: 'clean',
  cleanBrightness: 1.22,
  cleanSaturation: 0.28,
  cleanContrast: 1.22,
  cleanOffset: -18,
  colorBrightness: 1.16,
  colorSaturation: 0.45,
  colorContrast: 1.14,
  colorOffset: -10,
  bnContrast: 1.32,
  bnOffset: -26,
  bnThreshold: 166,
  sharpenSigma: 1,
  useClahe: true,
  claheWidth: 5,
  claheHeight: 5,
  claheMaxSlope: 3
};

function crearBase(buffer) {
  return sharp(buffer, {
    limitInputPixels: false,
    failOn: 'none'
  })
    .rotate()
    .flatten({ background: '#ffffff' })
    .removeAlpha();
}

function primerIndiceValido(counts, minCount) {
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] >= minCount) return i;
  }

  return -1;
}

function ultimoIndiceValido(counts, minCount) {
  for (let i = counts.length - 1; i >= 0; i -= 1) {
    if (counts[i] >= minCount) return i;
  }

  return -1;
}

function normalizarCaja(caja, width, height, paddingRatio) {
  const paddingX = Math.round(caja.width * paddingRatio);
  const paddingY = Math.round(caja.height * paddingRatio);

  const left = Math.max(0, caja.left - paddingX);
  const top = Math.max(0, caja.top - paddingY);
  const right = Math.min(width, caja.left + caja.width + paddingX);
  const bottom = Math.min(height, caja.top + caja.height + paddingY);

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function aplicarClahe(pipeline, options) {
  if (!options.useClahe || typeof pipeline.clahe !== 'function') {
    return pipeline;
  }

  return pipeline.clahe({
    width: options.claheWidth,
    height: options.claheHeight,
    maxSlope: options.claheMaxSlope
  });
}

function limitarNumero(valor, min, max, fallback) {
  const num = Number(valor);

  if (!Number.isFinite(num)) return fallback;

  return Math.min(max, Math.max(min, num));
}

async function detectarCajaDocumento(buffer, opts = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...opts
  };

  const base = crearBase(buffer);
  const metadata = await base.clone().metadata();

  if (!metadata.width || !metadata.height) {
    return null;
  }

  const previewWidth = Math.min(options.previewWidth, metadata.width);

  const { data, info } = await base
    .clone()
    .resize({
      width: previewWidth,
      withoutEnlargement: true
    })
    .greyscale()
    .normalise()
    .blur(0.4)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rowCounts = new Uint32Array(info.height);
  const colCounts = new Uint32Array(info.width);
  const threshold = limitarNumero(options.documentThreshold, 80, 230, DEFAULT_OPTIONS.documentThreshold);

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const value = data[y * info.width + x];

      if (value >= threshold) {
        rowCounts[y] += 1;
        colCounts[x] += 1;
      }
    }
  }

  const minRowCount = Math.max(1, Math.floor(info.width * options.minRowCoverage));
  const minColCount = Math.max(1, Math.floor(info.height * options.minColCoverage));

  const top = primerIndiceValido(rowCounts, minRowCount);
  const bottom = ultimoIndiceValido(rowCounts, minRowCount);
  const left = primerIndiceValido(colCounts, minColCount);
  const right = ultimoIndiceValido(colCounts, minColCount);

  if (top < 0 || bottom < 0 || left < 0 || right < 0) {
    return null;
  }

  const previewBox = {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1
  };

  const areaRatio = (previewBox.width * previewBox.height) / (info.width * info.height);

  if (areaRatio < options.minDocumentAreaRatio) {
    return null;
  }

  const scaleX = metadata.width / info.width;
  const scaleY = metadata.height / info.height;

  const originalBox = {
    left: Math.round(previewBox.left * scaleX),
    top: Math.round(previewBox.top * scaleY),
    width: Math.round(previewBox.width * scaleX),
    height: Math.round(previewBox.height * scaleY)
  };

  return normalizarCaja(
    originalBox,
    metadata.width,
    metadata.height,
    options.cropPaddingRatio
  );
}

function aplicarModoBN(pipeline, options) {
  const threshold = limitarNumero(options.bnThreshold, 120, 220, DEFAULT_OPTIONS.bnThreshold);

  return aplicarClahe(
    pipeline
      .greyscale()
      .normalise()
      .linear(options.bnContrast, options.bnOffset),
    options
  )
    .threshold(threshold)
    .median(1)
    .sharpen({
      sigma: options.sharpenSigma,
      m1: 1.4,
      m2: 2.2
    });
}

function aplicarModoClean(pipeline, options) {
  return aplicarClahe(
    pipeline
      .normalise()
      .modulate({
        brightness: options.cleanBrightness,
        saturation: options.cleanSaturation
      })
      .linear(options.cleanContrast, options.cleanOffset),
    options
  )
    .sharpen({
      sigma: options.sharpenSigma,
      m1: 1.35,
      m2: 2.1
    });
}

function aplicarModoColor(pipeline, options) {
  return aplicarClahe(
    pipeline
      .normalise()
      .modulate({
        brightness: options.colorBrightness,
        saturation: options.colorSaturation
      })
      .linear(options.colorContrast, options.colorOffset),
    options
  )
    .sharpen({
      sigma: options.sharpenSigma,
      m1: 1.25,
      m2: 1.9
    });
}

function aplicarModoEscaneo(pipeline, options) {
  if (options.scanMode === 'bn') {
    return aplicarModoBN(pipeline, options);
  }

  if (options.scanMode === 'color') {
    return aplicarModoColor(pipeline, options);
  }

  return aplicarModoClean(pipeline, options);
}

async function procesarImagenActa(buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('El buffer de la imagen del acta es obligatorio.');
  }

  const options = {
    ...DEFAULT_OPTIONS,
    ...opts
  };

  const base = crearBase(buffer);
  const metadata = await base.clone().metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('No se pudo leer la imagen del acta.');
  }

  let cajaDocumento = null;

  if (options.crop) {
    cajaDocumento = await detectarCajaDocumento(buffer, options);
  }

  let pipeline = base.clone();

  if (cajaDocumento) {
    pipeline = pipeline.extract(cajaDocumento);
  }

  pipeline = aplicarModoEscaneo(pipeline, options);

  const { data, info } = await pipeline
    .resize({
      width: options.maxWidth,
      height: options.maxHeight,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({
      quality: options.quality,
      mozjpeg: true,
      chromaSubsampling: '4:4:4'
    })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    mimetype: 'image/jpeg',
    extension: 'jpg',
    procesada: true,
    width: info.width,
    height: info.height,
    crop: cajaDocumento,
    scanMode: options.scanMode
  };
}

async function procesarImagenActaSeguro(buffer, opts = {}) {
  try {
    return await procesarImagenActa(buffer, opts);
  } catch (error) {
    return {
      buffer,
      mimetype: opts.mimetype || 'image/jpeg',
      extension: 'jpg',
      procesada: false,
      width: null,
      height: null,
      crop: null,
      scanMode: opts.scanMode || DEFAULT_OPTIONS.scanMode,
      error: error.message || 'No se pudo procesar la imagen del acta.'
    };
  }
}

module.exports = {
  procesarImagenActa,
  procesarImagenActaSeguro,
  detectarCajaDocumento
};
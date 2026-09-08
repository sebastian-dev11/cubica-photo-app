const sharp = require('sharp');

const DEFAULT_OPTIONS = {
  maxWidth: 1800,
  maxHeight: 2400,
  quality: 90,
  crop: true,
  previewWidth: 1000,
  cropPaddingRatio: 0.02,
  documentThreshold: 132,
  minRowCoverage: 0.13,
  minColCoverage: 0.13,
  minDocumentAreaRatio: 0.16,
  scanMode: 'soft',
  softBrightness: 1.08,
  softSaturation: 0.9,
  softContrast: 1.02,
  softOffset: -2,
  cleanBrightness: 1.12,
  cleanSaturation: 0.72,
  cleanContrast: 1.05,
  cleanOffset: -5,
  bnBrightness: 1.08,
  bnContrast: 1.08,
  bnOffset: -6,
  sharpenSigma: 0.45
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

function aplicarNitidezSuave(pipeline, options) {
  return pipeline.sharpen({
    sigma: options.sharpenSigma,
    m1: 0.45,
    m2: 0.75
  });
}

function aplicarModoSoft(pipeline, options) {
  return aplicarNitidezSuave(
    pipeline
      .modulate({
        brightness: options.softBrightness,
        saturation: options.softSaturation
      })
      .linear(options.softContrast, options.softOffset),
    options
  );
}

function aplicarModoClean(pipeline, options) {
  return aplicarNitidezSuave(
    pipeline
      .normalise()
      .modulate({
        brightness: options.cleanBrightness,
        saturation: options.cleanSaturation
      })
      .linear(options.cleanContrast, options.cleanOffset),
    options
  );
}

function aplicarModoBN(pipeline, options) {
  return aplicarNitidezSuave(
    pipeline
      .greyscale()
      .modulate({
        brightness: options.bnBrightness
      })
      .linear(options.bnContrast, options.bnOffset),
    options
  );
}

function aplicarModoEscaneo(pipeline, options) {
  if (options.scanMode === 'bn') {
    return aplicarModoBN(pipeline, options);
  }

  if (options.scanMode === 'clean') {
    return aplicarModoClean(pipeline, options);
  }

  return aplicarModoSoft(pipeline, options);
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
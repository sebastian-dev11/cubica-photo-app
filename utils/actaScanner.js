const sharp = require('sharp');

// Límite superior para imágenes de entrada (evita descompresiones excesivas).
const LIMITE_PIXELES_ENTRADA = 40 * 1000 * 1000;

const DEFAULT_OPTIONS = {
  maxWidth: 1800,
  maxHeight: 2400,
  maxOutputPixels: 4500000,
  quality: 90,
  crop: true,
  previewWidth: 1000,
  cropPaddingRatio: 0.02,
  colorThreshold: 26,
  minRowCoverage: 0.13,
  minColCoverage: 0.13,
  minDocumentAreaRatio: 0.16,
  maskErosion: 1,
  quadInsetRatio: 0.008,
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
  sharpenSigma: 0.45,
  detectarPerspectiva: true
};

const EXTENSIONES_POR_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff'
};

const MODOS_VALIDOS = ['original', 'soft', 'clean', 'bn'];
const MODOS_ALIAS = {
  'bw': 'bn',
  'b/n': 'bn',
  blanco: 'bn',
  blanco_negro: 'bn',
  'blanco y negro': 'bn',
  gray: 'bn',
  gris: 'bn',
  magic: 'clean',
  color: 'clean',
  documento: 'clean',
  auto: 'clean'
};

function resolverFormatoOriginal(mimetype) {
  const mime = String(mimetype || '')
    .split(';')[0]
    .toLowerCase()
    .trim();

  return {
    mimetype: mime || 'image/jpeg',
    extension: EXTENSIONES_POR_MIME[mime] || 'jpg'
  };
}

function crearBase(buffer) {
  return sharp(buffer, {
    limitInputPixels: LIMITE_PIXELES_ENTRADA,
    failOn: 'none'
  })
    .rotate()
    .flatten({ background: '#ffffff' })
    .removeAlpha();
}

function limitarNumero(valor, min, max, fallback) {
  const num = Number(valor);

  if (!Number.isFinite(num)) return fallback;

  return Math.min(max, Math.max(min, num));
}

function mediana(valores) {
  if (!valores || valores.length === 0) return 0;

  const ordenados = Array.from(valores).sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);

  return ordenados.length % 2 === 0
    ? (ordenados[medio - 1] + ordenados[medio]) / 2
    : ordenados[medio];
}

function dimensionesOrientadas(metadata) {
  if (metadata?.autoOrient?.width && metadata?.autoOrient?.height) {
    return {
      width: metadata.autoOrient.width,
      height: metadata.autoOrient.height
    };
  }

  return {
    width: metadata?.width || 0,
    height: metadata?.height || 0
  };
}

function normalizarScanMode(modo, fallback = 'soft') {
  const valor = String(modo || '')
    .toLowerCase()
    .trim();

  if (!valor) return fallback;

  const normalizado = MODOS_ALIAS[valor] || valor;

  return MODOS_VALIDOS.includes(normalizado) ? normalizado : fallback;
}

function resolverCrop(valor) {
  if (valor === undefined || valor === null || valor === '') return true;
  if (typeof valor === 'boolean') return valor;

  const texto = String(valor).toLowerCase().trim();

  if (['false', '0', 'no', 'none', 'sin', 'completo'].includes(texto)) return false;
  if (['manual', 'auto', 'true', '1', 'si', 'sí'].includes(texto)) return true;

  return true;
}

function ordenarQuad(puntos) {
  const conMetricas = puntos.map((punto) => ({
    x: Number(punto.x),
    y: Number(punto.y),
    suma: Number(punto.x) + Number(punto.y),
    diferencia: Number(punto.x) - Number(punto.y)
  }));

  const porSuma = conMetricas.slice().sort((a, b) => a.suma - b.suma);
  const porDiferencia = conMetricas.slice().sort((a, b) => b.diferencia - a.diferencia);

  const superiorIzquierda = porSuma[0];
  const inferiorDerecha = porSuma[porSuma.length - 1];
  const superiorDerecha = porDiferencia[0];
  const inferiorIzquierda = porDiferencia[porDiferencia.length - 1];

  const unicos = new Set([
    superiorIzquierda,
    superiorDerecha,
    inferiorDerecha,
    inferiorIzquierda
  ]);

  if (unicos.size === 4) {
    return [superiorIzquierda, superiorDerecha, inferiorDerecha, inferiorIzquierda].map(
      ({ x, y }) => ({ x, y })
    );
  }

  const centro = conMetricas.reduce(
    (acc, punto) => ({
      x: acc.x + punto.x / conMetricas.length,
      y: acc.y + punto.y / conMetricas.length
    }),
    { x: 0, y: 0 }
  );

  const ordenados = conMetricas
    .slice()
    .sort(
      (a, b) =>
        Math.atan2(a.y - centro.y, a.x - centro.x) -
        Math.atan2(b.y - centro.y, b.x - centro.x)
    );

  const inicio = ordenados.reduce(
    (mejor, punto, indice) =>
      punto.x + punto.y < ordenados[mejor].x + ordenados[mejor].y ? indice : mejor,
    0
  );

  return ordenados
    .slice(inicio)
    .concat(ordenados.slice(0, inicio))
    .map(({ x, y }) => ({ x, y }));
}

function normalizarQuadEntrada(quad, width, height, opciones = {}) {
  if (!quad) return null;

  let puntos = quad;

  if (typeof puntos === 'string') {
    try {
      puntos = JSON.parse(puntos);
    } catch (error) {
      return null;
    }
  }

  if (!Array.isArray(puntos) || puntos.length !== 4) return null;

  const convertidos = puntos
    .map((punto) => {
      if (Array.isArray(punto)) {
        return { x: Number(punto[0]), y: Number(punto[1]) };
      }

      if (punto && typeof punto === 'object') {
        return { x: Number(punto.x), y: Number(punto.y) };
      }

      return null;
    })
    .filter(Boolean);

  if (convertidos.length !== 4) return null;

  const valores = convertidos.flatMap((punto) => [punto.x, punto.y]);

  if (valores.some((valor) => !Number.isFinite(valor))) return null;

  const maximo = Math.max(...valores);
  const minimo = Math.min(...valores);
  const normalizado =
    opciones.quadUnidades === 'normalizado' ||
    (opciones.quadUnidades !== 'pixel' &&
      maximo <= 1.001 &&
      minimo >= -0.001 &&
      width > 1 &&
      height > 1);

  const enPixeles = convertidos.map((punto) => ({
    x: normalizado ? punto.x * width : punto.x,
    y: normalizado ? punto.y * height : punto.y
  }));

  const ordenados = ordenarQuad(enPixeles).map((punto) => ({
    x: Math.min(width - 1, Math.max(0, punto.x)),
    y: Math.min(height - 1, Math.max(0, punto.y))
  }));

  if (areaQuad(ordenados) < 400) return null;

  return ordenados;
}

function areaQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 4) return 0;

  let suma = 0;

  for (let i = 0; i < 4; i += 1) {
    const actual = quad[i];
    const siguiente = quad[(i + 1) % 4];
    suma += actual.x * siguiente.y - siguiente.x * actual.y;
  }

  return Math.abs(suma) / 2;
}

function esQuadConvexo(quad) {
  let signo = 0;

  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cruz =
      (b.x - a.x) * (c.y - b.y) -
      (b.y - a.y) * (c.x - b.x);

    if (Math.abs(cruz) < 1e-6) continue;

    const actual = Math.sign(cruz);

    if (signo === 0) {
      signo = actual;
    } else if (actual !== signo) {
      return false;
    }
  }

  return signo !== 0;
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

function estimarColorFondo(data, width, height, channels) {
  const muestras = Array.from({ length: channels }, () => []);
  const margenX = Math.max(1, Math.round(width * 0.02));
  const margenY = Math.max(1, Math.round(height * 0.02));
  const pasoX = Math.max(1, Math.floor(width / 120));
  const pasoY = Math.max(1, Math.floor(height / 120));

  const agregar = (x, y) => {
    const offset = (y * width + x) * channels;

    for (let c = 0; c < channels; c += 1) {
      muestras[c].push(data[offset + c]);
    }
  };

  for (let y = 0; y < margenY; y += 1) {
    for (let x = 0; x < width; x += pasoX) agregar(x, y);
  }

  for (let y = Math.max(0, height - margenY); y < height; y += 1) {
    for (let x = 0; x < width; x += pasoX) agregar(x, y);
  }

  for (let x = 0; x < margenX; x += 1) {
    for (let y = 0; y < height; y += pasoY) agregar(x, y);
  }

  for (let x = Math.max(0, width - margenX); x < width; x += 1) {
    for (let y = 0; y < height; y += pasoY) agregar(x, y);
  }

  return muestras.map((valores) => mediana(valores));
}

function umbralOtsu(histograma, total) {
  let sumaTotal = 0;

  for (let i = 0; i < histograma.length; i += 1) {
    sumaTotal += i * histograma[i];
  }

  let sumaFondo = 0;
  let pesoFondo = 0;
  let maximo = -1;
  let umbral = 0;

  for (let i = 0; i < histograma.length; i += 1) {
    pesoFondo += histograma[i];

    if (pesoFondo === 0) continue;

    const pesoFrente = total - pesoFondo;

    if (pesoFrente === 0) break;

    sumaFondo += i * histograma[i];

    const mediaFondo = sumaFondo / pesoFondo;
    const mediaFrente = (sumaTotal - sumaFondo) / pesoFrente;
    const varianza = pesoFondo * pesoFrente * (mediaFondo - mediaFrente) ** 2;

    if (varianza > maximo) {
      maximo = varianza;
      umbral = i;
    }
  }

  return umbral;
}

function erosionarMascara(mascara, width, height, iteraciones = 1) {
  let actual = mascara;

  for (let iteracion = 0; iteracion < iteraciones; iteracion += 1) {
    const siguiente = new Uint8Array(actual.length);

    for (let y = 1; y < height - 1; y += 1) {
      const fila = y * width;

      for (let x = 1; x < width - 1; x += 1) {
        const indice = fila + x;

        if (
          actual[indice] &&
          actual[indice - 1] &&
          actual[indice + 1] &&
          actual[indice - width] &&
          actual[indice + width]
        ) {
          siguiente[indice] = 1;
        }
      }
    }

    actual = siguiente;
  }

  return actual;
}

function construirMascaraDocumento(data, width, height, channels, options) {
  const fondo = estimarColorFondo(data, width, height, channels);
  const total = width * height;
  const distancias = new Uint8ClampedArray(total);
  const histograma = new Uint32Array(256);

  for (let i = 0; i < total; i += 1) {
    const offset = i * channels;
    let suma = 0;

    for (let c = 0; c < channels; c += 1) {
      suma += Math.abs(data[offset + c] - fondo[c]);
    }

    const distancia = Math.min(255, Math.round(suma / channels));

    distancias[i] = distancia;
    histograma[distancia] += 1;
  }

  const otsu = umbralOtsu(histograma, total);
  const minimo = limitarNumero(options.colorThreshold, 4, 120, DEFAULT_OPTIONS.colorThreshold);
  const umbral = Math.min(190, Math.max(minimo, otsu));
  const mascara = new Uint8Array(total);

  for (let i = 0; i < total; i += 1) {
    mascara[i] = distancias[i] >= umbral ? 1 : 0;
  }

  return {
    mascara,
    umbral,
    fondo
  };
}

function ajustarLinea(puntos, porY) {
  if (!Array.isArray(puntos) || puntos.length < 2) return null;

  let n = 0;
  let sumaIndependiente = 0;
  let sumaDependiente = 0;
  let sumaCuadrados = 0;
  let sumaProductos = 0;

  for (const punto of puntos) {
    const independiente = porY ? punto.y : punto.x;
    const dependiente = porY ? punto.x : punto.y;

    n += 1;
    sumaIndependiente += independiente;
    sumaDependiente += dependiente;
    sumaCuadrados += independiente * independiente;
    sumaProductos += independiente * dependiente;
  }

  const denominador = n * sumaCuadrados - sumaIndependiente * sumaIndependiente;

  if (Math.abs(denominador) < 1e-6) return null;

  const a = (n * sumaProductos - sumaIndependiente * sumaDependiente) / denominador;
  const b = (sumaDependiente - a * sumaIndependiente) / n;

  return { a, b, porY };
}

function ajustarLineaRobusta(puntos, porY) {
  const inicial = ajustarLinea(puntos, porY);

  if (!inicial) return null;

  const residuos = puntos.map((punto) => {
    const independiente = porY ? punto.y : punto.x;
    const dependiente = porY ? punto.x : punto.y;

    return Math.abs(dependiente - (inicial.a * independiente + inicial.b));
  });

  const centro = mediana(residuos);
  const limite = Math.max(1.5, centro * 3.5);
  const filtrados = puntos.filter((punto, indice) => residuos[indice] <= limite);

  return ajustarLinea(filtrados, porY) || inicial;
}

function interseccionLineas(lineaX, lineaY) {
  if (!lineaX || !lineaY) return null;

  const denominador = 1 - lineaX.a * lineaY.a;

  if (Math.abs(denominador) < 1e-6) return null;

  const x = (lineaX.a * lineaY.b + lineaX.b) / denominador;
  const y = lineaY.a * x + lineaY.b;

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

function quadDesdeCaja(caja) {
  return [
    { x: caja.left, y: caja.top },
    { x: caja.left + caja.width, y: caja.top },
    { x: caja.left + caja.width, y: caja.top + caja.height },
    { x: caja.left, y: caja.top + caja.height }
  ];
}

function cajaDesdeQuad(quad) {
  const xs = quad.map((punto) => punto.x);
  const ys = quad.map((punto) => punto.y);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.ceil(Math.max(...xs));
  const bottom = Math.ceil(Math.max(...ys));

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function contraerQuad(quad, ratio) {
  const factor = 1 - limitarNumero(ratio, -0.2, 0.2, DEFAULT_OPTIONS.quadInsetRatio);

  if (!quad || factor === 1) return quad;

  const centro = quad.reduce(
    (acc, punto) => ({
      x: acc.x + punto.x / quad.length,
      y: acc.y + punto.y / quad.length
    }),
    { x: 0, y: 0 }
  );

  return quad.map((punto) => ({
    x: centro.x + (punto.x - centro.x) * factor,
    y: centro.y + (punto.y - centro.y) * factor
  }));
}

function estimarQuadDesdeMascara(mascara, info, caja, options) {
  const { width, height } = info;
  const pasoY = Math.max(1, Math.floor((caja.height || 1) / 180));
  const pasoX = Math.max(1, Math.floor((caja.width || 1) / 180));
  const derecha = caja.left + caja.width - 1;
  const abajo = caja.top + caja.height - 1;

  const izquierda = [];
  const derechaPuntos = [];
  const superior = [];
  const inferior = [];

  for (let y = caja.top; y <= abajo; y += pasoY) {
    let xIzquierda = -1;
    let xDerecha = -1;

    for (let x = caja.left; x <= derecha; x += 1) {
      if (mascara[y * width + x]) {
        xIzquierda = x;
        break;
      }
    }

    for (let x = derecha; x >= caja.left; x -= 1) {
      if (mascara[y * width + x]) {
        xDerecha = x;
        break;
      }
    }

    if (xIzquierda >= 0 && xDerecha > xIzquierda) {
      izquierda.push({ x: xIzquierda, y });
      derechaPuntos.push({ x: xDerecha, y });
    }
  }

  for (let x = caja.left; x <= derecha; x += pasoX) {
    let ySuperior = -1;
    let yInferior = -1;

    for (let y = caja.top; y <= abajo; y += 1) {
      if (mascara[y * width + x]) {
        ySuperior = y;
        break;
      }
    }

    for (let y = abajo; y >= caja.top; y -= 1) {
      if (mascara[y * width + x]) {
        yInferior = y;
        break;
      }
    }

    if (ySuperior >= 0 && yInferior > ySuperior) {
      superior.push({ x, y: ySuperior });
      inferior.push({ x, y: yInferior });
    }
  }

  const lineaIzquierda = ajustarLineaRobusta(izquierda, true);
  const lineaDerecha = ajustarLineaRobusta(derechaPuntos, true);
  const lineaSuperior = ajustarLineaRobusta(superior, false);
  const lineaInferior = ajustarLineaRobusta(inferior, false);

  if (!lineaIzquierda || !lineaDerecha || !lineaSuperior || !lineaInferior) return null;

  const superiorIzquierda = interseccionLineas(lineaIzquierda, lineaSuperior);
  const superiorDerecha = interseccionLineas(lineaDerecha, lineaSuperior);
  const inferiorDerecha = interseccionLineas(lineaDerecha, lineaInferior);
  const inferiorIzquierda = interseccionLineas(lineaIzquierda, lineaInferior);

  if (
    !superiorIzquierda ||
    !superiorDerecha ||
    !inferiorDerecha ||
    !inferiorIzquierda
  ) {
    return null;
  }

  const quad = [
    superiorIzquierda,
    superiorDerecha,
    inferiorDerecha,
    inferiorIzquierda
  ].map((punto) => ({
    x: Math.min(width - 1, Math.max(0, punto.x)),
    y: Math.min(height - 1, Math.max(0, punto.y))
  }));

  const area = areaQuad(quad);

  if (area < width * height * options.minDocumentAreaRatio || !esQuadConvexo(quad)) {
    return null;
  }

  return quad;
}

async function analizarDocumento(buffer, opts = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...opts
  };

  const base = crearBase(buffer);
  const metadata = await base.clone().metadata();
  const dimensiones = dimensionesOrientadas(metadata);

  if (!dimensiones.width || !dimensiones.height) return null;

  const previewWidth = Math.min(options.previewWidth, dimensiones.width);

  const { data, info } = await base
    .clone()
    .resize({
      width: previewWidth,
      withoutEnlargement: true
    })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { mascara } = construirMascaraDocumento(
    data,
    info.width,
    info.height,
    info.channels,
    options
  );

  const mascaraDocumento = erosionarMascara(
    mascara,
    info.width,
    info.height,
    limitarNumero(options.maskErosion, 0, 4, 1)
  );

  const rowCounts = new Uint32Array(info.height);
  const colCounts = new Uint32Array(info.width);

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (!mascaraDocumento[y * info.width + x]) continue;

      rowCounts[y] += 1;
      colCounts[x] += 1;
    }
  }

  const minRowCount = Math.max(1, Math.floor(info.width * options.minRowCoverage));
  const minColCount = Math.max(1, Math.floor(info.height * options.minColCoverage));

  const top = primerIndiceValido(rowCounts, minRowCount);
  const bottom = ultimoIndiceValido(rowCounts, minRowCount);
  const left = primerIndiceValido(colCounts, minColCount);
  const right = ultimoIndiceValido(colCounts, minColCount);

  if (top < 0 || bottom < 0 || left < 0 || right < 0 || bottom <= top || right <= left) {
    return null;
  }

  const previewBox = {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1
  };

  const areaRatio = (previewBox.width * previewBox.height) / (info.width * info.height);

  if (areaRatio < options.minDocumentAreaRatio) return null;

  let quadPreview = options.detectarPerspectiva
    ? estimarQuadDesdeMascara(mascaraDocumento, info, previewBox, options)
    : null;

  const metodo = quadPreview ? 'perspectiva' : 'rectangulo';

  if (!quadPreview) {
    quadPreview = quadDesdeCaja(
      normalizarCaja(previewBox, info.width, info.height, options.cropPaddingRatio)
    );
  }

  const scaleX = dimensiones.width / info.width;
  const scaleY = dimensiones.height / info.height;

  const quad = ordenarQuad(
    quadPreview.map((punto) => ({
      x: Math.round(punto.x * scaleX),
      y: Math.round(punto.y * scaleY)
    }))
  ).map((punto) => ({
    x: Math.min(dimensiones.width - 1, Math.max(0, punto.x)),
    y: Math.min(dimensiones.height - 1, Math.max(0, punto.y))
  }));

  const quadFinal =
    metodo === 'perspectiva'
      ? contraerQuad(quad, options.quadInsetRatio).map((punto) => ({
          x: Math.min(dimensiones.width - 1, Math.max(0, punto.x)),
          y: Math.min(dimensiones.height - 1, Math.max(0, punto.y))
        }))
      : quad;

  if (areaQuad(quadFinal) < 400) return null;

  const box = cajaDesdeQuad(quadFinal);
  const confianza =
    metodo === 'perspectiva'
      ? Number(Math.min(1, areaRatio / 0.85).toFixed(2))
      : 0.4;

  return {
    detectado: true,
    metodo,
    quad: quadFinal,
    quadNormalizado: quadFinal.map((punto) => ({
      x: Number((punto.x / dimensiones.width).toFixed(5)),
      y: Number((punto.y / dimensiones.height).toFixed(5))
    })),
    box,
    width: dimensiones.width,
    height: dimensiones.height,
    areaRatio: Number(areaRatio.toFixed(4)),
    confianza
  };
}

async function detectarDocumento(buffer, opts = {}) {
  return analizarDocumento(buffer, opts);
}

async function detectarCajaDocumento(buffer, opts = {}) {
  const analisis = await analizarDocumento(buffer, opts);

  return analisis?.box || null;
}

function distanciaEntre(puntoA, puntoB) {
  return Math.hypot(puntoA.x - puntoB.x, puntoA.y - puntoB.y);
}

function calcularHomografia(destino, origen) {
  if (!Array.isArray(destino) || !Array.isArray(origen) || destino.length !== 4 || origen.length !== 4) {
    return null;
  }

  const matriz = [];
  const vector = [];

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = origen[i];
    const { x: u, y: v } = destino[i];

    matriz.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    vector.push(x);
    matriz.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    vector.push(y);
  }

  const n = vector.length;
  const aumentada = matriz.map((fila, indice) => [...fila, vector[indice]]);

  for (let columna = 0; columna < n; columna += 1) {
    let pivote = columna;

    for (let fila = columna + 1; fila < n; fila += 1) {
      if (Math.abs(aumentada[fila][columna]) > Math.abs(aumentada[pivote][columna])) {
        pivote = fila;
      }
    }

    if (Math.abs(aumentada[pivote][columna]) < 1e-10) return null;

    [aumentada[columna], aumentada[pivote]] = [aumentada[pivote], aumentada[columna]];

    const divisor = aumentada[columna][columna];

    for (let c = columna; c <= n; c += 1) {
      aumentada[columna][c] /= divisor;
    }

    for (let fila = 0; fila < n; fila += 1) {
      if (fila === columna) continue;

      const factor = aumentada[fila][columna];

      if (!factor) continue;

      for (let c = columna; c <= n; c += 1) {
        aumentada[fila][c] -= factor * aumentada[columna][c];
      }
    }
  }

  return aumentada.map((fila) => fila[n]);
}

function dimensionesWarp(quad, options) {
  const [superiorIzquierda, superiorDerecha, inferiorDerecha, inferiorIzquierda] = quad;

  const anchoSuperior = distanciaEntre(superiorIzquierda, superiorDerecha);
  const anchoInferior = distanciaEntre(inferiorIzquierda, inferiorDerecha);
  const altoIzquierdo = distanciaEntre(superiorIzquierda, inferiorIzquierda);
  const altoDerecho = distanciaEntre(superiorDerecha, inferiorDerecha);

  let width = Math.max(1, Math.round(Math.max(anchoSuperior, anchoInferior)));
  let height = Math.max(1, Math.round(Math.max(altoIzquierdo, altoDerecho)));

  const maxWidth = limitarNumero(options.maxWidth, 200, 6000, DEFAULT_OPTIONS.maxWidth);
  const maxHeight = limitarNumero(options.maxHeight, 200, 8000, DEFAULT_OPTIONS.maxHeight);
  const maxPixeles = limitarNumero(
    options.maxOutputPixels,
    250000,
    20000000,
    DEFAULT_OPTIONS.maxOutputPixels
  );

  const escala = Math.min(
    1,
    maxWidth / width,
    maxHeight / height,
    Math.sqrt(maxPixeles / (width * height))
  );

  width = Math.max(1, Math.round(width * escala));
  height = Math.max(1, Math.round(height * escala));

  return { width, height };
}

function warpPerspectiva(raw, quad, options = {}) {
  if (!raw?.data || !raw?.info) return null;

  const { data, info } = raw;

  if (!info.width || !info.height || !info.channels) return null;

  const { width, height } = dimensionesWarp(quad, {
    ...DEFAULT_OPTIONS,
    ...options
  });

  const destino = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 }
  ];

  const homografia = calcularHomografia(destino, quad);

  if (!homografia) return null;

  const canalesOrigen = info.channels;
  const anchoOrigen = info.width;
  const altoOrigen = info.height;
  const salida = Buffer.allocUnsafe(width * height * 3);
  const blanco = 255;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const denominador = homografia[6] * x + homografia[7] * y + 1;
      const destinoOffset = (y * width + x) * 3;

      if (Math.abs(denominador) < 1e-9) {
        salida[destinoOffset] = blanco;
        salida[destinoOffset + 1] = blanco;
        salida[destinoOffset + 2] = blanco;
        continue;
      }

      const origenX = (homografia[0] * x + homografia[1] * y + homografia[2]) / denominador;
      const origenY = (homografia[3] * x + homografia[4] * y + homografia[5]) / denominador;

      if (
        !Number.isFinite(origenX) ||
        !Number.isFinite(origenY) ||
        origenX < 0 ||
        origenY < 0 ||
        origenX > anchoOrigen - 1 ||
        origenY > altoOrigen - 1
      ) {
        salida[destinoOffset] = blanco;
        salida[destinoOffset + 1] = blanco;
        salida[destinoOffset + 2] = blanco;
        continue;
      }

      const x0 = Math.floor(origenX);
      const y0 = Math.floor(origenY);
      const x1 = Math.min(anchoOrigen - 1, x0 + 1);
      const y1 = Math.min(altoOrigen - 1, y0 + 1);
      const fraccionX = origenX - x0;
      const fraccionY = origenY - y0;

      const offset00 = (y0 * anchoOrigen + x0) * canalesOrigen;
      const offset10 = (y0 * anchoOrigen + x1) * canalesOrigen;
      const offset01 = (y1 * anchoOrigen + x0) * canalesOrigen;
      const offset11 = (y1 * anchoOrigen + x1) * canalesOrigen;

      if (canalesOrigen === 1) {
        const superior =
          data[offset00] * (1 - fraccionX) + data[offset10] * fraccionX;
        const inferior =
          data[offset01] * (1 - fraccionX) + data[offset11] * fraccionX;
        const valor = superior * (1 - fraccionY) + inferior * fraccionY;

        salida[destinoOffset] = valor;
        salida[destinoOffset + 1] = valor;
        salida[destinoOffset + 2] = valor;
        continue;
      }

      for (let canal = 0; canal < 3; canal += 1) {
        const c = canal < canalesOrigen ? canal : canalesOrigen - 1;
        const superior =
          data[offset00 + c] * (1 - fraccionX) + data[offset10 + c] * fraccionX;
        const inferior =
          data[offset01 + c] * (1 - fraccionX) + data[offset11 + c] * fraccionX;

        salida[destinoOffset + canal] = superior * (1 - fraccionY) + inferior * fraccionY;
      }
    }
  }

  return {
    data: salida,
    width,
    height,
    channels: 3
  };
}

function aplicarNitidezSuave(pipeline, options) {
  return pipeline.sharpen({
    sigma: options.sharpenSigma,
    m1: 0.45,
    m2: 0.75
  });
}

function aplicarModoOriginal(pipeline) {
  return pipeline;
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
      .normalise()
      .modulate({
        brightness: options.bnBrightness
      })
      .linear(options.bnContrast, options.bnOffset),
    options
  );
}

function aplicarModoEscaneo(pipeline, options) {
  const modo = normalizarScanMode(options.scanMode, DEFAULT_OPTIONS.scanMode);

  if (modo === 'original') return aplicarModoOriginal(pipeline);
  if (modo === 'bn') return aplicarModoBN(pipeline, options);
  if (modo === 'clean') return aplicarModoClean(pipeline, options);

  return aplicarModoSoft(pipeline, options);
}

function normalizarQuadSalida(quad, width, height) {
  if (!quad || !width || !height) return null;

  return quad.map((punto) => ({
    x: Number((punto.x / width).toFixed(5)),
    y: Number((punto.y / height).toFixed(5))
  }));
}

async function procesarImagenActa(buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('El buffer de la imagen del acta es obligatorio.');
  }

  // Modo de subida normal: se devuelve el buffer original sin recortar,
  // sin corregir perspectiva, sin filtros y sin recodificar. Solo se leen
  // las dimensiones (respetando EXIF) para la metadata del registro.
  if (opts.sinProcesamiento === true) {
    const formato = resolverFormatoOriginal(opts.mimetype);
    let dimensiones = { width: null, height: null };

    try {
      dimensiones = dimensionesOrientadas(
        await crearBase(buffer).clone().metadata()
      );
    } catch {
      // Se sube igual; Cloudinary resolverá las dimensiones reales.
    }

    return {
      buffer,
      mimetype: formato.mimetype,
      extension: formato.extension,
      procesada: false,
      width: dimensiones.width || null,
      height: dimensiones.height || null,
      originalWidth: dimensiones.width || null,
      originalHeight: dimensiones.height || null,
      crop: null,
      quad: null,
      metodo: 'completo',
      scanMode: 'original'
    };
  }

  const options = {
    ...DEFAULT_OPTIONS,
    ...opts,
    scanMode: normalizarScanMode(opts.scanMode, DEFAULT_OPTIONS.scanMode)
  };

  const base = crearBase(buffer);
  const metadata = await base.clone().metadata();
  const dimensiones = dimensionesOrientadas(metadata);

  if (!dimensiones.width || !dimensiones.height) {
    throw new Error('No se pudo leer la imagen del acta.');
  }

  const cropHabilitado = resolverCrop(options.crop);
  let analisis = null;
  let quad = normalizarQuadEntrada(options.quad, dimensiones.width, dimensiones.height, options);
  let metodo = quad ? 'manual' : null;

  if (!quad && cropHabilitado) {
    analisis = await analizarDocumento(buffer, options);

    if (analisis?.metodo === 'perspectiva') {
      quad = analisis.quad;
      metodo = 'perspectiva';
    }
  }

  let pipeline = null;

  if (quad) {
    const raw = await base
      .clone()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });

    const warp = warpPerspectiva(raw, quad, options);

    if (warp) {
      pipeline = sharp(warp.data, {
        raw: {
          width: warp.width,
          height: warp.height,
          channels: warp.channels
        },
        limitInputPixels: LIMITE_PIXELES_ENTRADA
      });
    }
  }

  if (!pipeline && cropHabilitado && analisis?.box) {
    pipeline = base.clone().extract(analisis.box);
    metodo = analisis.metodo === 'rectangulo' ? 'rectangulo' : 'recorte';
  }

  if (!pipeline) {
    pipeline = base.clone();
    metodo = 'completo';
  }

  pipeline = aplicarModoEscaneo(pipeline, options);

  const { data, info } = await pipeline
    .resize({
      width: limitarNumero(options.maxWidth, 200, 6000, DEFAULT_OPTIONS.maxWidth),
      height: limitarNumero(options.maxHeight, 200, 8000, DEFAULT_OPTIONS.maxHeight),
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({
      quality: limitarNumero(options.quality, 40, 100, DEFAULT_OPTIONS.quality),
      mozjpeg: true,
      chromaSubsampling: '4:4:4'
    })
    .toBuffer({ resolveWithObject: true });

  const quadNormalizado = normalizarQuadSalida(quad, dimensiones.width, dimensiones.height);

  return {
    buffer: data,
    mimetype: 'image/jpeg',
    extension: 'jpg',
    procesada: true,
    width: info.width,
    height: info.height,
    originalWidth: dimensiones.width,
    originalHeight: dimensiones.height,
    crop: quadNormalizado
      ? {
          tipo: metodo,
          quad: quadNormalizado
        }
      : analisis?.box
        ? {
            tipo: 'rectangulo',
            box: analisis.box
          }
        : null,
    quad: quadNormalizado,
    metodo,
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
      originalWidth: null,
      originalHeight: null,
      crop: null,
      quad: null,
      metodo: 'completo',
      scanMode: normalizarScanMode(opts.scanMode, DEFAULT_OPTIONS.scanMode),
      error: error.message || 'No se pudo procesar la imagen del acta.'
    };
  }
}

module.exports = {
  DEFAULT_OPTIONS,
  LIMITE_PIXELES_ENTRADA,
  procesarImagenActa,
  procesarImagenActaSeguro,
  detectarDocumento,
  analizarDocumento,
  detectarCajaDocumento,
  normalizarQuadEntrada,
  normalizarScanMode,
  resolverCrop,
  warpPerspectiva,
  areaQuad
};

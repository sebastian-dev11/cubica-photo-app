const crypto = require('crypto');

let avisoSecretoCompartido = false;
let avisoBasePublicaEmitido = false;

function obtenerSecretoVistaPrevia() {
  const secretoEspecifico = process.env.PDF_PREVIEW_SECRET;

  if (secretoEspecifico) return secretoEspecifico;

  const secretoCompartido = process.env.JWT_SECRET || process.env.TOKEN_SECRET || '';

  if (secretoCompartido && !avisoSecretoCompartido) {
    console.warn(
      'PDF_PREVIEW_SECRET no configurado; se reutiliza un secreto existente para firmar vistas previas.'
    );
    avisoSecretoCompartido = true;
  }

  return secretoCompartido;
}

function crearTokenVistaPrevia(informeId, nombreArchivo) {
  const secret = obtenerSecretoVistaPrevia();

  if (!secret) {
    throw new Error('Falta configurar la clave para firmar la vista previa del PDF.');
  }

  const payload = Buffer.from(JSON.stringify({
    id: String(informeId),
    filename: nombreArchivo
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
    const payload = JSON.parse(
      Buffer.from(payloadCodificado, 'base64url').toString('utf8')
    );

    if (
      typeof payload.id !== 'string' ||
      typeof payload.filename !== 'string' ||
      !payload.filename.toLowerCase().endsWith('.pdf')
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function construirUrlVistaPrevia(req, token) {
  const configurada = String(process.env.PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

  if (/^https?:\/\/[^/]+$/i.test(configurada)) {
    return `${configurada}/pdf-preview/${token}`;
  }

  if (!avisoBasePublicaEmitido) {
    console.warn(
      'PUBLIC_BASE_URL no configurado; las URLs de vista previa se derivarán del Host de la petición.'
    );
    avisoBasePublicaEmitido = true;
  }

  const protocolo = String(req.get('x-forwarded-proto') || req.protocol)
    .split(',')[0]
    .trim()
    .toLowerCase();
  const host = String(req.get('host') || '').trim();

  if (
    !['http', 'https'].includes(protocolo) ||
    !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)
  ) {
    throw new Error('No se pudo construir una URL pública segura para la vista previa.');
  }

  return `${protocolo}://${host}/pdf-preview/${token}`;
}

function construirNombreArchivoDescarga(numeroIncidencia, tiendaNombre) {
  const incidencia = typeof numeroIncidencia === 'string'
    ? numeroIncidencia.replace(/\s+/g, ' ').trim()
    : '';
  const tienda = typeof tiendaNombre === 'string'
    ? tiendaNombre.replace(/\s+/g, ' ').trim()
    : '';

  return `INFORME TÉCNICO-${incidencia || 'SIN INCIDENCIA'}-${tienda || 'SIN TIENDA'}`
    .toLocaleUpperCase('es-CO')
    .replace(/[\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
}

module.exports = {
  construirNombreArchivoDescarga,
  construirUrlVistaPrevia,
  crearTokenVistaPrevia,
  verificarTokenVistaPrevia
};

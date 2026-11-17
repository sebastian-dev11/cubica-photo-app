function limpiarTexto(valor) {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
}

function textoBusqueda(valor, maximo = 100) {
  const texto = limpiarTexto(valor);
  return texto.slice(0, Math.max(1, maximo));
}

function escaparRegex(valor) {
  return String(valor ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function esSesionIdValido(valor) {
  return (
    typeof valor === 'string' &&
    /^[A-Za-z0-9_-]{8,128}$/.test(valor)
  );
}

function esUrlCloudinarySegura(valor) {
  try {
    const url = new URL(valor);

    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'res.cloudinary.com' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    ) {
      return false;
    }

    // Solo rutas de entrega conocidas: /<cloud>/(image|raw|video)/upload/...
    return /^\/[^/]+\/(?:image|raw|video)\/upload\//i.test(url.pathname);
  } catch {
    return false;
  }
}

module.exports = {
  limpiarTexto,
  textoBusqueda,
  escaparRegex,
  esSesionIdValido,
  esUrlCloudinarySegura
};

require('dotenv').config();
const express = require('express');
const mongoose = require('./db');
const cors = require('cors');

require('./models/UsuarioUnico');
require('./models/informe');
require('./models/informeVersion');
require('./models/sesion');
require('./models/actaDocumento');

const authRoutes = require('./routes/auth');
const imagenRoutes = require('./routes/imagenes');
const pdfRoutes = require('./routes/pdf');
const actaRoutes = require('./routes/acta').router;
const tiendasRoutes = require('./routes/tiendas');
const informesRoutes = require('./routes/informes');
const usuariosRoutes = require('./routes/usuarios');
const authRequired = require('./middleware/authRequired');

const app = express();

function normalizarOrigen(valor) {
  const origen = String(valor || '').trim().replace(/\/+$/, '');

  return origen && /^https?:\/\/[^/]+$/i.test(origen) ? origen : '';
}

function obtenerOrigenesPermitidos() {
  const valores = [
    process.env.CORS_ORIGINS,
    process.env.FRONTEND_URL
  ].filter(
    (valor) => typeof valor === 'string' && valor.trim() !== ''
  );

  const origenes = new Set();

  for (const valor of valores) {
    for (const candidato of valor.split(',')) {
      const texto = candidato.trim();

      if (!texto) continue;

      const origen = normalizarOrigen(texto);

      if (!origen) {
        throw new Error(
          'CORS_ORIGINS/FRONTEND_URL contiene un origen inválido; se requiere http(s)://host[:puerto].'
        );
      }

      origenes.add(origen);
    }
  }

  return origenes;
}

const origenesPermitidos = obtenerOrigenesPermitidos();

const trustProxy = process.env.TRUST_PROXY;
const proxyConfiable = Boolean(trustProxy);

if (trustProxy) {
  const valor = trustProxy === 'true' ? 1 : Number(trustProxy);
  app.set('trust proxy', Number.isFinite(valor) ? valor : false);
} else {
  console.warn(
    'TRUST_PROXY no configurado; el throttle de login usará la IP del socket y HSTS no se derivará de X-Forwarded-Proto.'
  );
}

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const protocolo = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();

  if (req.secure || (proxyConfiable && protocolo === 'https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  return next();
});

const corsOptions = {
  origin(origin, callback) {
    // Clientes móviles, curl o peticiones same-origin no envían Origin.
    if (!origin) {
      return callback(null, true);
    }

    if (origenesPermitidos.size === 0) {
      return callback(null, true);
    }

    return callback(null, origenesPermitidos.has(normalizarOrigen(origin)));
  },
  optionsSuccessStatus: 204,
  exposedHeaders: [
    'X-Acta-Escaneada',
    'X-Acta-Modo',
    'X-Acta-Metodo',
    'X-Acta-Width',
    'X-Acta-Height',
    'Content-Disposition'
  ]
};

if (origenesPermitidos.size === 0) {
  console.warn(
    'CORS: FRONTEND_URL/CORS_ORIGINS no configurados; se permite cualquier origen. Configura CORS_ORIGINS en producción.'
  );
}

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/auth', authRoutes);
app.use('/login', authRoutes);
app.use('/crear', authRoutes);

app.use('/imagenes', authRequired, imagenRoutes);

if (pdfRoutes.previewRouter) {
  app.use('/pdf-preview', pdfRoutes.previewRouter);
}

app.use('/pdf', authRequired, pdfRoutes);
app.use('/acta', authRequired, actaRoutes);
app.use('/informes', authRequired, informesRoutes);
app.use('/tiendas', authRequired, tiendasRoutes);
app.use('/usuarios', usuariosRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Recurso no encontrado'
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const status = Number(err?.status || err?.statusCode) || 500;

  if (status >= 500) {
    console.error('Error no controlado:', err?.message || err);

    return res.status(500).json({
      error: 'Error interno del servidor'
    });
  }

  return res.status(status).json({
    error: status === 413 ? 'Solicitud demasiado grande' : 'Solicitud inválida'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

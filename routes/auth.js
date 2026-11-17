const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UsuarioUnico = require('../models/UsuarioUnico');
const Sesion = require('../models/sesion');
const bcrypt = require('bcryptjs');
const authRequired = require('../middleware/authRequired');

const ALGORITMO_JWT = 'HS256';
const MAX_INTENTOS_LOGIN = Math.max(
  3,
  Number(process.env.LOGIN_MAX_ATTEMPTS) || 20
);
const VENTANA_INTENTOS_MS = Math.max(
  60 * 1000,
  Number(process.env.LOGIN_WINDOW_MS) || 15 * 60 * 1000
);

const intentosLogin = new Map();
const HASH_FICTICIO = bcrypt.hashSync('usuario-inexistente', 10);

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    const err = new Error('JWT_SECRET no configurado');
    err.status = 500;
    throw err;
  }

  return secret;
}

function getExpiresIn() {
  return process.env.JWT_EXPIRES_IN || '8h';
}

function crearToken(usuarioEncontrado, isAdmin, sesionId) {
  const payload = {
    userId: usuarioEncontrado._id.toString(),
    usuario: usuarioEncontrado.usuario,
    nombre: usuarioEncontrado.nombre || 'Tecnico',
    rol: usuarioEncontrado.rol || 'tecnico',
    isAdmin,
    sesionId
  };

  return jwt.sign(payload, getJwtSecret(), {
    algorithm: ALGORITMO_JWT,
    expiresIn: getExpiresIn()
  });
}

function calcularExpiracion() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function claveIntento(req, usuario) {
  const ip = req.ip || req.socket?.remoteAddress || 'sin-ip';
  const nombre = String(usuario || '')
    .trim()
    .toLowerCase()
    .slice(0, 100);

  return `${ip}|${nombre}`;
}

function limpiarIntentosExpirados() {
  const ahora = Date.now();

  for (const [clave, estado] of intentosLogin) {
    if (estado.expiraEn <= ahora) {
      intentosLogin.delete(clave);
    }
  }
}

setInterval(limpiarIntentosExpirados, VENTANA_INTENTOS_MS).unref();

function loginRateLimit(req, res, next) {
  limpiarIntentosExpirados();

  const clave = claveIntento(req, req.body?.usuario);
  const estado = intentosLogin.get(clave);
  const ahora = Date.now();

  if (
    estado &&
    estado.expiraEn > ahora &&
    estado.intentos >= MAX_INTENTOS_LOGIN
  ) {
    const segundos = Math.max(
      1,
      Math.ceil((estado.expiraEn - ahora) / 1000)
    );

    res.set('Retry-After', String(segundos));

    return res.status(429).json({
      mensaje: 'Demasiados intentos. Intenta de nuevo más tarde.'
    });
  }

  req.loginIntentKey = clave;

  return next();
}

function registrarIntentoFallido(req) {
  const clave =
    req.loginIntentKey ||
    claveIntento(req, req.body?.usuario);
  const ahora = Date.now();
  const estado = intentosLogin.get(clave);

  if (!estado || estado.expiraEn <= ahora) {
    intentosLogin.set(clave, {
      intentos: 1,
      expiraEn: ahora + VENTANA_INTENTOS_MS
    });

    return;
  }

  estado.intentos += 1;
}

function limpiarIntentosDe(req) {
  if (req.loginIntentKey) {
    intentosLogin.delete(req.loginIntentKey);
  }
}

router.post('/login', loginRateLimit, async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    if (!usuario || !contraseña) {
      return res.status(400).json({
        mensaje: 'Usuario y contraseña son obligatorios'
      });
    }

    const usuarioNormalizado = String(usuario).trim();

    const usuarioEncontrado = await UsuarioUnico.findOne({
      usuario: usuarioNormalizado
    });

    // Comparación ficticia para reducir diferencias de tiempo entre un
    // usuario inexistente y una contraseña incorrecta.
    if (!usuarioEncontrado) {
      await bcrypt.compare(String(contraseña), HASH_FICTICIO);
      registrarIntentoFallido(req);

      return res.status(401).json({
        mensaje: 'Credenciales incorrectas'
      });
    }

    const coincide = await bcrypt.compare(
      String(contraseña),
      usuarioEncontrado.contraseña
    );

    if (!coincide) {
      registrarIntentoFallido(req);

      return res.status(401).json({
        mensaje: 'Credenciales incorrectas'
      });
    }

    if (usuarioEncontrado.activo === false) {
      // No se distingue el estado de la cuenta para evitar enumeración.
      registrarIntentoFallido(req);

      return res.status(401).json({
        mensaje: 'Credenciales incorrectas'
      });
    }

    limpiarIntentosDe(req);

    const isAdmin =
      usuarioEncontrado.rol === 'admin' ||
      usuarioEncontrado.usuario === 'admin';
    const sesionId = crypto.randomUUID();

    await Sesion.create({
      sesionId,
      usuarioId: usuarioEncontrado._id,
      isAdmin,
      activa: true,
      ultimaActividad: new Date(),
      expiraEn: calcularExpiracion()
    });

    const token = crearToken(usuarioEncontrado, isAdmin, sesionId);

    res.set('Cache-Control', 'no-store');

    return res.json({
      mensaje: 'Acceso concedido',
      token,
      sesionId,
      nombre: usuarioEncontrado.nombre || 'Tecnico',
      userId: usuarioEncontrado._id.toString(),
      usuario: usuarioEncontrado.usuario,
      rol: usuarioEncontrado.rol || 'tecnico',
      isAdmin
    });
  } catch (err) {
    console.error('Error en login:', err?.message || err);

    return res.status(err.status || 500).json({
      mensaje: err.status ? err.message : 'Error en el servidor'
    });
  }
});

router.post('/logout', authRequired, async (req, res) => {
  try {
    await Sesion.updateOne(
      {
        sesionId: req.auth.sesionId,
        usuarioId: req.auth.userId
      },
      {
        $set: {
          activa: false,
          ultimaActividad: new Date()
        }
      }
    );

    return res.json({
      ok: true,
      mensaje: 'Sesión cerrada correctamente'
    });
  } catch (err) {
    console.error('Error en logout:', err?.message || err);

    return res.status(500).json({
      error: 'No se pudo cerrar la sesión'
    });
  }
});

module.exports = router;

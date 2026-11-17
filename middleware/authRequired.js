const jwt = require('jsonwebtoken');
const Sesion = require('../models/sesion');
const UsuarioUnico = require('../models/UsuarioUnico');
const { esSesionIdValido } = require('../utils/validaciones');

const ALGORITMO_JWT = 'HS256';

function getToken(req) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice(7).trim();
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    const err = new Error('JWT_SECRET no configurado');
    err.status = 500;
    throw err;
  }

  return secret;
}

module.exports = async function authRequired(req, res, next) {
  try {
    const token = getToken(req);

    if (!token) {
      return res.status(401).json({
        error: 'Token no enviado'
      });
    }

    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: [ALGORITMO_JWT]
    });

    if (
      !payload?.userId ||
      !payload?.sesionId ||
      typeof payload.userId !== 'string' ||
      !esSesionIdValido(payload.sesionId) ||
      !/^[a-f\d]{24}$/i.test(payload.userId)
    ) {
      return res.status(401).json({
        error: 'Token inválido'
      });
    }

    const sesion = await Sesion.findOne({
      sesionId: payload.sesionId,
      usuarioId: payload.userId
    }).lean();

    if (!sesion) {
      return res.status(401).json({
        error: 'Sesión no encontrada'
      });
    }

    if (sesion.activa === false) {
      return res.status(401).json({
        error: 'Sesión inactiva'
      });
    }

    if (sesion.expiraEn && new Date(sesion.expiraEn).getTime() < Date.now()) {
      return res.status(401).json({
        error: 'Sesión expirada'
      });
    }

    const usuario = await UsuarioUnico.findById(payload.userId)
      .select('-contraseña')
      .lean();

    if (!usuario) {
      return res.status(401).json({
        error: 'Usuario no encontrado'
      });
    }

    if (usuario.activo === false) {
      return res.status(403).json({
        error: 'Usuario inactivo'
      });
    }

    await Sesion.updateOne(
      { _id: sesion._id },
      { $set: { ultimaActividad: new Date() } }
    );

    // El rol se toma del estado actual en base de datos, no del token ni de
    // la sesión, para que una degradación de privilegios sea inmediata.
    const isAdmin =
      usuario.rol === 'admin' ||
      usuario.usuario === 'admin';

    res.set('Cache-Control', 'no-store');

    req.auth = {
      userId: usuario._id.toString(),
      usuario: usuario.usuario,
      nombre: usuario.nombre || 'Tecnico',
      rol: usuario.rol || 'tecnico',
      isAdmin,
      sesionId: payload.sesionId
    };

    req.user = usuario;
    req.userId = usuario._id.toString();
    req.sesionId = payload.sesionId;
    req.isAdmin = isAdmin;

    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expirado'
      });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token inválido'
      });
    }

    console.error('authRequired error:', err?.message || err);

    return res.status(err.status || 500).json({
      error: err.status ? err.message : 'Error de autenticación'
    });
  }
};

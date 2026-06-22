const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UsuarioUnico = require('../models/UsuarioUnico');
const Sesion = require('../models/sesion');
const bcrypt = require('bcryptjs');

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
    expiresIn: getExpiresIn()
  });
}

function calcularExpiracion() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

router.post('/login', async (req, res) => {
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

    if (!usuarioEncontrado) {
      return res.status(404).json({
        mensaje: 'Usuario no encontrado'
      });
    }

    if (usuarioEncontrado.activo === false) {
      return res.status(403).json({
        mensaje: 'Usuario inactivo. Contacte al administrador'
      });
    }

    const coincide = await bcrypt.compare(
      String(contraseña),
      usuarioEncontrado.contraseña
    );

    if (!coincide) {
      return res.status(401).json({
        mensaje: 'Credenciales incorrectas'
      });
    }

    const isAdmin = usuarioEncontrado.rol === 'admin' || usuarioEncontrado.usuario === 'admin';
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
    console.error('Error en login:', err);

    return res.status(err.status || 500).json({
      mensaje: err.status ? err.message : 'Error en el servidor'
    });
  }
});

module.exports = router;
// routes/auth.js
const express = require('express');
const router = express.Router();
const UsuarioUnico = require('../models/UsuarioUnico');
const Sesion = require('../models/sesion'); 
const bcrypt = require('bcryptjs');

router.post('/login', async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    // Buscar usuario por cédula o 'admin'
    const usuarioEncontrado = await UsuarioUnico.findOne({ usuario }).lean();
    if (!usuarioEncontrado) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    // Comparar contraseñas con bcrypt
    const coincide = await bcrypt.compare(contraseña, usuarioEncontrado.contraseña);
    if (!coincide) {
      return res.status(401).json({ mensaje: 'Credenciales incorrectas' });
    }

    // Flag de admin: usuario literal "admin"
    const isAdmin = usuarioEncontrado.usuario === 'admin';

    // Upsert de la sesión (se persiste isAdmin para validar en rutas protegidas)
    await Sesion.findOneAndUpdate(
      { sesionId: usuario },                         // cédula o 'admin' usada en el login
      { usuarioId: usuarioEncontrado._id, isAdmin }, // referencia al UsuarioUnico + flag admin
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Respuesta con nombre, userId e isAdmin
    return res.json({
      mensaje: 'Acceso concedido',
      nombre: usuarioEncontrado.nombre || 'Técnico',
      userId: usuarioEncontrado._id.toString(),
      isAdmin
    });

  } catch (err) {
    console.error('Error en login:', err);
    return res.status(500).json({ mensaje: 'Error en el servidor' });
  }
});

module.exports = router;

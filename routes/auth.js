const express = require('express');
const router = express.Router();
const UsuarioUnico = require('../models/UsuarioUnico');
const bcrypt = require('bcryptjs');

router.post('/login', async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    // Buscar usuario por cédula o 'admin'
    const usuarioEncontrado = await UsuarioUnico.findOne({ usuario });

    if (!usuarioEncontrado) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    // Comparar contraseñas con bcrypt
    const coincide = await bcrypt.compare(contraseña, usuarioEncontrado.contraseña);
    if (!coincide) {
      return res.status(401).json({ mensaje: 'Credenciales incorrectas' });
    }

    // Respuesta con nombre y mensaje en JSON
    return res.json({
      mensaje: 'Acceso concedido',
      nombre: usuarioEncontrado.nombre
    });

  } catch (err) {
    console.error('Error en login:', err);
    return res.status(500).json({ mensaje: 'Error en el servidor' });
  }
});

module.exports = router;

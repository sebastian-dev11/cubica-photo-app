const express = require('express');
const router = express.Router();
const UsuarioUnico = require('../models/UsuarioUnico');
const bcrypt = require('bcryptjs');

router.post('/login', async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    // Buscar usuario por nombre de usuario (cedula o 'admin')
    const usuarioEncontrado = await UsuarioUnico.findOne({ usuario });

    if (!usuarioEncontrado) {
      return res.status(404).send('Usuario no encontrado');
    }

    // Comparar contraseñas con bcrypt
    const coincide = await bcrypt.compare(contraseña, usuarioEncontrado.contraseña);
    if (!coincide) {
      return res.status(401).send('Credenciales incorrectas');
    }

    // ✅ Respuesta con nombre y mensaje
    res.json({
      mensaje: '✅ Acceso concedido',
      nombre: usuarioEncontrado.nombre
    });

    // Acceso concedido
    res.send('Acceso concedido');
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).send('Error en el servidor');
  }
});

module.exports = router;

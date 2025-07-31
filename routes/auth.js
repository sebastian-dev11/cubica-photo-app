const express = require('express');
const router = express.Router();
const UsuarioUnico = require('../models/UsuarioUnico');
console.log('Tipo de UsuarioUnico:', typeof UsuarioUnico); // debe ser 'function'

// 🟢 Ruta para login
router.post('/login', async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    const usuarioUnico = await UsuarioUnico.findOne();

    if (!usuarioUnico) {
      return res.status(404).send('Usuario único no configurado');
    }

    if (usuario === usuarioUnico.usuario && contraseña === usuarioUnico.contraseña) {
      res.send('✅ Acceso concedido');
    } else {
      res.status(401).send('❌ Credenciales incorrectas');
    }
  } catch (err) {
    res.status(500).send('Error en el servidor');
  }
});

// 🟡 Ruta temporal para crear el usuario único
router.post('/crear', async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    const existente = await UsuarioUnico.findOne();
    if (existente) {
      return res.status(400).json({ mensaje: 'Ya existe un usuario único' });
    }

    const nuevoUsuario = new UsuarioUnico({ usuario, contraseña });
    await nuevoUsuario.save();
    res.status(201).json({ mensaje: 'Usuario único creado exitosamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al crear el usuario' });
  }
});

module.exports = router;

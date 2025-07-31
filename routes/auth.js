const express = require('express');
const router = express.Router();
const UsuarioUnico = require('../models/UsuarioUnico');

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

module.exports = router;

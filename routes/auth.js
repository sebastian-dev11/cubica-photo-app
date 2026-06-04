const express = require('express');
const router = express.Router();
const UsuarioUnico = require('../models/UsuarioUnico');
const Sesion = require('../models/sesion'); 
const bcrypt = require('bcryptjs');

router.post('/login', async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
  
    const usuarioEncontrado = await UsuarioUnico.findOne({ usuario }).lean();
    if (!usuarioEncontrado) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }
    const coincide = await bcrypt.compare(contraseña, usuarioEncontrado.contraseña);
    if (!coincide) {
      return res.status(401).json({ mensaje: 'Credenciales incorrectas' });
    }

    
    const isAdmin = usuarioEncontrado.usuario === 'admin';
    await Sesion.findOneAndUpdate(
      { sesionId: usuario },                         
      { usuarioId: usuarioEncontrado._id, isAdmin }, 
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
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

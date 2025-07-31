const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  usuario: { type: String, required: true },
  contraseña: { type: String, required: true }
});

module.exports = mongoose.model('UsuarioUnico', usuarioSchema);


const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  
  usuario: { type: String, required: true, trim: true, unique: true, index: true },
  contraseña: { type: String, required: true },
  nombre: { type: String, trim: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('UsuarioUnico', usuarioSchema);

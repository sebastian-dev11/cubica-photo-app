const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  // cédula o "admin"
  usuario: { type: String, required: true, trim: true, unique: true, index: true },
  // hash bcrypt
  contraseña: { type: String, required: true },
  // nombre del técnico (no lo hago required para no romper datos existentes)
  nombre: { type: String, trim: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('UsuarioUnico', usuarioSchema);

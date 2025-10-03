const mongoose = require('mongoose');

const sesionSchema = new mongoose.Schema({
  sesionId: { type: String, required: true, unique: true },
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'UsuarioUnico', required: true },
  fechaInicio: { type: Date, default: Date.now }
});

module.exports = mongoose.model('sesion', sesionSchema);
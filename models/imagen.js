const mongoose = require('mongoose');

const imagenSchema = new mongoose.Schema({
  nombreOriginal: { type: String, required: true }, // Normalizado
  nombreArchivoOriginal: { type: String, required: true }, // Nombre real del archivo
  url: { type: String, required: true },
  fechaSubida: { type: Date, default: Date.now },
  sesionId: { type: String, required: true },
  tipo: { type: String, enum: ['previa', 'posterior'], required: true }
});

module.exports = mongoose.model('Imagen', imagenSchema);
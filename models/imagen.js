const mongoose = require('mongoose');

const imagenSchema = new mongoose.Schema({
  nombreOriginal: { type: String, required: true }, 
  nombreArchivoOriginal: { type: String, required: true }, 
  url: { type: String, required: true },
  fechaSubida: { type: Date, default: Date.now },
  sesionId: { type: String, required: true },
  tipo: { type: String, enum: ['previa', 'posterior'], required: true },
  ubicacion: { type: String, required: true }, 
  observacion: { type: String, default: '' } 
});

module.exports = mongoose.model('Imagen', imagenSchema);

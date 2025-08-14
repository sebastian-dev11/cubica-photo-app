// models/informe.js
const mongoose = require('mongoose');

const informeSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  // Importante: el ref debe coincidir EXACTAMENTE con el nombre del modelo de usuario
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'UsuarioUnico' },
  url: { type: String, required: true }, // URL Cloudinary
  publicId: { type: String },            // para borrado futuro
  mimeType: { type: String, default: 'application/pdf' },
  includesActa: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Índices para mejorar rendimiento de consultas y paginación
informeSchema.index({ createdAt: -1 });
informeSchema.index({ generatedBy: 1, createdAt: -1 });

module.exports = mongoose.model('Informe', informeSchema);
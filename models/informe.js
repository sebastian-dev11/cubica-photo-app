const mongoose = require('mongoose');

const informeSchema = new mongoose.Schema({
  // Título del informe
  title: { type: String, required: true, trim: true },

  // Usuario que generó el informe
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'UsuarioUnico' },

  // URL del PDF en Cloudinary
  url: { type: String, required: true },

  // Public ID para borrado futuro
  publicId: { type: String },

  // Tipo de archivo
  mimeType: { type: String, default: 'application/pdf' },

  // Indica si incluye acta
  includesActa: { type: Boolean, default: false },

  // Número de incidencia
  numeroIncidencia: { type: String, trim: true, default: '' },

  // Fecha de creación
  createdAt: { type: Date, default: Date.now }
});

// Índices para mejorar rendimiento de consultas y paginación
informeSchema.index({ createdAt: -1 });
informeSchema.index({ generatedBy: 1, createdAt: -1 });
informeSchema.index({ numeroIncidencia: 1, createdAt: -1 });

module.exports = mongoose.model('Informe', informeSchema);

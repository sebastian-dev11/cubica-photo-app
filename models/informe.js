// models/informe.js
const mongoose = require('mongoose');

const informeSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  url: { type: String, required: true }, // URL Cloudinary
  publicId: { type: String },            // para borrado futuro
  mimeType: { type: String, default: 'application/pdf' },
  includesActa: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Índices útiles para consultas rápidas
informeSchema.index({ createdAt: -1 });
informeSchema.index({ generatedBy: 1, createdAt: -1 });

module.exports = mongoose.model('Informe', informeSchema);

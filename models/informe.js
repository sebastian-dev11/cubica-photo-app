const mongoose = require('mongoose');

const informeSchema = new mongoose.Schema({
  
  title: { type: String, required: true, trim: true },

  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'UsuarioUnico' },
  url: { type: String, required: true },
  publicId: { type: String },
  mimeType: { type: String, default: 'application/pdf' },
  includesActa: { type: Boolean, default: false },
  numeroIncidencia: { type: String, trim: true, default: '' },
  regional: { type: String, default: 'OTRA' },
  createdAt: { type: Date, default: Date.now }
});


informeSchema.index({ createdAt: -1 });
informeSchema.index({ generatedBy: 1, createdAt: -1 });
informeSchema.index({ numeroIncidencia: 1, createdAt: -1 });

module.exports = mongoose.model('Informe', informeSchema);
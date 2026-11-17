const mongoose = require('mongoose');

const actaPdfSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    public_id: { type: String, required: true },
    nombre: { type: String, default: '' },
    mimetype: { type: String, default: 'application/pdf' },
    size: { type: Number, default: null },
    subidaEn: { type: Date, default: Date.now }
  },
  { _id: false }
);

const imagenActaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    public_id: { type: String, required: true },
    nombre: { type: String, default: '' },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    escaneada: { type: Boolean, default: false },
    scanMode: { type: String, default: 'clean' },
    crop: { type: mongoose.Schema.Types.Mixed, default: null },
    quad: { type: mongoose.Schema.Types.Mixed, default: null },
    orden: { type: Number, default: 0 },
    creadaEn: { type: Date, default: Date.now }
  },
  { _id: false }
);

const actaDocumentoSchema = new mongoose.Schema(
  {
    sesionId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    usuarioId: { type: String, default: null },
    acta: { type: actaPdfSchema, default: null },
    imagenes: { type: [imagenActaSchema], default: [] }
  },
  {
    timestamps: true,
    minimize: false
  }
);

module.exports = mongoose.model('ActaDocumento', actaDocumentoSchema);

const mongoose = require('mongoose');

const sesionSchema = new mongoose.Schema(
  {
    sesionId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UsuarioUnico',
      required: true
    },
    isAdmin: {
      type: Boolean,
      default: false
    },
    activa: {
      type: Boolean,
      default: true
    },
    fechaInicio: {
      type: Date,
      default: Date.now
    },
    ultimaActividad: {
      type: Date,
      default: Date.now
    },
    expiraEn: {
      type: Date,
      default: () => new Date(Date.now() + 8 * 60 * 60 * 1000)
    }
  },
  {
    timestamps: true
  }
);

sesionSchema.index({ sesionId: 1 });
sesionSchema.index({ usuarioId: 1 });
sesionSchema.index({ expiraEn: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('sesion', sesionSchema);
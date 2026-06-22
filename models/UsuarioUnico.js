const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema(
  {
    usuario: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true
    },
    contraseña: {
      type: String,
      required: true
    },
    nombre: {
      type: String,
      trim: true,
      default: ''
    },
    activo: {
      type: Boolean,
      default: true
    },
    rol: {
      type: String,
      enum: ['admin', 'tecnico'],
      default: 'tecnico'
    }
  },
  {
    timestamps: true
  }
);

usuarioSchema.index({ activo: 1 });
usuarioSchema.index({ rol: 1 });

module.exports = mongoose.model('UsuarioUnico', usuarioSchema);
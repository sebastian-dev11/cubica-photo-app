const mongoose = require('../db');

const tiendaSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: true,
      trim: true
    },
    regional: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    departamento: {
      type: String,
      required: true,
      trim: true
    },
    ciudad: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    timestamps: true
  }
);

tiendaSchema.index({ regional: 1, ciudad: 1 });
tiendaSchema.index({ nombre: 1 });
tiendaSchema.index({ regional: 1, departamento: 1, ciudad: 1, nombre: 1 });
tiendaSchema.index(
  { nombre: 1, regional: 1, departamento: 1, ciudad: 1 },
  { unique: true }
);

module.exports = mongoose.model('Tienda', tiendaSchema);
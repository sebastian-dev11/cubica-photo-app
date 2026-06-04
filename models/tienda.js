const mongoose = require('../db');

const tiendaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  regional: { type: String, required: true },
  departamento: { type: String, required: true },
  ciudad: { type: String, required: true }
});


tiendaSchema.index({ regional: 1, ciudad: 1 });

module.exports = mongoose.model('Tienda', tiendaSchema);
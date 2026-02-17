const mongoose = require('../db');

const tiendaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  regional: { type: String, required: true }, // <--- Aquí entra el nuevo nivel de jerarquía
  departamento: { type: String, required: true },
  ciudad: { type: String, required: true }
});

// Índice para acelerar las búsquedas filtradas por regional y ciudad
tiendaSchema.index({ regional: 1, ciudad: 1 });

module.exports = mongoose.model('Tienda', tiendaSchema);
const mongoose = require('../db');

const tiendaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  departamento: { type: String, required: true },
  ciudad: { type: String, required: true }
});

module.exports = mongoose.model('Tienda', tiendaSchema);

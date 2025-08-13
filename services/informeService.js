// services/informes.js
const Informe = require('../models/informe');

/**
 * Crea un nuevo informe en la base de datos.
 * @param {Object} payload - Datos del informe.
 * @param {string} payload.title - Título del informe.
 * @param {string} payload.generatedBy - ID del usuario que lo generó.
 * @param {boolean} payload.includesActa - Si incluye acta.
 * @param {string} payload.url - URL del PDF en Cloudinary.
 * @param {string} [payload.cloudinaryPublicId] - ID público de Cloudinary.
 * @param {number} [payload.size] - Tamaño en bytes del PDF.
 * @param {number} [payload.pages] - Número de páginas.
 * @param {string} [payload.hash] - Hash único para control de duplicados.
 * @returns {Promise<Object>} Documento creado.
 */
async function create(payload) {
  // Validación básica
  if (!payload.title || !payload.generatedBy || !payload.url) {
    throw new Error('Faltan campos obligatorios: title, generatedBy o url.');
  }

  // Idempotencia opcional: evita duplicar si existe un registro igual
  if (payload.hash) {
    const existente = await Informe.findOne({
      hash: payload.hash,
      generatedBy: payload.generatedBy
    });
    if (existente) {
      return existente; // devolvemos el existente en lugar de crear uno nuevo
    }
  }

  const doc = await Informe.create(payload);
  return doc;
}

/**
 * Lista informes con paginación y filtros.
 * @param {Object} filtros - { page, limit, search, userId }
 */
async function list({ page = 1, limit = 10, search = '', userId }) {
  const query = {};

  if (search) {
    query.title = { $regex: search, $options: 'i' };
  }
  if (userId) {
    query.generatedBy = userId;
  }

  const total = await Informe.countDocuments(query);
  const data = await Informe.find(query)
    .populate('generatedBy', 'name email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return {
    total,
    page,
    totalPages: Math.ceil(total / limit),
    data
  };
}

module.exports = { create, list };
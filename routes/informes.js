// routes/informes.js
const express = require('express');
const router = express.Router();
const Informe = require('../models/informe');

/**
 * GET /informes
 * Permite:
 *  - Filtrar por título (search)
 *  - Filtrar por usuario (userId)
 *  - Paginación (page, limit)
 * Devuelve:
 *  - Total de registros
 *  - Página actual
 *  - Total de páginas
 *  - Array de informes con datos del usuario generador
 */
router.get('/', async (req, res) => {
  try {
    let { page = 1, limit = 10, search = '', userId } = req.query;
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const query = {};

    // Filtro por título
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    // Filtro por usuario específico
    if (userId) {
      query.generatedBy = userId;
    }

    // Total para la paginación
    const total = await Informe.countDocuments(query);

    // Consulta con populate al modelo UsuarioUnico
    const informes = await Informe.find(query)
      .populate('generatedBy', 'usuario nombre') // ajusta si tu modelo no tiene 'nombre'
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: informes
    });

  } catch (err) {
    console.error('Error obteniendo informes:', err);
    res.status(500).json({ error: 'Error al obtener informes' });
  }
});

module.exports = router;
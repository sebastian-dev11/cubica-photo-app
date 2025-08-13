const express = require('express');
const router = express.Router();
const Informe = require('../models/informe');

/**
 * GET /informes
 * Parámetros de consulta:
 *   - page: número de página (por defecto 1)
 *   - limit: cantidad de resultados por página (por defecto 10)
 *   - search: texto a buscar en el título
 *   - userId: filtrar por ID de usuario que generó el informe
 */
router.get('/', async (req, res) => {
  try {
    let { page = 1, limit = 10, search = '', userId } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    const query = {};

    // Filtro por título si hay búsqueda
    if (search) {
      query.title = { $regex: search, $options: 'i' }; // insensible a mayúsculas
    }

    // Filtro por usuario si se pasa userId
    if (userId) {
      query.generatedBy = userId;
    }

    const total = await Informe.countDocuments(query);

    const informes = await Informe.find(query)
      .populate('generatedBy', 'name email') // opcional: trae info del usuario
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
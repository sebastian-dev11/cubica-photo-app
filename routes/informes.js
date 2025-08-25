// routes/informes.js
const express = require('express');
const router = express.Router();
const Informe = require('../models/informe');
const {
  eliminarInforme,
  eliminarInformesBulk,
} = require('../services/informeService');

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
      .populate('generatedBy', 'usuario nombre')
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

/**
 * POST /informes/bulk-delete
 * Elimina varios informes (opcional).
 * Body: { ids: [<id1>, <id2>, ...] }
 */
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Debe enviar un arreglo "ids" con al menos un id.' });
    }

    // Identidad del solicitante (preferir req.user si existe)
    const requesterUserId = req.user?._id?.toString() || req.query.userId || null;
    const requesterSesionId = req.user?.sesionId || req.query.sesionId || null;
    const isAdmin = Boolean(req.user && (req.user.role === 'admin' || req.user.isAdmin));

    const result = await eliminarInformesBulk({
      ids,
      requesterUserId,
      requesterSesionId,
      isAdmin,
    });

    res.json(result);
  } catch (err) {
    console.error('Error en bulk-delete informes:', err);
    res.status(err.status || 500).json({ error: err.message || 'Error al eliminar informes' });
  }
});

/**
 * DELETE /informes/:id
 * Elimina un informe y su archivo en Cloudinary (resource_type: 'raw').
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Identidad del solicitante (preferir req.user si existe)
    const requesterUserId = req.user?._id?.toString() || req.query.userId || null;
    const requesterSesionId = req.user?.sesionId || req.query.sesionId || null;
    const isAdmin = Boolean(req.user && (req.user.role === 'admin' || req.user.isAdmin));

    const data = await eliminarInforme({
      id,
      requesterUserId,
      requesterSesionId,
      isAdmin,
    });

    res.json({ ok: true, mensaje: 'Informe eliminado', ...data });
  } catch (err) {
    console.error('Error eliminando informe:', err);
    res.status(err.status || 500).json({ error: err.message || 'Error al eliminar informe' });
  }
});

module.exports = router;

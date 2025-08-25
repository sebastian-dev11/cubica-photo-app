// routes/informes.js
const express = require('express');
const router = express.Router();
const Informe = require('../models/informe');
const Sesion = require('../models/sesion'); // para verificar admin por sesionId
const UsuarioUnico = require('../models/UsuarioUnico'); // fallback por si no existiera Sesion.isAdmin
const {
  eliminarInforme,
  eliminarInformesBulk,
} = require('../services/informeService');

/**
 * Helper: determina si la solicitud es de un ADMIN
 * Fuente de verdad: Sesion.isAdmin (grabado en /login).
 * Fallback: usuario === 'admin' si por alguna razón no está isAdmin en la sesión.
 */
async function isAdminRequest(req) {
  const sesionId = req.query.sesionId || req.headers['x-sesion-id'];
  if (!sesionId) return false;

  const sesion = await Sesion.findOne({ sesionId }).lean();
  if (sesion?.isAdmin) return true;

  // Fallback por si no se guardó isAdmin en Sesion (compatibilidad)
  if (sesion?.usuarioId) {
    const user = await UsuarioUnico.findById(sesion.usuarioId).lean();
    if (user?.usuario === 'admin') return true;
  }
  return false;
}

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
 * Elimina varios informes (ADMIN ONLY).
 * Body: { ids: [<id1>, <id2>, ...] }
 * Requiere: ?sesionId=<cedula_admin> o header x-sesion-id
 */
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Debe enviar un arreglo "ids" con al menos un id.' });
    }

    // Check admin
    const admin = await isAdminRequest(req);
    if (!admin) {
      return res.status(403).json({ error: 'Solo admin puede eliminar informes.' });
    }

    const requesterSesionId = req.query.sesionId || req.headers['x-sesion-id'] || null;

    const result = await eliminarInformesBulk({
      ids,
      requesterUserId: null,      // no necesario al ser admin
      requesterSesionId,
      isAdmin: true,              // bypass de propiedad
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
 * ADMIN ONLY — puede borrar cualquiera.
 * Requiere: ?sesionId=<cedula_admin> o header x-sesion-id
 */
router.delete('/:id', async (req, res) => {
  try {
    // Check admin
    const admin = await isAdminRequest(req);
    if (!admin) {
      return res.status(403).json({ error: 'Solo admin puede eliminar informes.' });
    }

    const { id } = req.params;
    const requesterSesionId = req.query.sesionId || req.headers['x-sesion-id'] || null;

    const data = await eliminarInforme({
      id,
      requesterUserId: null,   // no necesario al ser admin
      requesterSesionId,
      isAdmin: true,           // bypass de propiedad
    });

    res.json({ ok: true, mensaje: 'Informe eliminado', ...data });
  } catch (err) {
    console.error('Error eliminando informe:', err);
    res.status(err.status || 500).json({ error: err.message || 'Error al eliminar informe' });
  }
});

module.exports = router;

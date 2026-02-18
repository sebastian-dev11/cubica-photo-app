const express = require('express');
const router = express.Router();
const Informe = require('../models/informe');
const Sesion = require('../models/sesion'); // para verificar admin por sesionId
const UsuarioUnico = require('../models/UsuarioUnico'); // fallback por si no existiera Sesion.isAdmin
const {
  eliminarInforme,
  eliminarInformesBulk,
} = require('../services/informeService');

/* =========================
   Helpers
========================= */

/** Determina si la solicitud es de un ADMIN (por sesionId en query o header). */
async function isAdminRequest(req) {
  const sesionId = req.query.sesionId || req.headers['x-sesion-id'];
  if (!sesionId) return false;

  const sesion = await Sesion.findOne({ sesionId }).lean();
  if (sesion?.isAdmin) return true;

  // Fallback: si no quedó isAdmin en Sesion, revisa usuario
  if (sesion?.usuarioId) {
    const user = await UsuarioUnico.findById(sesion.usuarioId).lean();
    if (user?.usuario === 'admin') return true;
  }
  return false;
}

/** Normaliza y limita la paginación */
function sanitizePagination(page, limit) {
  let p = parseInt(page, 10);
  let l = parseInt(limit, 10);
  if (!Number.isFinite(p) || p < 1) p = 1;
  if (!Number.isFinite(l) || l < 1) l = 10;
  // límite duro para proteger el backend
  if (l > 100) l = 100;
  return { page: p, limit: l };
}

/** Calcula un URL compartible a partir del doc de Informe */
function computeShareUrl(inf) {
  return (
    inf?.url ||
    inf?.secure_url ||
    inf?.cloudinary?.secure_url ||
    null
  );
}

/* =========================
   GET /informes  (listado)
========================= */
router.get('/', async (req, res) => {
  try {
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const { search = '', userId, from, to, regional = '', incidencia = '' } = req.query;

    const query = {};

    // Filtro por texto: title o ubicacion
    if (search) {
      const rx = new RegExp(search, 'i');
      query.$or = [{ title: rx }, { ubicacion: rx }];
    }

    if (regional) {
      query.regional = regional;
    }
    
    if (incidencia) {
      query.numeroIncidencia = { $regex: new RegExp(incidencia, 'i') };
    }

    // Filtro por usuario específico
    if (userId) {
      query.generatedBy = userId;
    }

    // Rango de fechas por createdAt
    if (from || to) {
      query.createdAt = {};
      if (from) {
        const d = new Date(from);
        if (!isNaN(d)) query.createdAt.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (!isNaN(d)) query.createdAt.$lt = d;
      }
      // si quedó vacío, elimínalo
      if (Object.keys(query.createdAt).length === 0) delete query.createdAt;
    }

    const total = await Informe.countDocuments(query);

    const informes = await Informe.find(query)
      .populate('generatedBy', 'usuario nombre')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Adjunta shareUrl siempre (para evitar “no viene la URL” en front)
    const data = (informes || []).map((inf) => ({
      ...inf,
      shareUrl: computeShareUrl(inf),
    }));

    res.set('Cache-Control', 'no-store');
    return res.json({
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data,
    });

  } catch (err) {
    console.error('Error obteniendo informes:', err);
    return res.status(500).json({ error: 'Error al obtener informes' });
  }
});

/* =========================================================
   GET /informes/:id  — Obtiene un informe por id (ADMIN)
========================================================= */
router.get('/:id', async (req, res) => {
  try {
    const admin = await isAdminRequest(req);
    if (!admin) {
      return res.status(403).json({ error: 'Solo admin puede ver informes por ID.' });
    }

    const { id } = req.params;
    const inf = await Informe.findById(id)
      .populate('generatedBy', 'usuario nombre')
      .lean();

    if (!inf) {
      return res.status(404).json({ error: 'Informe no encontrado' });
    }

    return res.json({
      ...inf,
      shareUrl: computeShareUrl(inf),
    });
  } catch (err) {
    console.error('Error consultando informe:', err);
    return res.status(500).json({ error: 'Error al consultar informe' });
  }
});

/* =======================================================================================
   GET /informes/ultimo-por-sesion?sesionId=XXXX
   Devuelve el último informe creado para esa sesión.
   - ADMIN: puede consultar cualquier sesionId.
   - No admin: solo puede consultar si el sesionId del query/header coincide con el pedido.
======================================================================================= */
router.get('/utils/ultimo-por-sesion', async (req, res) => {
  try {
    const targetSesionId = req.query.sesionId;
    if (!targetSesionId) {
      return res.status(400).json({ error: 'Debe enviar ?sesionId=...' });
    }

    // Permisos
    const admin = await isAdminRequest(req);
    if (!admin) {
      // Si no es admin, solo permitimos consultar su propia sesión
      const requester = req.query.sesionId || req.headers['x-sesion-id'];
      if (!requester || requester !== targetSesionId) {
        return res.status(403).json({ error: 'No autorizado para consultar esta sesión' });
      }
    }

    const inf = await Informe.findOne({ sesionId: targetSesionId })
      .sort({ createdAt: -1 })
      .lean();

    if (!inf) {
      return res.status(404).json({ error: 'No hay informes para esa sesión' });
    }

    return res.json({
      ...inf,
      shareUrl: computeShareUrl(inf),
    });
  } catch (err) {
    console.error('Error consultando último informe por sesión:', err);
    return res.status(500).json({ error: 'Error al consultar' });
  }
});

/* ==========================================
   POST /informes/bulk-delete  (ADMIN ONLY)
========================================== */
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Debe enviar un arreglo "ids" con al menos un id.' });
    }

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

    return res.json(result);
  } catch (err) {
    console.error('Error en bulk-delete informes:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Error al eliminar informes' });
  }
});

/* ===============================
   DELETE /informes/:id  (ADMIN)
=============================== */
router.delete('/:id', async (req, res) => {
  try {
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

    return res.json({ ok: true, mensaje: 'Informe eliminado', ...data });
  } catch (err) {
    console.error('Error eliminando informe:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Error al eliminar informe' });
  }
});

module.exports = router;
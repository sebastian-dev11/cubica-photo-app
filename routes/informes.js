const express = require('express');
const router = express.Router();
const Informe = require('../models/informe');
const Sesion = require('../models/sesion'); 
const UsuarioUnico = require('../models/UsuarioUnico');
const {
  editarInforme,
  eliminarInforme,
  eliminarInformesBulk,
} = require('../services/informeService');


async function isAdminRequest(req) {
  const sesionId = req.query.sesionId || req.headers['x-sesion-id'];
  if (!sesionId) return false;

  const sesion = await Sesion.findOne({ sesionId }).lean();
  if (sesion?.isAdmin) return true;
  if (sesion?.usuarioId) {
    const user = await UsuarioUnico.findById(sesion.usuarioId).lean();
    if (user?.usuario === 'admin') return true;
  }
  return false;
}

function sanitizePagination(page, limit) {
  let p = parseInt(page, 10);
  let l = parseInt(limit, 10);
  if (!Number.isFinite(p) || p < 1) p = 1;
  if (!Number.isFinite(l) || l < 1) l = 10;
  if (l > 100) l = 100;
  return { page: p, limit: l };
}


function computeShareUrl(inf) {
  return (
    inf?.url ||
    inf?.secure_url ||
    inf?.cloudinary?.secure_url ||
    null
  );
}

router.get('/', async (req, res) => {
  try {
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const { search = '', userId, from, to, regional = '', incidencia = '' } = req.query;

    const query = {};

  
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

  
    if (userId) {
      query.generatedBy = userId;
    }

    
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
    
      if (Object.keys(query.createdAt).length === 0) delete query.createdAt;
    }

    const total = await Informe.countDocuments(query);

    const informes = await Informe.find(query)
      .populate('generatedBy', 'usuario nombre')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    
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

router.get('/utils/ultimo-por-sesion', async (req, res) => {
  try {
    const targetSesionId = req.query.sesionId;
    if (!targetSesionId) {
      return res.status(400).json({ error: 'Debe enviar ?sesionId=...' });
    }

    
    const admin = await isAdminRequest(req);
    if (!admin) {
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
      requesterUserId: null,      
      isAdmin: true,              
    });

    return res.json(result);
  } catch (err) {
    console.error('Error en bulk-delete informes:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Error al eliminar informes' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const admin = await isAdminRequest(req);

    if (!admin) {
      return res.status(403).json({
        error: 'Solo admin puede editar informes.'
      });
    }

    const { id } = req.params;

    const informe = await Informe.findById(id);

    if (!informe) {
      return res.status(404).json({
        error: 'Informe no encontrado'
      });
    }

    const {
      title,
      numeroIncidencia,
      regional,
      includesActa
    } = req.body;

    
    if (typeof title === 'string') {
      informe.title = title.trim();
    }

    
    if (typeof numeroIncidencia === 'string') {
      informe.numeroIncidencia = numeroIncidencia.trim();
    }

    
    if (typeof regional === 'string') {
      informe.regional = regional.trim();
    }

    
    if (typeof includesActa === 'boolean') {
      informe.includesActa = includesActa;
    }

    await informe.save();

    return res.json({
      ok: true,
      mensaje: 'Informe actualizado correctamente',
      informe: {
        ...informe.toObject(),
        shareUrl: computeShareUrl(informe)
      }
    });

  } catch (err) {
    console.error('Error actualizando informe:', err);

    return res.status(500).json({
      error: 'Error al actualizar informe'
    });
  }
});

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
      requesterUserId: null,   
      requesterSesionId,
      isAdmin: true,           
    });

    return res.json({ ok: true, mensaje: 'Informe eliminado', ...data });
  } catch (err) {
    console.error('Error eliminando informe:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Error al eliminar informe' });
  }
});

module.exports = router;
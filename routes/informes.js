const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Informe = require('../models/informe');
const {
  editarInforme,
  eliminarInforme,
  eliminarInformesBulk
} = require('../services/informeService');

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

function getOwnerId(informe) {
  const generatedBy = informe?.generatedBy;

  if (!generatedBy) return null;

  if (typeof generatedBy === 'object' && generatedBy._id) {
    return generatedBy._id.toString();
  }

  return generatedBy.toString();
}

function esPropietario(informe, userId) {
  const ownerId = getOwnerId(informe);
  return Boolean(ownerId && userId && ownerId === userId);
}

function mapInforme(informe) {
  return {
    ...informe,
    shareUrl: computeShareUrl(informe)
  };
}

router.get('/', async (req, res) => {
  try {
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const {
      search = '',
      userId,
      from,
      to,
      regional = '',
      incidencia = ''
    } = req.query;

    const isAdmin = Boolean(req.auth?.isAdmin);
    const currentUserId = req.auth?.userId;

    const query = {};

    if (search) {
      const rx = new RegExp(search, 'i');
      query.$or = [
        { title: rx },
        { numeroIncidencia: rx },
        { regional: rx },
        { tiendaNombre: rx },
        { tiendaRegional: rx },
        { tiendaDepartamento: rx },
        { tiendaCiudad: rx }
      ];
    }

    if (regional) {
      query.regional = regional;
    }

    if (incidencia) {
      query.numeroIncidencia = { $regex: new RegExp(incidencia, 'i') };
    }

    if (isAdmin) {
      if (userId) {
        if (!mongoose.isValidObjectId(userId)) {
          return res.status(400).json({
            error: 'Id de usuario inválido'
          });
        }

        query.generatedBy = userId;
      }
    } else {
      query.generatedBy = currentUserId;
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

      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt;
      }
    }

    const total = await Informe.countDocuments(query);

    const informes = await Informe.find(query)
      .populate('generatedBy', 'usuario nombre')
      .populate('tiendaId', 'nombre regional departamento ciudad')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const data = informes.map(mapInforme);

    res.set('Cache-Control', 'no-store');

    return res.json({
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data
    });
  } catch (err) {
    console.error('Error obteniendo informes:', err);

    return res.status(500).json({
      error: 'Error al obtener informes'
    });
  }
});

router.get('/utils/ultimo-por-sesion', async (req, res) => {
  try {
    const targetSesionId = req.query.sesionId;

    if (!targetSesionId) {
      return res.status(400).json({
        error: 'Debe enviar ?sesionId=...'
      });
    }

    const isAdmin = Boolean(req.auth?.isAdmin);

    if (!isAdmin && targetSesionId !== req.auth?.sesionId) {
      return res.status(403).json({
        error: 'No autorizado para consultar esta sesión'
      });
    }

    const inf = await Informe.findOne({ sesionId: targetSesionId })
      .populate('generatedBy', 'usuario nombre')
      .populate('tiendaId', 'nombre regional departamento ciudad')
      .sort({ createdAt: -1 })
      .lean();

    if (!inf) {
      return res.status(404).json({
        error: 'No hay informes para esa sesión'
      });
    }

    if (!isAdmin && !esPropietario(inf, req.auth?.userId)) {
      return res.status(403).json({
        error: 'No autorizado para consultar este informe'
      });
    }

    return res.json(mapInforme(inf));
  } catch (err) {
    console.error('Error consultando último informe por sesión:', err);

    return res.status(500).json({
      error: 'Error al consultar'
    });
  }
});

router.get('/tienda/:tiendaId', async (req, res) => {
  try {
    const { tiendaId } = req.params;
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const {
      search = '',
      incidencia = '',
      from,
      to
    } = req.query;

    if (!mongoose.isValidObjectId(tiendaId)) {
      return res.status(400).json({
        error: 'Id de tienda inválido'
      });
    }

    const isAdmin = Boolean(req.auth?.isAdmin);
    const currentUserId = req.auth?.userId;

    const query = {
      tiendaId
    };

    if (!isAdmin) {
      query.generatedBy = currentUserId;
    }

    if (search) {
      const rx = new RegExp(search, 'i');
      query.$or = [
        { title: rx },
        { numeroIncidencia: rx },
        { regional: rx },
        { tiendaNombre: rx },
        { tiendaRegional: rx },
        { tiendaDepartamento: rx },
        { tiendaCiudad: rx }
      ];
    }

    if (incidencia) {
      query.numeroIncidencia = { $regex: new RegExp(incidencia, 'i') };
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

      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt;
      }
    }

    const total = await Informe.countDocuments(query);

    const informes = await Informe.find(query)
      .populate('generatedBy', 'usuario nombre')
      .populate('tiendaId', 'nombre regional departamento ciudad')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const data = informes.map(mapInforme);

    res.set('Cache-Control', 'no-store');

    return res.json({
      ok: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data
    });
  } catch (err) {
    console.error('Error obteniendo historial por tienda:', err);

    return res.status(500).json({
      error: 'Error al obtener historial por tienda'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        error: 'Id de informe inválido'
      });
    }

    const inf = await Informe.findById(id)
      .populate('generatedBy', 'usuario nombre')
      .populate('tiendaId', 'nombre regional departamento ciudad')
      .lean();

    if (!inf) {
      return res.status(404).json({
        error: 'Informe no encontrado'
      });
    }

    if (!req.auth?.isAdmin && !esPropietario(inf, req.auth?.userId)) {
      return res.status(403).json({
        error: 'No autorizado para consultar este informe'
      });
    }

    return res.json(mapInforme(inf));
  } catch (err) {
    console.error('Error consultando informe:', err);

    return res.status(500).json({
      error: 'Error al consultar informe'
    });
  }
});

router.post('/bulk-delete', async (req, res) => {
  try {
    if (!req.auth?.isAdmin) {
      return res.status(403).json({
        error: 'Solo admin puede eliminar informes.'
      });
    }

    const { ids } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'Debe enviar un arreglo "ids" con al menos un id.'
      });
    }

    const result = await eliminarInformesBulk({
      ids,
      requesterUserId: req.auth.userId,
      requesterSesionId: req.auth.sesionId,
      isAdmin: true
    });

    return res.json(result);
  } catch (err) {
    console.error('Error en bulk-delete informes:', err);

    return res.status(err.status || 500).json({
      error: err.message || 'Error al eliminar informes'
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!req.auth?.isAdmin) {
      return res.status(403).json({
        error: 'Solo admin puede editar informes.'
      });
    }

    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        error: 'Id de informe inválido'
      });
    }

    const {
      title,
      numeroIncidencia,
      regional,
      includesActa,
      tiendaId,
      geolocalizacion
    } = req.body;

    const informe = await editarInforme({
      id,
      title,
      numeroIncidencia,
      regional,
      includesActa,
      tiendaId,
      geolocalizacion
    });

    const informePlano = informe.toObject();

    return res.json({
      ok: true,
      mensaje: 'Informe actualizado correctamente',
      informe: mapInforme(informePlano)
    });
  } catch (err) {
    console.error('Error actualizando informe:', err);

    return res.status(err.status || 500).json({
      error: err.message || 'Error al actualizar informe'
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!req.auth?.isAdmin) {
      return res.status(403).json({
        error: 'Solo admin puede eliminar informes.'
      });
    }

    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        error: 'Id de informe inválido'
      });
    }

    const data = await eliminarInforme({
      id,
      requesterUserId: req.auth.userId,
      requesterSesionId: req.auth.sesionId,
      isAdmin: true
    });

    return res.json({
      ok: true,
      mensaje: 'Informe eliminado',
      ...data
    });
  } catch (err) {
    console.error('Error eliminando informe:', err);

    return res.status(err.status || 500).json({
      error: err.message || 'Error al eliminar informe'
    });
  }
});

module.exports = router;
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Tienda = require('../models/tienda');
const adminOnly = require('../middleware/adminOnly');

function limpiarTexto(valor) {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
}

function escaparRegex(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validarId(id) {
  return mongoose.isValidObjectId(id);
}

function mapTienda(tienda) {
  return {
    _id: tienda._id.toString(),
    nombre: tienda.nombre || '',
    regional: tienda.regional || '',
    departamento: tienda.departamento || '',
    ciudad: tienda.ciudad || '',
    createdAt: tienda.createdAt,
    updatedAt: tienda.updatedAt
  };
}

function crearFiltro({ regional, ciudad, departamento, search }) {
  const filtro = {};

  if (regional) {
    filtro.regional = regional;
  }

  if (ciudad) {
    filtro.ciudad = ciudad;
  }

  if (departamento) {
    filtro.departamento = departamento;
  }

  if (search) {
    const rx = new RegExp(escaparRegex(search), 'i');

    filtro.$or = [
      { nombre: rx },
      { regional: rx },
      { departamento: rx },
      { ciudad: rx }
    ];
  }

  return filtro;
}

function validarCamposTienda({ nombre, regional, departamento, ciudad }) {
  if (!nombre || !regional || !departamento || !ciudad) {
    const err = new Error('Nombre, regional, departamento y ciudad son obligatorios');
    err.status = 400;
    throw err;
  }
}

async function validarTiendaDuplicada({
  nombre,
  regional,
  departamento,
  ciudad,
  excludeId = null
}) {
  const filtro = {
    nombre: new RegExp(`^${escaparRegex(nombre)}$`, 'i'),
    regional: new RegExp(`^${escaparRegex(regional)}$`, 'i'),
    departamento: new RegExp(`^${escaparRegex(departamento)}$`, 'i'),
    ciudad: new RegExp(`^${escaparRegex(ciudad)}$`, 'i')
  };

  if (excludeId) {
    filtro._id = { $ne: excludeId };
  }

  const existente = await Tienda.findOne(filtro).lean();

  if (existente) {
    const err = new Error('Ya existe una tienda con esos datos');
    err.status = 400;
    throw err;
  }
}

router.get('/', async (req, res) => {
  try {
    const regional = limpiarTexto(req.query.regional);
    const ciudad = limpiarTexto(req.query.ciudad);
    const departamento = limpiarTexto(req.query.departamento);
    const search = limpiarTexto(req.query.search);

    const filtro = crearFiltro({
      regional,
      ciudad,
      departamento,
      search
    });

    const tiendas = await Tienda.find(filtro)
      .sort({ regional: 1, departamento: 1, ciudad: 1, nombre: 1 })
      .lean();

    return res.json({
      ok: true,
      total: tiendas.length,
      data: tiendas.map(mapTienda)
    });
  } catch (error) {
    console.error('Error al obtener tiendas:', error);

    return res.status(500).json({
      ok: false,
      message: 'Error al obtener tiendas'
    });
  }
});

router.get('/regionales', async (req, res) => {
  try {
    const regionales = await Tienda.distinct('regional');

    return res.json({
      ok: true,
      data: regionales.filter(Boolean).sort()
    });
  } catch (error) {
    console.error('Error al obtener regionales:', error);

    return res.status(500).json({
      ok: false,
      message: 'Error al obtener regionales'
    });
  }
});

router.get('/ciudades', async (req, res) => {
  try {
    const regional = limpiarTexto(req.query.regional);
    const filtro = regional ? { regional } : {};

    const ciudades = await Tienda.distinct('ciudad', filtro);

    return res.json({
      ok: true,
      data: ciudades.filter(Boolean).sort()
    });
  } catch (error) {
    console.error('Error al obtener ciudades:', error);

    return res.status(500).json({
      ok: false,
      message: 'Error al obtener ciudades'
    });
  }
});

router.get('/departamentos', async (req, res) => {
  try {
    const regional = limpiarTexto(req.query.regional);
    const ciudad = limpiarTexto(req.query.ciudad);
    const filtro = {};

    if (regional) {
      filtro.regional = regional;
    }

    if (ciudad) {
      filtro.ciudad = ciudad;
    }

    const departamentos = await Tienda.distinct('departamento', filtro);

    return res.json({
      ok: true,
      data: departamentos.filter(Boolean).sort()
    });
  } catch (error) {
    console.error('Error al obtener departamentos:', error);

    return res.status(500).json({
      ok: false,
      message: 'Error al obtener departamentos'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!validarId(id)) {
      return res.status(400).json({
        ok: false,
        message: 'Id de tienda inválido'
      });
    }

    const tienda = await Tienda.findById(id).lean();

    if (!tienda) {
      return res.status(404).json({
        ok: false,
        message: 'Tienda no encontrada'
      });
    }

    return res.json({
      ok: true,
      data: mapTienda(tienda)
    });
  } catch (error) {
    console.error('Error al obtener tienda:', error);

    return res.status(500).json({
      ok: false,
      message: 'Error al obtener tienda'
    });
  }
});

router.post('/', adminOnly, async (req, res) => {
  try {
    const nombre = limpiarTexto(req.body.nombre);
    const regional = limpiarTexto(req.body.regional);
    const departamento = limpiarTexto(req.body.departamento);
    const ciudad = limpiarTexto(req.body.ciudad);

    validarCamposTienda({
      nombre,
      regional,
      departamento,
      ciudad
    });

    await validarTiendaDuplicada({
      nombre,
      regional,
      departamento,
      ciudad
    });

    const tienda = await Tienda.create({
      nombre,
      regional,
      departamento,
      ciudad
    });

    return res.status(201).json({
      ok: true,
      message: 'Tienda creada correctamente',
      data: mapTienda(tienda)
    });
  } catch (error) {
    console.error('Error al crear tienda:', error);

    return res.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : 'Error al crear tienda'
    });
  }
});

router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    if (!validarId(id)) {
      return res.status(400).json({
        ok: false,
        message: 'Id de tienda inválido'
      });
    }

    const nombre = limpiarTexto(req.body.nombre);
    const regional = limpiarTexto(req.body.regional);
    const departamento = limpiarTexto(req.body.departamento);
    const ciudad = limpiarTexto(req.body.ciudad);

    validarCamposTienda({
      nombre,
      regional,
      departamento,
      ciudad
    });

    const tienda = await Tienda.findById(id);

    if (!tienda) {
      return res.status(404).json({
        ok: false,
        message: 'Tienda no encontrada'
      });
    }

    await validarTiendaDuplicada({
      nombre,
      regional,
      departamento,
      ciudad,
      excludeId: id
    });

    tienda.nombre = nombre;
    tienda.regional = regional;
    tienda.departamento = departamento;
    tienda.ciudad = ciudad;

    await tienda.save();

    return res.json({
      ok: true,
      message: 'Tienda actualizada correctamente',
      data: mapTienda(tienda)
    });
  } catch (error) {
    console.error('Error al actualizar tienda:', error);

    return res.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : 'Error al actualizar tienda'
    });
  }
});

router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    if (!validarId(id)) {
      return res.status(400).json({
        ok: false,
        message: 'Id de tienda inválido'
      });
    }

    const tienda = await Tienda.findById(id);

    if (!tienda) {
      return res.status(404).json({
        ok: false,
        message: 'Tienda no encontrada'
      });
    }

    await Tienda.deleteOne({ _id: id });

    return res.json({
      ok: true,
      message: 'Tienda eliminada correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar tienda:', error);

    return res.status(500).json({
      ok: false,
      message: 'Error al eliminar tienda'
    });
  }
});

module.exports = router;
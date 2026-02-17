const express = require('express');
const router = express.Router();
const Tienda = require('../models/tienda');

router.get('/', async (req, res) => {
  try {
    const tiendas = await Tienda.find();
    res.json(tiendas);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener tiendas', error: error.message });
  }
});

// Listar regionales disponibles
router.get('/regionales', async (req, res) => {
  try {
    const regionales = await Tienda.distinct('regional');
    res.json(regionales);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener regionales', error: error.message });
  }
});

// Listar ciudades dependientes de una regional
router.get('/ciudades', async (req, res) => {
  try {
    const { regional } = req.query;
    const filtro = regional ? { regional } : {};
    
    const ciudades = await Tienda.distinct('ciudad', filtro);
    res.json(ciudades);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener ciudades', error: error.message });
  }
});

// Listar departamentos dependientes de regional y ciudad
router.get('/departamentos', async (req, res) => {
  try {
    const { regional, ciudad } = req.query;
    const filtro = {};
    
    if (regional) filtro.regional = regional;
    if (ciudad) filtro.ciudad = ciudad;
    
    const departamentos = await Tienda.distinct('departamento', filtro);
    res.json(departamentos);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener departamentos', error: error.message });
  }
});

module.exports = router;
// routes/tiendas.js
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

module.exports = router;

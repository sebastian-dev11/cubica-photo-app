require('dotenv').config();
const express = require('express');
const mongoose = require('./db');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const imagenRoutes = require('./routes/imagenes');
const pdfRoutes = require('./routes/pdf');
const actaRoutes = require('./routes/acta').router; 
const tiendasRoutes = require('./routes/tiendas'); // <-- Nuevo archivo de rutas para tiendas
const informesRoutes = require('./routes/informes');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas existentes
app.use('/auth', authRoutes);
app.use('/login', authRoutes);
app.use('/crear', authRoutes);
app.use('/imagenes', imagenRoutes);
app.use('/pdf', pdfRoutes);
app.use('/acta', actaRoutes);
app.use('/informes', informesRoutes);


// Rutas de tiendas
app.use('/tiendas', tiendasRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

require('dotenv').config();
const express = require('express');
const mongoose = require('./db');
const authRoutes = require('./routes/auth');
const imagenRoutes = require('./routes/imagenes');
const pdfRoutes = require('./routes/pdf');
const actaRoutes = require('./routes/acta').router; // Importar las rutas de acta

const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas existentes
app.use('/auth', authRoutes);
app.use('/login', authRoutes);
app.use('/crear', authRoutes);
app.use('/imagenes', imagenRoutes);
app.use('/pdf', pdfRoutes);

// Nueva ruta para subir acta
app.use('/acta', actaRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

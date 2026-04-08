require('dotenv').config();
const express = require('express');
const mongoose = require('./db');
const cors = require('cors');

// Registrar modelos ANTES de las rutas
require('./models/UsuarioUnico');
require('./models/informe');

const authRoutes = require('./routes/auth');
const imagenRoutes = require('./routes/imagenes');
const pdfRoutes = require('./routes/pdf');
const actaRoutes = require('./routes/acta').router; 
const tiendasRoutes = require('./routes/tiendas');
const informesRoutes = require('./routes/informes');

const app = express();


app.use(cors({
  origin: [
    'https://cubica-photo-frontend.vercel.app',
    'http://localhost:3000',                    
    'http://localhost:5173'                     
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-sesion-id'],
  credentials: true
}));

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
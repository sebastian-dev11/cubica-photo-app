require('dotenv').config();
const express = require('express');
const mongoose = require('./db');
const cors = require('cors');

require('./models/UsuarioUnico');
require('./models/informe');
require('./models/sesion');

const authRoutes = require('./routes/auth');
const imagenRoutes = require('./routes/imagenes');
const pdfRoutes = require('./routes/pdf');
const actaRoutes = require('./routes/acta').router;
const tiendasRoutes = require('./routes/tiendas');
const informesRoutes = require('./routes/informes');
const usuariosRoutes = require('./routes/usuarios');
const authRequired = require('./middleware/authRequired');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/auth', authRoutes);
app.use('/login', authRoutes);
app.use('/crear', authRoutes);

app.use('/imagenes', authRequired, imagenRoutes);
app.use('/pdf', authRequired, pdfRoutes);
app.use('/acta', authRequired, actaRoutes);
app.use('/informes', authRequired, informesRoutes);
app.use('/tiendas', authRequired, tiendasRoutes);
app.use('/usuarios', usuariosRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
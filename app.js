require('dotenv').config();
const express = require('express');
const mongoose = require('./db');
const authRoutes = require('./routes/auth');
console.log('✅ authRoutes:', typeof authRoutes);
const imagenRoutes = require('./routes/imagenes');
console.log('✅ imagenRoutes:', typeof imagenRoutes);
const pdfRoutes = require('./routes/pdf');console.log('✅ pdfRoutes:', typeof pdfRoutes);

const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/auth', authRoutes);
app.use('/imagenes', imagenRoutes);
app.use('/pdf', pdfRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
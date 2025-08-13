// pruebaTiendas.js
const axios = require('axios');

async function probarTiendas() {
  try {
    const res = await axios.get('https://cubica-photo-app.onrender.com/tiendas');
    console.log('Tiendas recibidas del backend:', res.data);
  } catch (error) {
    console.error('Error al obtener tiendas del backend:', error.message);
  }
}

probarTiendas();

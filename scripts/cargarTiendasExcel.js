require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('../db');
const Tienda = require('../models/tienda');

function limpiarTexto(valor) {
  return typeof valor === 'string'
    ? valor.replace(/\s+/g, ' ').trim()
    : String(valor || '').replace(/\s+/g, ' ').trim();
}

function normalizarClave(valor) {
  return limpiarTexto(valor)
    .replace(/^\uFEFF/, '')
    .toUpperCase();
}

function obtenerRutaArchivo() {
  const archivo = process.argv[2];

  if (!archivo) {
    throw new Error('Debes indicar la ruta del archivo CSV');
  }

  const ruta = path.resolve(process.cwd(), archivo);

  if (path.extname(ruta).toLowerCase() !== '.csv') {
    throw new Error('Este script solo acepta archivos CSV');
  }

  if (!fs.existsSync(ruta)) {
    throw new Error(`No se encontró el archivo: ${ruta}`);
  }

  return ruta;
}

function detectarSeparador(ruta) {
  const primeraLinea = fs.readFileSync(ruta, 'utf8').split(/\r?\n/)[0] || '';
  return primeraLinea.includes(';') ? ';' : ',';
}

function leerCsv(ruta) {
  return new Promise((resolve, reject) => {
    const filas = [];

    fs.createReadStream(ruta)
      .pipe(csv({
        separator: detectarSeparador(ruta),
        mapHeaders: ({ header }) => normalizarClave(header)
      }))
      .on('data', (fila) => filas.push(fila))
      .on('end', () => resolve(filas))
      .on('error', reject);
  });
}

function validarColumnas(filas) {
  const columnas = Object.keys(filas[0] || {});
  const requeridas = ['NOMBRE', 'REGIONAL', 'DEPARTAMENTO', 'CIUDAD'];
  const faltantes = requeridas.filter((columna) => !columnas.includes(columna));

  if (faltantes.length > 0) {
    throw new Error(
      `Faltan las siguientes columnas en el CSV: ${faltantes.join(', ')}`
    );
  }
}

function prepararRegistros(filas) {
  return filas.map((fila, indice) => ({
    fila: indice + 2,
    nombre: limpiarTexto(fila.NOMBRE),
    regional: limpiarTexto(fila.REGIONAL).toUpperCase(),
    departamento: limpiarTexto(fila.DEPARTAMENTO),
    ciudad: limpiarTexto(fila.CIUDAD)
  }));
}

function crearClave({ nombre, regional, departamento, ciudad }) {
  return [
    normalizarClave(nombre),
    normalizarClave(regional),
    normalizarClave(departamento),
    normalizarClave(ciudad)
  ].join('|');
}

async function cargarTiendas() {
  const rutaArchivo = obtenerRutaArchivo();
  const filas = await leerCsv(rutaArchivo);

  validarColumnas(filas);

  const registros = prepararRegistros(filas);
  const validos = [];
  const errores = [];
  const clavesCsv = new Set();

  for (const registro of registros) {
    const { fila, nombre, regional, departamento, ciudad } = registro;

    if (!nombre || !regional || !departamento || !ciudad) {
      errores.push({
        fila,
        motivo: 'Nombre, regional, departamento y ciudad son obligatorios'
      });
      continue;
    }

    const clave = crearClave(registro);

    if (clavesCsv.has(clave)) {
      errores.push({
        fila,
        motivo: 'Tienda duplicada dentro del archivo CSV'
      });
      continue;
    }

    clavesCsv.add(clave);
    validos.push(registro);
  }

  const tiendasExistentes = await Tienda.find({})
    .select('nombre regional departamento ciudad')
    .lean();

  const clavesExistentes = new Set(
    tiendasExistentes.map(crearClave)
  );

  const nuevasTiendas = [];
  let existentes = 0;

  for (const registro of validos) {
    const clave = crearClave(registro);

    if (clavesExistentes.has(clave)) {
      existentes++;
      continue;
    }

    nuevasTiendas.push({
      nombre: registro.nombre,
      regional: registro.regional,
      departamento: registro.departamento,
      ciudad: registro.ciudad
    });

    clavesExistentes.add(clave);
  }

  let creadas = 0;

  if (nuevasTiendas.length > 0) {
    const resultado = await Tienda.insertMany(nuevasTiendas, {
      ordered: false
    });
    creadas = resultado.length;
  }

  console.log('');
  console.log('Carga de tiendas finalizada');
  console.log('');
  console.log(`Archivo: ${path.basename(rutaArchivo)}`);
  console.log(`Registros procesados: ${registros.length}`);
  console.log(`Tiendas creadas: ${creadas}`);
  console.log(`Tiendas ya existentes: ${existentes}`);
  console.log(`Registros con errores: ${errores.length}`);

  if (errores.length > 0) {
    console.log('');
    console.log('Detalle de errores:');
    errores.forEach((error) => {
      console.log(`Fila ${error.fila}: ${error.motivo}`);
    });
  }

  console.log('');
}

cargarTiendas()
  .catch((error) => {
    console.error('');
    console.error('Error al cargar las tiendas:');
    console.error(error.message);
    console.error('');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const mongoose = require('../db');
const Tienda = require('../models/tienda');

function limpiarTexto(valor) {
  return typeof valor === 'string'
    ? valor.replace(/\s+/g, ' ').trim()
    : String(valor || '').replace(/\s+/g, ' ').trim();
}

function normalizarClave(valor) {
  return limpiarTexto(valor).toUpperCase();
}

function obtenerRutaArchivo() {
  const archivo = process.argv[2];

  if (!archivo) {
    throw new Error('Debes indicar la ruta del archivo Excel');
  }

  const ruta = path.resolve(process.cwd(), archivo);

  if (!fs.existsSync(ruta)) {
    throw new Error(`No se encontró el archivo: ${ruta}`);
  }

  return ruta;
}

function validarColumnas(hoja) {
  const primeraFila = hoja[0] || [];

  const columnas = primeraFila.map((columna) =>
    normalizarClave(columna)
  );

  const requeridas = [
    'NOMBRE',
    'REGIONAL',
    'DEPARTAMENTO',
    'CIUDAD'
  ];

  const faltantes = requeridas.filter(
    (columna) => !columnas.includes(columna)
  );

  if (faltantes.length > 0) {
    throw new Error(
      `Faltan las siguientes columnas en el Excel: ${faltantes.join(', ')}`
    );
  }
}

function prepararRegistros(hoja) {
  const encabezados = hoja[0].map((columna) =>
    normalizarClave(columna)
  );

  return hoja.slice(1).map((fila, indice) => {
    const registro = {};

    encabezados.forEach((encabezado, posicion) => {
      registro[encabezado] = fila[posicion];
    });

    return {
      fila: indice + 2,
      nombre: limpiarTexto(registro.NOMBRE),
      regional: limpiarTexto(registro.REGIONAL).toUpperCase(),
      departamento: limpiarTexto(registro.DEPARTAMENTO),
      ciudad: limpiarTexto(registro.CIUDAD)
    };
  });
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

  const workbook = xlsx.readFile(rutaArchivo);
  const nombreHoja = workbook.SheetNames[0];

  if (!nombreHoja) {
    throw new Error('El archivo Excel no contiene hojas');
  }

  const hoja = xlsx.utils.sheet_to_json(
    workbook.Sheets[nombreHoja],
    {
      header: 1,
      defval: ''
    }
  );

  validarColumnas(hoja);

  const registros = prepararRegistros(hoja);

  const validos = [];
  const errores = [];
  const clavesExcel = new Set();

  for (const registro of registros) {
    const {
      fila,
      nombre,
      regional,
      departamento,
      ciudad
    } = registro;

    if (!nombre || !regional || !departamento || !ciudad) {
      errores.push({
        fila,
        motivo: 'Nombre, regional, departamento y ciudad son obligatorios'
      });

      continue;
    }

    const clave = crearClave(registro);

    if (clavesExcel.has(clave)) {
      errores.push({
        fila,
        motivo: 'Tienda duplicada dentro del archivo Excel'
      });

      continue;
    }

    clavesExcel.add(clave);
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
    const resultado = await Tienda.insertMany(
      nuevasTiendas,
      {
        ordered: false
      }
    );

    creadas = resultado.length;
  }

  console.log('');
  console.log('Carga de tiendas finalizada');
  console.log('');
  console.log(`Archivo: ${path.basename(rutaArchivo)}`);
  console.log(`Hoja: ${nombreHoja}`);
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

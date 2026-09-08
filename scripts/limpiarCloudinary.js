require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const cloudinary = require('../utils/cloudinary');
const Informe = require('../models/informe');
const InformeVersion = require('../models/informeVersion');

const argumentos = process.argv.slice(2);
const ejecutar = argumentos.includes('--ejecutar');
const confirmacionValida = argumentos.includes('--confirmar=ELIMINAR');
const permitirSinInformes = argumentos.includes('--permitir-sin-informes');

const idsImagenesProtegidas = new Set([
  'LOGO_CUBICA_NUEVO_v3rsq5',
  'D1_LOGO_NUEVO_kj1bdh',
  'LOGO_CUBICA_TRANSPARENTE_gfjdep',
  ...String(process.env.CLOUDINARY_PROTECTED_PUBLIC_IDS || '')
    .split(',')
    .map((valor) => valor.trim())
    .filter(Boolean)
]);

function obtenerMongoUri() {
  return (
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.MONGO_URL ||
    process.env.DATABASE_URL ||
    ''
  ).trim();
}

function dividirEnLotes(lista, tamano = 100) {
  const lotes = [];

  for (let i = 0; i < lista.length; i += tamano) {
    lotes.push(lista.slice(i, i + tamano));
  }

  return lotes;
}

function sumarBytes(recursos = []) {
  return recursos.reduce(
    (total, recurso) => total + Number(recurso.bytes || 0),
    0
  );
}

function formatearBytes(bytes) {
  const total = Number(bytes || 0);

  if (total < 1024) return `${total} B`;
  if (total < 1024 ** 2) return `${(total / 1024).toFixed(2)} KB`;
  if (total < 1024 ** 3) {
    return `${(total / 1024 ** 2).toFixed(2)} MB`;
  }

  return `${(total / 1024 ** 3).toFixed(2)} GB`;
}

function obtenerPublicIdDesdeUrl(url) {
  if (!url || typeof url !== 'string') return '';

  try {
    const parsed = new URL(url);
    const marcador = '/upload/';
    const indice = parsed.pathname.indexOf(marcador);

    if (indice === -1) return '';

    const despuesUpload = parsed.pathname.slice(
      indice + marcador.length
    );

    const segmentos = despuesUpload
      .split('/')
      .filter(Boolean);

    const indiceVersion = segmentos.findIndex(
      (segmento) => /^v\d+$/.test(segmento)
    );

    const segmentosPublicId =
      indiceVersion >= 0
        ? segmentos.slice(indiceVersion + 1)
        : segmentos;

    if (segmentosPublicId.length === 0) return '';

    return decodeURIComponent(segmentosPublicId.join('/'));
  } catch {
    return '';
  }
}

function normalizarRecurso(recurso, resourceType) {
  return {
    publicId: recurso.public_id,
    resourceType,
    type: recurso.type || 'upload',
    format: recurso.format || '',
    bytes: Number(recurso.bytes || 0),
    bytesTexto: formatearBytes(recurso.bytes || 0),
    createdAt: recurso.created_at || null,
    folder: recurso.folder || recurso.asset_folder || '',
    url: recurso.secure_url || recurso.url || ''
  };
}

async function listarTodosLosRecursos(resourceType) {
  const recursos = [];
  let nextCursor = null;

  do {
    const respuesta = await cloudinary.api.resources({
      resource_type: resourceType,
      type: 'upload',
      max_results: 500,
      next_cursor: nextCursor || undefined
    });

    const pagina = Array.isArray(respuesta.resources)
      ? respuesta.resources
      : [];

    recursos.push(
      ...pagina.map((recurso) =>
        normalizarRecurso(recurso, resourceType)
      )
    );

    nextCursor = respuesta.next_cursor || null;
  } while (nextCursor);

  return recursos;
}

async function obtenerInformesActuales() {
  const informes = await Informe.find({})
    .select(
      '_id title numeroIncidencia publicId url createdAt'
    )
    .lean();

  const ids = new Set();
  const sinPublicId = [];

  for (const informe of informes) {
    const publicId = String(
      informe.publicId ||
      obtenerPublicIdDesdeUrl(informe.url) ||
      ''
    ).trim();

    if (publicId) {
      ids.add(publicId);
    } else {
      sinPublicId.push({
        id: informe._id?.toString() || '',
        title: informe.title || '',
        numeroIncidencia: informe.numeroIncidencia || '',
        url: informe.url || ''
      });
    }
  }

  return {
    informes,
    ids,
    sinPublicId
  };
}

function clasificarRecursos({
  recursosImagen,
  recursosRaw,
  idsInformes
}) {
  const conservarImagen = [];
  const eliminarImagen = [];
  const conservarRaw = [];
  const eliminarRaw = [];

  for (const recurso of recursosImagen) {
    if (
      idsInformes.has(recurso.publicId) ||
      idsImagenesProtegidas.has(recurso.publicId)
    ) {
      conservarImagen.push(recurso);
    } else {
      eliminarImagen.push(recurso);
    }
  }

  for (const recurso of recursosRaw) {
    if (idsInformes.has(recurso.publicId)) {
      conservarRaw.push(recurso);
    } else {
      eliminarRaw.push(recurso);
    }
  }

  return {
    conservarImagen,
    eliminarImagen,
    conservarRaw,
    eliminarRaw
  };
}

async function eliminarRecursos(recursos, resourceType) {
  const ids = recursos
    .map((recurso) => recurso.publicId)
    .filter(Boolean);

  const lotes = dividirEnLotes(ids, 100);
  const resultados = [];

  for (let i = 0; i < lotes.length; i++) {
    const lote = lotes[i];

    const respuesta = await cloudinary.api.delete_resources(
      lote,
      {
        resource_type: resourceType,
        type: 'upload',
        invalidate: true
      }
    );

    resultados.push({
      lote: i + 1,
      cantidad: lote.length,
      deleted: respuesta.deleted || {},
      partial: Boolean(respuesta.partial),
      nextCursor: respuesta.next_cursor || null
    });
  }

  return resultados;
}

async function limpiarMongoDb() {
  const versiones = await InformeVersion.deleteMany({});

  const informes = await Informe.updateMany(
    {},
    {
      $set: {
        evidenciasPrevias: [],
        evidenciasPosteriores: [],
        acta: {},
        actaImagenes: [],
        fuentesPersistentes: false,
        versionActual: 1,
        editadoPor: null,
        editadoEn: null
      }
    }
  );

  return {
    versionesEliminadas: Number(
      versiones.deletedCount || 0
    ),
    informesEncontrados: Number(
      informes.matchedCount ||
      informes.n ||
      0
    ),
    informesActualizados: Number(
      informes.modifiedCount ||
      informes.nModified ||
      0
    )
  };
}

function crearNombreReporte() {
  const fecha = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  return path.join(
    process.cwd(),
    `limpieza-cloudinary-${fecha}.json`
  );
}

function imprimirResumen(reporte) {
  console.log('');
  console.log('Resumen de limpieza');
  console.log(`Modo: ${reporte.modo}`);

  console.log(
    `Informes actuales en MongoDB: ${reporte.mongo.informesActuales}`
  );

  console.log(
    `PublicId de informes protegidos: ${reporte.protegidos.informes.length}`
  );

  console.log(
    `Imágenes protegidas: ${reporte.protegidos.imagenes.length}`
  );

  console.log(
    `Imágenes encontradas: ${reporte.cloudinary.antes.imagenes}`
  );

  console.log(
    `Archivos raw encontrados: ${reporte.cloudinary.antes.raw}`
  );

  console.log(
    `Imágenes para eliminar: ${reporte.candidatos.imagenes.cantidad}`
  );

  console.log(
    `Raw para eliminar: ${reporte.candidatos.raw.cantidad}`
  );

  console.log(
    `Espacio estimado a liberar: ${reporte.candidatos.totalBytesTexto}`
  );

  if (reporte.mongo.sinPublicId.length > 0) {
    console.log(
      `Informes sin publicId reconocible: ${reporte.mongo.sinPublicId.length}`
    );
  }

  if (
    reporte.protegidos.informesNoEncontrados.length > 0
  ) {
    console.log(
      `PDF actuales no encontrados en Cloudinary: ${reporte.protegidos.informesNoEncontrados.length}`
    );
  }

  console.log(`Reporte: ${reporte.archivoReporte}`);
  console.log('');
}

async function ejecutarProceso() {
  if (ejecutar && !confirmacionValida) {
    throw new Error(
      'Para eliminar debes usar --ejecutar --confirmar=ELIMINAR'
    );
  }

  const mongoUri = obtenerMongoUri();

  if (!mongoUri) {
    throw new Error(
      'No se encontró MONGODB_URI, MONGO_URI, MONGO_URL o DATABASE_URL en el archivo .env'
    );
  }

  await mongoose.connect(mongoUri);

  const datosInformes = await obtenerInformesActuales();

  if (
    ejecutar &&
    datosInformes.ids.size === 0 &&
    !permitirSinInformes
  ) {
    throw new Error(
      'No se encontraron publicId de informes actuales. Se canceló la eliminación para evitar borrar todos los recursos.'
    );
  }

  const [
    recursosImagen,
    recursosRaw
  ] = await Promise.all([
    listarTodosLosRecursos('image'),
    listarTodosLosRecursos('raw')
  ]);

  const clasificacion = clasificarRecursos({
    recursosImagen,
    recursosRaw,
    idsInformes: datosInformes.ids
  });

  const idsEncontrados = new Set([
    ...recursosImagen.map(
      (recurso) => recurso.publicId
    ),
    ...recursosRaw.map(
      (recurso) => recurso.publicId
    )
  ]);

  const informesNoEncontrados = [
    ...datosInformes.ids
  ].filter(
    (publicId) => !idsEncontrados.has(publicId)
  );

  const bytesImagenes = sumarBytes(
    clasificacion.eliminarImagen
  );

  const bytesRaw = sumarBytes(
    clasificacion.eliminarRaw
  );

  const totalBytes = bytesImagenes + bytesRaw;
  const archivoReporte = crearNombreReporte();

  const reporte = {
    generadoEn: new Date().toISOString(),
    modo: ejecutar ? 'ELIMINACION' : 'SIMULACION',
    archivoReporte,
    mongo: {
      informesActuales: datosInformes.informes.length,
      sinPublicId: datosInformes.sinPublicId,
      limpieza: null
    },
    protegidos: {
      informes: [
        ...datosInformes.ids
      ].sort(),
      imagenes: [
        ...idsImagenesProtegidas
      ].sort(),
      informesNoEncontrados
    },
    cloudinary: {
      antes: {
        imagenes: recursosImagen.length,
        raw: recursosRaw.length,
        total:
          recursosImagen.length +
          recursosRaw.length
      },
      despues: null
    },
    conservar: {
      imagenes:
        clasificacion.conservarImagen,
      raw:
        clasificacion.conservarRaw
    },
    candidatos: {
      imagenes: {
        cantidad:
          clasificacion.eliminarImagen.length,
        bytes: bytesImagenes,
        bytesTexto:
          formatearBytes(bytesImagenes),
        recursos:
          clasificacion.eliminarImagen
      },
      raw: {
        cantidad:
          clasificacion.eliminarRaw.length,
        bytes: bytesRaw,
        bytesTexto:
          formatearBytes(bytesRaw),
        recursos:
          clasificacion.eliminarRaw
      },
      total:
        clasificacion.eliminarImagen.length +
        clasificacion.eliminarRaw.length,
      totalBytes,
      totalBytesTexto:
        formatearBytes(totalBytes)
    },
    eliminacion: {
      imagenes: [],
      raw: []
    }
  };

  fs.writeFileSync(
    archivoReporte,
    JSON.stringify(reporte, null, 2),
    'utf8'
  );

  imprimirResumen(reporte);

  if (!ejecutar) {
    console.log('No se eliminó ningún recurso.');
    console.log('Revisa el reporte y luego ejecuta:');

    console.log(
      'node scripts/limpiarCloudinary.js --ejecutar --confirmar=ELIMINAR'
    );

    return;
  }

  reporte.eliminacion.imagenes =
    await eliminarRecursos(
      clasificacion.eliminarImagen,
      'image'
    );

  reporte.eliminacion.raw =
    await eliminarRecursos(
      clasificacion.eliminarRaw,
      'raw'
    );

  reporte.mongo.limpieza =
    await limpiarMongoDb();

  const [
    imagenesRestantes,
    rawRestantes
  ] = await Promise.all([
    listarTodosLosRecursos('image'),
    listarTodosLosRecursos('raw')
  ]);

  reporte.cloudinary.despues = {
    imagenes: imagenesRestantes.length,
    raw: rawRestantes.length,
    total:
      imagenesRestantes.length +
      rawRestantes.length,
    recursosImagen: imagenesRestantes,
    recursosRaw: rawRestantes
  };

  reporte.finalizadoEn =
    new Date().toISOString();

  fs.writeFileSync(
    archivoReporte,
    JSON.stringify(reporte, null, 2),
    'utf8'
  );

  console.log('Limpieza completada.');

  console.log(
    `Versiones eliminadas de MongoDB: ${reporte.mongo.limpieza.versionesEliminadas}`
  );

  console.log(
    `Informes actualizados en MongoDB: ${reporte.mongo.limpieza.informesActualizados}`
  );

  console.log(
    `Recursos restantes en Cloudinary: ${reporte.cloudinary.despues.total}`
  );

  console.log(
    `Reporte final: ${archivoReporte}`
  );
}

async function main() {
  try {
    await ejecutarProceso();
  } catch (error) {
    console.error(
      'Error en la limpieza:',
      error?.message || error
    );

    process.exitCode = 1;
  } finally {
    if (
      mongoose.connection.readyState !== 0
    ) {
      await mongoose.disconnect();
    }
  }
}

main();

//node scripts\limpiarCloudinary.js
//node scripts\limpiarCloudinary.js --ejecutar --confirmar=ELIMINAR
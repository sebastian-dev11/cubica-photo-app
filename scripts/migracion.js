require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('../db'); 
const Tienda = require('../models/tienda');

const CSV_FOLDER = path.join(__dirname, '../csv_regionales');


async function procesarCSV(filePath, regional, archivo) {
  return new Promise((resolve, reject) => {
    
    const buffer = fs.readFileSync(filePath);
    let rawText = buffer.toString('utf8');
    
    
    if (rawText.charCodeAt(0) === 0xFEFF) {
      rawText = rawText.substring(1);
    }

    const primeraLinea = rawText.split('\n')[0] || '';
    const separador = primeraLinea.includes(';') ? ';' : ',';
    
    const tiendas = [];

    fs.createReadStream(filePath)
      .pipe(csv({ separator: separador }))
      .on('headers', (headers) => {
        
        if (totalArchivosProcesados === 0) {
          console.log(`\n🔍 DEBUG - Cabeceras leidas en ${archivo}:`, headers);
          console.log(`🔍 DEBUG - Separador detectado: "${separador}"\n`);
        }
      })
      .on('data', (row) => {
        let nombre = null;
        let ciudad = 'DESCONOCIDO';
        let departamento = '';

        for (const key of Object.keys(row)) {
          if (!key) continue;
          
          const cleanKey = String(key).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          const value = row[key] ? row[key].trim().toUpperCase() : null;

          if (cleanKey.includes('TIENDA')) nombre = value;
          if (cleanKey.includes('CIUDAD') || cleanKey.includes('MUNICIPIO')) ciudad = value || 'DESCONOCIDO';
          if (cleanKey.includes('DEPARTAMENTO')) departamento = value || '';
        }

        
        if (!nombre || nombre === 'NAN') return;

        
        if (!departamento || departamento === 'NAN') {
          if (ciudad.includes('BOGOT') || nombre.includes('BOG')) {
            departamento = 'BOGOTA';
            ciudad = 'BOGOTA';
          } else if (ciudad.includes('SOACHA')) {
            departamento = 'CUNDINAMARCA';
          } else {
            departamento = 'DESCONOCIDO';
          }
        }

        tiendas.push({ nombre, regional, departamento, ciudad });
      })
      .on('end', () => resolve(tiendas))
      .on('error', (error) => reject(error));
  });
}

let totalArchivosProcesados = 0;


async function sincronizarTiendas() {
  try {
    const archivos = fs.readdirSync(CSV_FOLDER).filter(file => file.endsWith('.csv'));
    let totalProcesadas = 0;
    let totalNuevasOActualizadas = 0;

    console.log(`Iniciando sincronizacion de ${archivos.length} archivos CSV...`);

    for (const archivo of archivos) {
      
      const nombreLimpio = archivo.replace('.csv', '').trim();
      let regional = 'OTRA';
      
      if (nombreLimpio.includes('-')) {
        const partes = nombreLimpio.split('-');
        regional = partes[partes.length - 1].trim(); 
      } else {
        regional = nombreLimpio;
      }
      
      const filePath = path.join(CSV_FOLDER, archivo);
      
      const tiendasDelArchivo = await procesarCSV(filePath, regional, archivo);
      totalArchivosProcesados++;

      console.log(`Archivo procesado [${regional}]: ${tiendasDelArchivo.length} tiendas encontradas.`);
      
      for (const tienda of tiendasDelArchivo) {
        
        await Tienda.findOneAndUpdate(
          { nombre: tienda.nombre },
          { $set: tienda },
          { upsert: true, new: true }
        );
        totalNuevasOActualizadas++;
      }
      totalProcesadas += tiendasDelArchivo.length;
    }

    console.log(`\n Migracion finalizada. Leidas: ${totalProcesadas}. Sincronizadas: ${totalNuevasOActualizadas}`);
    process.exit(0);
  } catch (error) {
    console.error('Error durante la sincronizacion:', error);
    process.exit(1);
  }
}

sincronizarTiendas();
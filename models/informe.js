const mongoose = require('mongoose');

const geolocalizacionSchema = new mongoose.Schema(
  {
    latitud: {
      type: Number,
      default: null,
      min: -90,
      max: 90
    },
    longitud: {
      type: Number,
      default: null,
      min: -180,
      max: 180
    },
    precision: {
      type: Number,
      default: null,
      min: 0
    },
    altitud: {
      type: Number,
      default: null
    },
    precisionAltitud: {
      type: Number,
      default: null
    },
    fechaCaptura: {
      type: Date,
      default: null
    },
    mapsUrl: {
      type: String,
      trim: true,
      default: ''
    },
    origen: {
      type: String,
      enum: ['browser', 'manual', 'none'],
      default: 'none'
    }
  },
  {
    _id: false
  }
);

const informeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UsuarioUnico'
    },
    sesionId: {
      type: String,
      trim: true,
      default: ''
    },
    url: {
      type: String,
      required: true
    },
    publicId: {
      type: String
    },
    mimeType: {
      type: String,
      default: 'application/pdf'
    },
    includesActa: {
      type: Boolean,
      default: false
    },
    numeroIncidencia: {
      type: String,
      trim: true,
      default: ''
    },
    regional: {
      type: String,
      default: 'OTRA'
    },
    tiendaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tienda',
      default: null
    },
    tiendaNombre: {
      type: String,
      trim: true,
      default: ''
    },
    tiendaRegional: {
      type: String,
      trim: true,
      default: ''
    },
    tiendaDepartamento: {
      type: String,
      trim: true,
      default: ''
    },
    tiendaCiudad: {
      type: String,
      trim: true,
      default: ''
    },
    geolocalizacion: {
      type: geolocalizacionSchema,
      default: () => ({
        latitud: null,
        longitud: null,
        precision: null,
        altitud: null,
        precisionAltitud: null,
        fechaCaptura: null,
        mapsUrl: '',
        origen: 'none'
      })
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }
);

informeSchema.index({ createdAt: -1 });
informeSchema.index({ generatedBy: 1, createdAt: -1 });
informeSchema.index({ sesionId: 1, createdAt: -1 });
informeSchema.index({ numeroIncidencia: 1, createdAt: -1 });
informeSchema.index({ regional: 1, createdAt: -1 });
informeSchema.index({ tiendaId: 1, createdAt: -1 });
informeSchema.index({ tiendaNombre: 1, createdAt: -1 });
informeSchema.index({ tiendaRegional: 1, createdAt: -1 });
informeSchema.index({ 'geolocalizacion.latitud': 1, 'geolocalizacion.longitud': 1 });

module.exports = mongoose.model('Informe', informeSchema);
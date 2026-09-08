const mongoose = require('mongoose');

const { Schema } = mongoose;

const geolocalizacionSchema = new Schema(
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

const pdfSchema = new Schema(
  {
    url: {
      type: String,
      trim: true,
      default: ''
    },
    publicId: {
      type: String,
      trim: true,
      default: ''
    },
    mimeType: {
      type: String,
      trim: true,
      default: 'application/pdf'
    }
  },
  {
    _id: false
  }
);

const archivoSchema = new Schema(
  {
    url: {
      type: String,
      trim: true,
      default: ''
    },
    publicId: {
      type: String,
      trim: true,
      default: ''
    },
    public_id: {
      type: String,
      trim: true,
      default: ''
    },
    nombreOriginal: {
      type: String,
      trim: true,
      default: ''
    },
    nombreArchivoOriginal: {
      type: String,
      trim: true,
      default: ''
    },
    mimeType: {
      type: String,
      trim: true,
      default: ''
    },
    tipo: {
      type: String,
      trim: true,
      default: ''
    },
    ubicacion: {
      type: String,
      trim: true,
      default: ''
    },
    observacion: {
      type: String,
      trim: true,
      default: ''
    },
    fechaSubida: {
      type: Date,
      default: null
    },
    width: {
      type: Number,
      default: null
    },
    height: {
      type: Number,
      default: null
    },
    escaneada: {
      type: Boolean,
      default: false
    },
    crop: {
      type: Schema.Types.Mixed,
      default: null
    }
  },
  {
    _id: false
  }
);

const cambioSchema = new Schema(
  {
    campo: {
      type: String,
      trim: true,
      default: ''
    },
    anterior: {
      type: Schema.Types.Mixed,
      default: null
    },
    nuevo: {
      type: Schema.Types.Mixed,
      default: null
    }
  },
  {
    _id: false
  }
);

const informeVersionSchema = new Schema(
  {
    informeId: {
      type: Schema.Types.ObjectId,
      ref: 'Informe',
      required: true,
      index: true
    },
    version: {
      type: Number,
      required: true,
      min: 1
    },
    title: {
      type: String,
      trim: true,
      default: ''
    },
    generatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'UsuarioUnico',
      default: null
    },
    editadoPor: {
      type: Schema.Types.ObjectId,
      ref: 'UsuarioUnico',
      default: null
    },
    sesionId: {
      type: String,
      trim: true,
      default: ''
    },
    pdf: {
      type: pdfSchema,
      default: () => ({})
    },
    url: {
      type: String,
      trim: true,
      default: ''
    },
    publicId: {
      type: String,
      trim: true,
      default: ''
    },
    mimeType: {
      type: String,
      trim: true,
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
      trim: true,
      default: 'OTRA'
    },
    tiendaId: {
      type: Schema.Types.ObjectId,
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
    evidenciasPrevias: {
      type: [archivoSchema],
      default: []
    },
    evidenciasPosteriores: {
      type: [archivoSchema],
      default: []
    },
    acta: {
      type: archivoSchema,
      default: () => ({})
    },
    actaImagenes: {
      type: [archivoSchema],
      default: []
    },
    cambios: {
      type: [cambioSchema],
      default: []
    },
    motivo: {
      type: String,
      trim: true,
      default: ''
    },
    snapshot: {
      type: Schema.Types.Mixed,
      default: null
    }
  },
  {
    timestamps: true
  }
);

informeVersionSchema.index({ informeId: 1, version: 1 }, { unique: true });
informeVersionSchema.index({ informeId: 1, createdAt: -1 });
informeVersionSchema.index({ editadoPor: 1, createdAt: -1 });
informeVersionSchema.index({ numeroIncidencia: 1, createdAt: -1 });
informeVersionSchema.index({ tiendaId: 1, createdAt: -1 });

module.exports = mongoose.model('InformeVersion', informeVersionSchema);
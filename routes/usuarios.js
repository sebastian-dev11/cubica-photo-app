const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const UsuarioUnico = require('../models/UsuarioUnico');
const authRequired = require('../middleware/authRequired');
const adminOnly = require('../middleware/adminOnly');

const router = express.Router();

router.use(authRequired, adminOnly);

function limpiarTexto(valor) {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
}

function validarId(id) {
  return mongoose.isValidObjectId(id);
}

function mapUsuario(usuario) {
  return {
    _id: usuario._id.toString(),
    usuario: usuario.usuario,
    nombre: usuario.nombre || '',
    activo: usuario.activo !== false,
    rol: usuario.rol || 'tecnico',
    createdAt: usuario.createdAt,
    updatedAt: usuario.updatedAt
  };
}

function obtenerPassword(body) {
  if (typeof body.contraseña === 'string') {
    return body.contraseña;
  }

  if (typeof body.password === 'string') {
    return body.password;
  }

  return '';
}

function validarPassword(password) {
  return typeof password === 'string' && password.trim().length >= 8;
}

function validarRol(rol) {
  return ['admin', 'tecnico'].includes(rol);
}

router.get('/', async (req, res) => {
  try {
    const search = limpiarTexto(req.query.search || '');
    const query = {};

    if (search) {
      const rx = new RegExp(search, 'i');

      query.$or = [
        { usuario: rx },
        { nombre: rx },
        { rol: rx }
      ];
    }

    const usuarios = await UsuarioUnico.find(query)
      .select('-contraseña')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      data: usuarios.map(mapUsuario)
    });
  } catch (err) {
    console.error('Error listando usuarios:', err);

    return res.status(500).json({
      error: 'Error al listar usuarios'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!validarId(id)) {
      return res.status(400).json({
        error: 'Id de usuario inválido'
      });
    }

    const usuario = await UsuarioUnico.findById(id)
      .select('-contraseña')
      .lean();

    if (!usuario) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    return res.json({
      ok: true,
      usuario: mapUsuario(usuario)
    });
  } catch (err) {
    console.error('Error consultando usuario:', err);

    return res.status(500).json({
      error: 'Error al consultar usuario'
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const usuario = limpiarTexto(req.body.usuario);
    const nombre = limpiarTexto(req.body.nombre);
    const password = obtenerPassword(req.body);
    const rol = limpiarTexto(req.body.rol || 'tecnico');
    const activo = typeof req.body.activo === 'boolean' ? req.body.activo : true;

    if (!usuario || !nombre || !password) {
      return res.status(400).json({
        error: 'Usuario, nombre y contraseña son obligatorios'
      });
    }

    if (!validarPassword(password)) {
      return res.status(400).json({
        error: 'La contraseña debe tener mínimo 8 caracteres'
      });
    }

    if (!validarRol(rol)) {
      return res.status(400).json({
        error: 'Rol inválido'
      });
    }

    const existente = await UsuarioUnico.findOne({ usuario }).lean();

    if (existente) {
      return res.status(400).json({
        error: 'Ya existe un usuario con ese documento o nombre de usuario'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const nuevoUsuario = await UsuarioUnico.create({
      usuario,
      nombre,
      contraseña: hash,
      activo,
      rol
    });

    return res.status(201).json({
      ok: true,
      mensaje: 'Usuario creado correctamente',
      usuario: mapUsuario(nuevoUsuario)
    });
  } catch (err) {
    console.error('Error creando usuario:', err);

    if (err.code === 11000) {
      return res.status(400).json({
        error: 'Ya existe un usuario con ese documento o nombre de usuario'
      });
    }

    return res.status(500).json({
      error: 'Error al crear usuario'
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!validarId(id)) {
      return res.status(400).json({
        error: 'Id de usuario inválido'
      });
    }

    const usuarioActual = await UsuarioUnico.findById(id);

    if (!usuarioActual) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    const usuario = limpiarTexto(req.body.usuario);
    const nombre = limpiarTexto(req.body.nombre);
    const rol = limpiarTexto(req.body.rol || usuarioActual.rol || 'tecnico');
    const activo = typeof req.body.activo === 'boolean' ? req.body.activo : usuarioActual.activo !== false;

    if (!usuario || !nombre) {
      return res.status(400).json({
        error: 'Usuario y nombre son obligatorios'
      });
    }

    if (!validarRol(rol)) {
      return res.status(400).json({
        error: 'Rol inválido'
      });
    }

    if (usuarioActual.usuario === 'admin' && usuario !== 'admin') {
      return res.status(400).json({
        error: 'No se puede cambiar el usuario principal admin'
      });
    }

    if (usuarioActual.usuario === 'admin' && rol !== 'admin') {
      return res.status(400).json({
        error: 'No se puede quitar el rol admin al usuario principal'
      });
    }

    if (usuarioActual.usuario === 'admin' && activo === false) {
      return res.status(400).json({
        error: 'No se puede desactivar el usuario principal admin'
      });
    }

    const existente = await UsuarioUnico.findOne({
      usuario,
      _id: { $ne: id }
    }).lean();

    if (existente) {
      return res.status(400).json({
        error: 'Ya existe otro usuario con ese documento o nombre de usuario'
      });
    }

    usuarioActual.usuario = usuario;
    usuarioActual.nombre = nombre;
    usuarioActual.rol = rol;
    usuarioActual.activo = activo;

    await usuarioActual.save();

    return res.json({
      ok: true,
      mensaje: 'Usuario actualizado correctamente',
      usuario: mapUsuario(usuarioActual)
    });
  } catch (err) {
    console.error('Error actualizando usuario:', err);

    if (err.code === 11000) {
      return res.status(400).json({
        error: 'Ya existe otro usuario con ese documento o nombre de usuario'
      });
    }

    return res.status(500).json({
      error: 'Error al actualizar usuario'
    });
  }
});

router.patch('/:id/password', async (req, res) => {
  try {
    const { id } = req.params;
    const password = obtenerPassword(req.body);

    if (!validarId(id)) {
      return res.status(400).json({
        error: 'Id de usuario inválido'
      });
    }

    if (!validarPassword(password)) {
      return res.status(400).json({
        error: 'La contraseña debe tener mínimo 8 caracteres'
      });
    }

    const usuario = await UsuarioUnico.findById(id);

    if (!usuario) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    usuario.contraseña = await bcrypt.hash(password, 10);

    await usuario.save();

    return res.json({
      ok: true,
      mensaje: 'Contraseña actualizada correctamente'
    });
  } catch (err) {
    console.error('Error actualizando contraseña:', err);

    return res.status(500).json({
      error: 'Error al actualizar contraseña'
    });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;

    if (!validarId(id)) {
      return res.status(400).json({
        error: 'Id de usuario inválido'
      });
    }

    if (typeof activo !== 'boolean') {
      return res.status(400).json({
        error: 'El estado activo es obligatorio'
      });
    }

    const usuario = await UsuarioUnico.findById(id);

    if (!usuario) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    if (usuario.usuario === 'admin' && activo === false) {
      return res.status(400).json({
        error: 'No se puede desactivar el usuario principal admin'
      });
    }

    usuario.activo = activo;

    await usuario.save();

    return res.json({
      ok: true,
      mensaje: activo ? 'Usuario activado correctamente' : 'Usuario desactivado correctamente',
      usuario: mapUsuario(usuario)
    });
  } catch (err) {
    console.error('Error actualizando estado de usuario:', err);

    return res.status(500).json({
      error: 'Error al actualizar estado de usuario'
    });
  }
});

module.exports = router;
const Sesion = require('../models/sesion');
const UsuarioUnico = require('../models/UsuarioUnico');

module.exports = async function adminOnly(req, res, next) {
  try {
    // Puedes recibir sesionId por query o header
    const sesionId = req.query.sesionId || req.headers['x-sesion-id'];
    if (!sesionId) return res.status(403).json({ error: 'Solo admin (falta sesionId)' });

    const sesion = await Sesion.findOne({ sesionId }).lean();
    if (!sesion?.usuarioId) return res.status(403).json({ error: 'Solo admin' });

    const user = await UsuarioUnico.findById(sesion.usuarioId).lean();
    const isAdmin = Boolean(sesion.isAdmin) || user?.usuario === 'admin';

    if (!isAdmin) return res.status(403).json({ error: 'Solo admin' });

    req.isAdmin = true;
    req.adminUserId = user?._id?.toString();
    return next();
  } catch (e) {
    console.error('adminOnly error:', e);
    return res.status(500).json({ error: 'Error de autorización' });
  }
};

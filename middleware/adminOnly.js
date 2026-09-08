module.exports = function adminOnly(req, res, next) {
  try {
    if (!req.auth) {
      return res.status(401).json({
        error: 'Autenticación requerida'
      });
    }

    if (!req.auth.isAdmin) {
      return res.status(403).json({
        error: 'Solo admin'
      });
    }

    req.isAdmin = true;
    req.adminUserId = req.auth.userId;

    return next();
  } catch (err) {
    console.error('adminOnly error:', err);

    return res.status(500).json({
      error: 'Error de autorización'
    });
  }
};
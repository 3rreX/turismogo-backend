const jwt = require("jsonwebtoken");

const auth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        mensaje: "Acceso denegado. Token no proporcionado.",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.usuario = {
      id: decoded.id,
      rol: decoded.rol,
      email: decoded.email,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      mensaje: "Token inválido o expirado.",
    });
  }
};

module.exports = auth;
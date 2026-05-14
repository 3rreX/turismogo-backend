const express = require("express");
const router = express.Router();

const Servicio = require("../models/Servicio");
const upload = require("../middleware/upload");
const uploadToCloudinary = require("../utils/uploadToCloudinary");

// Ajusta estos si tus nombres son distintos
const auth = require("../middleware/auth");
const verifyRole = require("../middleware/verifyRole");

// LISTAR SERVICIOS PUBLICOS
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 24, 50);

    const servicios = await Servicio.find()
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json(servicios);
  } catch (error) {
    console.error("Error al listar servicios:", error);
    res.status(500).json({
      mensaje: "Error al cargar servicios",
    });
  }
});

// CREAR SERVICIO CON IMAGEN
router.post(
  "/",
  auth,
  verifyRole(["propietario", "admin"]),
  upload.single("imagen"),
  async (req, res) => {
    try {
      const { nombre, descripcion, precio } = req.body;

      if (!nombre || !descripcion || !precio) {
        return res.status(400).json({
          mensaje: "Faltan campos obligatorios",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          mensaje: "Debes subir una imagen",
        });
      }

      const resultado = await uploadToCloudinary(req.file.buffer);

      const nuevoServicio = new Servicio({
        nombre,
        descripcion,
        precio,
        imagen: resultado.secure_url,
        propietario: req.usuario.id, // ⚠️ puede cambiar según tu auth
      });

      await nuevoServicio.save();

      res.status(201).json({
        mensaje: "Servicio creado correctamente",
        servicio: nuevoServicio,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        mensaje: "Error al crear servicio",
        error: error.message,
      });
    }
  }
);

module.exports = router;
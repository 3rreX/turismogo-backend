const mongoose = require("mongoose");

const servicioSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true
  },
  descripcion: {
    type: String,
    required: true
  },
  precio: {
    type: Number,
    required: true
  },
  imagen: {
    type: String,
    required: false
  },
  imagenes: {
    type: [String],
    default: []
  },
  propietarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario",
    required: false
  },
  propietario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario",
    required: false
  }
});

module.exports = mongoose.models.Servicio || mongoose.model("Servicio", servicioSchema);

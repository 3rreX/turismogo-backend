const mongoose = require("mongoose");

const usuarioSchema = new mongoose.Schema(
  {
    nombreCompleto: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120,
    },

    telefono: {
      type: String,
      trim: true,
      default: "",
      maxlength: 30,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      index: true,
      match: [/^\S+@\S+\.\S+$/, "Email inválido"],
    },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 40,
      index: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    role: {
      type: String,
      enum: ["usuario", "propietario", "admin"],
      default: "usuario",
      index: true,
    },

    suscripcionActiva: {
      type: Boolean,
      default: false,
    },

    plan: {
      type: String,
      enum: ["ninguno", "basico", "pro", "premium"],
      default: "ninguno",
    },

    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Usuario || mongoose.model("Usuario", usuarioSchema);

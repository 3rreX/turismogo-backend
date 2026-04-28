require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const nodemailer = require('nodemailer');
const { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } = require('transbank-sdk');
const webpayTransaction = new WebpayPlus.Transaction(
  new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration
  )
);
const app = express();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
  api_key: process.env.CLOUDINARY_API_KEY?.trim(),
  api_secret: process.env.CLOUDINARY_API_SECRET?.trim()
});
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function enviarCorreo({ to, subject, html }) {
  try {
    if (!to) return;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html
    });
  } catch (error) {
    console.error('Error al enviar correo:', error);
  }
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen'));
    }
  }
});

function limpiarTexto(valor, max = 120) {
  if (typeof valor !== 'string') return '';
  return valor.trim().slice(0, max);
}

function esEmailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function esFechaValida(fecha) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha);
}

function esPrecioValido(precio) {
  const numero = Number(precio);
  return Number.isFinite(numero) && numero > 0;
}

function subirBufferACloudinary(fileBuffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'turismogo',
        resource_type: 'image'
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
  function limpiarTexto(valor, max = 120) {
  if (typeof valor !== 'string') return '';
  return valor.trim().slice(0, max);
}

function esEmailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function esFechaValida(fecha) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha);
}

function esPrecioValido(precio) {
  const numero = Number(precio);
  return Number.isFinite(numero) && numero > 0;
}
}
function obtenerPublicIdCloudinary(imagenUrl) {
  try {
    const url = new URL(imagenUrl);
    const partes = url.pathname.split('/');

    const uploadIndex = partes.indexOf('upload');
    const publicIdConExtension = partes.slice(uploadIndex + 2).join('/');

    return publicIdConExtension.replace(/\.[^/.]+$/, '');
  } catch (error) {
    return null;
  }
}

// Middlewares
app.use(helmet({
  crossOriginResourcePolicy: false
}));

app.use(express.json({
  limit: '10mb'
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,
  message: {
    error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(globalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 8,
  message: {
    error: 'Demasiados intentos de login. Intenta nuevamente más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(cors({
  origin: [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://turismogo-frontend.vercel.app',
  'https://www.turismogochile.com'
]
}));
// =========================
// MODELOS
// =========================

const usuarioSchema = new mongoose.Schema({
  nombreCompleto: {
  type: String,
  default: ''
},
telefono: {
  type: String,
  default: ''
},
email: {
  type: String,
  default: '',
  lowercase: true
},
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['usuario', 'propietario', 'admin'],
    default: 'usuario'
  },
  suscripcionActiva: {
    type: Boolean,
    default: false
  },
  plan: {
    type: String,
    enum: ['ninguno', 'basico', 'pro', 'premium'],
    default: 'ninguno'
  }
});
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
    ref: 'Usuario',
    required: false
  }
});
const reservaSchema = new mongoose.Schema({
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: false,
    default: null
  },

  servicioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Servicio',
    required: false
  },

  servicio: {
    type: String,
    required: true
  },

  fechaInicio: {
    type: String,
    required: true
  },

  fechaFin: {
    type: String,
    required: true
  },

  nombreCliente: {
    type: String,
    default: ''
  },

  emailCliente: {
    type: String,
    default: ''
  },

  telefonoCliente: {
    type: String,
    default: ''
  },

  personas: {
    type: String,
    default: ''
  },

  mensajeCliente: {
    type: String,
    default: ''
  },

  pagoEstado: {
  type: String,
  enum: ['pendiente', 'pagado', 'fallido'],
  default: 'pendiente'
  },

  montoPagado: {
  type: Number,
  default: 0
  },
  tokenPago: {
  type: String,
  default: ''
  },

  estado: {
    type: String,
    enum: ['pendiente', 'confirmada', 'rechazada', 'cancelada'],
    default: 'pendiente'
  }
});

const Reserva = mongoose.model('Reserva', reservaSchema);
  
const pagoSchema = new mongoose.Schema({
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  plan: {
    type: String,
    enum: ['basico', 'pro', 'premium'],
    required: true
  },
  monto: {
    type: Number,
    required: true
  },
  buyOrder: {
    type: String,
    required: true
  },
  sessionId: {
    type: String,
    required: true
  },
  token: {
    type: String
  },
  estado: {
    type: String,
    enum: ['pendiente', 'pagado', 'fallido'],
    default: 'pendiente'
  }
  
});

const Pago = mongoose.model('Pago', pagoSchema);

const Usuario = mongoose.model('Usuario', usuarioSchema);
const Servicio = mongoose.model('Servicio', servicioSchema);


// =========================
// MIDDLEWARE AUTH
// =========================

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: 'Token de autorización requerido'
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Formato de token inválido'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'Token no proporcionado'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.user = decoded;

    next();

  } catch (error) {
    console.error('Error de autenticación JWT:', error);

    return res.status(401).json({
      error: 'Token inválido o expirado'
    });
  }
}

function propietarioMiddleware(req, res, next) {
  if (req.user.role === 'propietario' || req.user.role === 'admin') {
    return next();
  }

  return res.status(403).json({ error: 'Acceso solo para propietarios o admin' });
}
function adminMiddleware(req, res, next) {
  if (req.user.role === 'admin') {
    return next();
  }

  return res.status(403).json({ error: 'Acceso solo para administradores' });
}

// =========================
// RUTAS
// =========================

app.get('/', (req, res) => {
  res.send('API funcionando');
});

// Registro
app.post('/api/register', async (req, res) => {
  try {
    const username = limpiarTexto(req.body.username, 60);
const password = limpiarTexto(req.body.password, 100);

    if (!username || !password) {
      return res.status(400).json({ error: 'Username y password son obligatorios' });
    }

    if (password.length < 6) {
  return res.status(400).json({
    error: 'La contraseña debe tener al menos 6 caracteres'
  });
}

    const existe = await Usuario.findOne({ username });

    if (existe) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const nuevoUsuario = new Usuario({
      username,
      password: hashedPassword
    });

    await nuevoUsuario.save();

    res.json({ message: 'Usuario registrado correctamente' });
  } catch (error) {
    console.error('Error en register:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.post('/api/register-propietario', async (req, res) => {
  try {
    const nombreCompleto = limpiarTexto(req.body.nombreCompleto, 100);
const telefono = limpiarTexto(req.body.telefono, 30);
const email = limpiarTexto(req.body.email, 100).toLowerCase();
const username = limpiarTexto(req.body.username, 60);
const password = limpiarTexto(req.body.password, 100);

    if (!nombreCompleto || !telefono || !email || !username || !password) {
      return res.status(400).json({
        error: 'Todos los campos son obligatorios'
      });
    }
    if (!esEmailValido(email)) {
  return res.status(400).json({
    error: 'Correo electrónico inválido'
  });
}

if (password.length < 6) {
  return res.status(400).json({
    error: 'La contraseña debe tener al menos 6 caracteres'
  });
}

    const existe = await Usuario.findOne({
      $or: [{ username }, { email }]
    });

    if (existe) {
      return res.status(400).json({
        error: 'El usuario o correo ya se encuentra registrado'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const nuevoUsuario = new Usuario({
      nombreCompleto,
      telefono,
      email,
      username,
      password: hashedPassword,
      role: 'propietario',
      suscripcionActiva: false,
      plan: 'ninguno'
    });

    await nuevoUsuario.save();

    res.json({
      message: 'Cuenta de propietario creada correctamente. Será redirigido al pago de suscripción.'
    });

  } catch (error) {
    console.error('Error en registro propietario:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});
// Login
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const username = limpiarTexto(req.body.username, 60);
const password = limpiarTexto(req.body.password, 100);

if (!username || !password) {
  return res.status(400).json({
    error: 'Usuario y contraseña son obligatorios'
  });
}

    const usuario = await Usuario.findOne({ username });

    if (!usuario) {
      return res.status(400).json({ error: 'Usuario no encontrado' });
    }

    const passwordValida = await bcrypt.compare(password, usuario.password);

    if (!passwordValida) {
      return res.status(400).json({ error: 'Contraseña incorrecta' });
    }

const token = jwt.sign(
  {
    id: usuario._id,
    username: usuario.username,
    role: usuario.role
  },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

    res.json({ token });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Perfil
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.user.id).select('-password');

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(usuario);
  } catch (error) {
    console.error('Error en profile:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Servicios
app.get('/api/servicios', async (req, res) => {
  try {
    const servicios = await Servicio.find();
    res.json(servicios);
  } catch (error) {
    console.error('Error al obtener servicios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/servicios', authMiddleware, propietarioMiddleware, upload.array('imagenes', 5), async (req, res) => {
  try {
        const usuarioActual = await Usuario.findById(req.user.id);

    if (usuarioActual.role === 'propietario' && !usuarioActual.suscripcionActiva) {
      return res.status(403).json({
        error: 'Debes tener una suscripción activa para publicar servicios'
      });
    }
    const nombre = limpiarTexto(req.body.nombre, 120);
const descripcion = limpiarTexto(req.body.descripcion, 800);
const precio = req.body.precio;

    if (!nombre || !descripcion || !precio) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    if (!esPrecioValido(precio)) {
  return res.status(400).json({
    error: 'Precio inválido'
  });
}

    if (!req.files || req.files.length === 0) {
  return res.status(400).json({ error: 'Debes subir al menos una imagen' });
}

const imagenesSubidas = [];

for (const file of req.files) {
  const resultado = await subirBufferACloudinary(file.buffer);
  imagenesSubidas.push(resultado.secure_url);
}
    const nuevoServicio = new Servicio({
  nombre,
  descripcion,
  precio: Number(precio),
  imagen: imagenesSubidas[0],
  imagenes: imagenesSubidas,
  propietarioId: req.user.id
});

    await nuevoServicio.save();

    res.json({
      message: 'Servicio creado correctamente',
      servicio: nuevoServicio
    });
  } catch (error) {
    console.error('Error al crear servicio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.get('/api/mis-servicios', authMiddleware, propietarioMiddleware, async (req, res) => {
  try {
    const servicios = await Servicio.find({ propietarioId: req.user.id });
    res.json(servicios);
  } catch (error) {
    console.error('Error al obtener mis servicios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.delete('/api/servicios/:id', authMiddleware, propietarioMiddleware, async (req, res) => {
  try {
    const servicio = await Servicio.findById(req.params.id);

    if (!servicio) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (
      servicio.propietarioId?.toString() !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: 'No puedes eliminar este servicio' });
    }

    await Servicio.findByIdAndDelete(req.params.id);

    res.json({ message: 'Servicio eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar servicio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.put('/api/servicios/:id', authMiddleware, propietarioMiddleware, upload.array('imagenes', 5), async (req, res) => {
  try {
    const servicio = await Servicio.findById(req.params.id);

    if (!servicio) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (
      servicio.propietarioId?.toString() !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: 'No puedes editar este servicio' });
    }

    const { nombre, descripcion, precio } = req.body;

    if (nombre) servicio.nombre = nombre;
    if (descripcion) servicio.descripcion = descripcion;
    if (precio) servicio.precio = Number(precio);

    if (req.files && req.files.length > 0) {
  const nuevasImagenes = [];

  for (const file of req.files) {
    const resultado = await subirBufferACloudinary(file.buffer);
    nuevasImagenes.push(resultado.secure_url);
  }

  servicio.imagenes = [...(servicio.imagenes || []), ...nuevasImagenes];

  if (!servicio.imagen) {
    servicio.imagen = nuevasImagenes[0];
  }
}

    await servicio.save();

    res.json({
      message: 'Servicio actualizado correctamente',
      servicio
    });
  } catch (error) {
    console.error('Error al editar servicio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.delete('/api/servicios/:id/imagenes', authMiddleware, propietarioMiddleware, async (req, res) => {
  try {
    const { imagenUrl } = req.body;

    if (!imagenUrl) {
      return res.status(400).json({ error: 'URL de imagen requerida' });
    }

    const servicio = await Servicio.findById(req.params.id);

    if (!servicio) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (
      servicio.propietarioId?.toString() !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: 'No puedes modificar este servicio' });
    }
    const publicId = obtenerPublicIdCloudinary(imagenUrl);

    if (publicId) {
    await cloudinary.uploader.destroy(publicId);
    }

    servicio.imagenes = (servicio.imagenes || []).filter(img => img !== imagenUrl);

    if (servicio.imagen === imagenUrl) {
      servicio.imagen = servicio.imagenes[0] || '';
    }

    await servicio.save();

    res.json({
      message: 'Imagen eliminada correctamente',
      servicio
    });
  } catch (error) {
    console.error('Error al eliminar imagen:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
// Crear reserva
app.post('/api/reservas', authMiddleware, async (req, res) => {
  try {
    const { servicio, fechaInicio, fechaFin } = req.body;

    if (!servicio || !fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const conflicto = await Reserva.findOne({
      servicio,
      $or: [
        {
          fechaInicio: { $lte: fechaFin },
          fechaFin: { $gte: fechaInicio }
        }
      ]
    });

    if (conflicto) {
      return res.status(400).json({ error: 'Ese servicio ya está reservado en esas fechas' });
    }

    const servicioEncontrado = await Servicio.findOne({ nombre: servicio });

if (!servicioEncontrado) {
  return res.status(404).json({ error: 'Servicio no encontrado' });
}

const nuevaReserva = new Reserva({
  usuarioId: req.user.id,
  servicioId: servicioEncontrado._id,
  servicio,
  fechaInicio,
  fechaFin,
  estado: 'pendiente'
});

    await nuevaReserva.save();

    res.json({ message: 'Reserva creada correctamente' });
  } catch (error) {
    console.error('Error al crear reserva:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Listar reservas del usuario
app.get('/api/reservas', authMiddleware, async (req, res) => {
  try {
    const reservas = await Reserva.find({ usuarioId: req.user.id });
    res.json(reservas);
  } catch (error) {
    console.error('Error al obtener reservas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.get('/api/reservas-propietario', authMiddleware, propietarioMiddleware, async (req, res) => {
  try {
    const serviciosDelPropietario = await Servicio.find({
      propietarioId: req.user.id
    }).select('_id');

    const idsServicios = serviciosDelPropietario.map(s => s._id);

    const reservas = await Reserva.find({
      servicioId: { $in: idsServicios }
    })
      .populate('usuarioId', 'username')
      .populate('servicioId', 'nombre precio imagen');

    res.json(reservas);
  } catch (error) {
    console.error('Error al obtener reservas del propietario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.put('/api/reservas/:id/cancelar', authMiddleware, async (req, res) => {
  try {
    const reserva = await Reserva.findById(req.params.id);

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (reserva.usuarioId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'No puedes cancelar esta reserva' });
    }

    if (reserva.estado === 'cancelada') {
      return res.status(400).json({ error: 'La reserva ya está cancelada' });
    }

    reserva.estado = 'cancelada';
    await reserva.save();

    res.json({
      message: 'Reserva cancelada correctamente',
      reserva
    });
  } catch (error) {
    console.error('Error al cancelar reserva:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.put('/api/reservas/:id/estado', authMiddleware, propietarioMiddleware, async (req, res) => {
  try {
    const { estado } = req.body;

    if (!['confirmada', 'rechazada', 'cancelada'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const reserva = await Reserva.findById(req.params.id).populate('servicioId');

    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (
      reserva.servicioId?.propietarioId?.toString() !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: 'No puedes modificar esta reserva' });
    }

    reserva.estado = estado;
    await reserva.save();

    res.json({
      message: 'Estado de reserva actualizado',
      reserva
    });
  } catch (error) {
    console.error('Error al actualizar estado de reserva:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.get('/api/admin/usuarios', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const usuarios = await Usuario.find().select('-password');
    res.json(usuarios);
  } catch (error) {
    console.error('Error admin usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.get('/api/admin/servicios', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const servicios = await Servicio.find().populate('propietarioId', 'username role');
    res.json(servicios);
  } catch (error) {
    console.error('Error admin servicios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.get('/api/admin/reservas', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const reservas = await Reserva.find()
      .populate('usuarioId', 'username role')
      .populate('servicioId', 'nombre precio propietarioId');

    res.json(reservas);
  } catch (error) {
    console.error('Error admin reservas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.put('/api/admin/usuarios/:id/role', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { role } = req.body;

    if (!['usuario', 'propietario', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const usuario = await Usuario.findById(req.params.id).select('-password');

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    usuario.role = role;
    await usuario.save();

    res.json({
      message: 'Rol actualizado correctamente',
      usuario
    });
  } catch (error) {
    console.error('Error al actualizar rol:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.put('/api/admin/usuarios/:id/suscripcion', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { suscripcionActiva, plan } = req.body;

    const usuario = await Usuario.findById(req.params.id).select('-password');

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    usuario.suscripcionActiva = Boolean(suscripcionActiva);
    usuario.plan = plan || (suscripcionActiva ? 'basico' : 'ninguno');

    await usuario.save();

    res.json({
      message: 'Suscripción actualizada correctamente',
      usuario
    });
  } catch (error) {
    console.error('Error al actualizar suscripción:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.put('/api/mi-suscripcion', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!['basico', 'pro', 'premium'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido' });
    }

    const usuario = await Usuario.findById(req.user.id).select('-password');

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (usuario.role !== 'propietario' && usuario.role !== 'admin') {
      return res.status(403).json({ error: 'Solo propietarios pueden activar suscripción' });
    }

    usuario.suscripcionActiva = true;
    usuario.plan = plan;

    await usuario.save();

    res.json({
      message: 'Suscripción activada correctamente',
      usuario
    });
  } catch (error) {
    console.error('Error al activar mi suscripción:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.post('/api/webpay/crear', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;

    const precios = {
      basico: 9990,
      pro: 19990,
      premium: 39990
    };

    if (!precios[plan]) {
      return res.status(400).json({ error: 'Plan inválido' });
    }

    const usuario = await Usuario.findById(req.user.id);

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (usuario.role !== 'propietario' && usuario.role !== 'admin') {
      return res.status(403).json({ error: 'Solo propietarios pueden pagar suscripción' });
    }

    const buyOrder = `orden-${Date.now()}`;
    const sessionId = `sesion-${req.user.id}-${Date.now()}`;
    const amount = precios[plan];
    const returnUrl = process.env.WEBPAY_RETURN_URL;

    const response = await webpayTransaction.create(
      buyOrder,
      sessionId,
      amount,
      returnUrl
    );

    await Pago.create({
      usuarioId: req.user.id,
      plan,
      monto: amount,
      buyOrder,
      sessionId,
      token: response.token,
      estado: 'pendiente'
    });

    res.json({
      url: response.url,
      token: response.token
    });

  } catch (error) {
    console.error('Error al crear pago Webpay:', error);
    res.status(500).json({ error: 'Error al crear pago Webpay' });
  }
});
app.post('/api/webpay/retorno', async (req, res) => {
  try {
    const token = req.body.token_ws;

    if (!token) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?pago=cancelado`);
    }

    const commitResponse = await webpayTransaction.commit(token);

    const pago = await Pago.findOne({ token });

    if (!pago) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?pago=error`);
    }

    if (commitResponse.status === 'AUTHORIZED') {
      pago.estado = 'pagado';
      await pago.save();

      const usuario = await Usuario.findById(pago.usuarioId);

      if (usuario) {
        usuario.suscripcionActiva = true;
        usuario.plan = pago.plan;
        await usuario.save();
      }

      return res.redirect(
        `${process.env.FRONTEND_URL}/dashboard.html?pago=exitoso&plan=${pago.plan}`
      );
    }

    pago.estado = 'fallido';
    await pago.save();

    return res.redirect(
      `${process.env.FRONTEND_URL}/dashboard.html?pago=fallido`
    );

  } catch (error) {
    console.error('Error retorno Webpay:', error);
    return res.redirect(
      `${process.env.FRONTEND_URL}/dashboard.html?pago=error`
    );
  }
});
app.get('/api/servicios/:id/publico', async (req, res) => {
  try {
    const servicio = await Servicio.findById(req.params.id)
      .populate('propietarioId', 'username role suscripcionActiva plan');

    if (!servicio) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (
      servicio.propietarioId &&
      servicio.propietarioId.role === 'propietario' &&
      !servicio.propietarioId.suscripcionActiva
    ) {
      return res.status(403).json({ error: 'Este servicio no está disponible actualmente' });
    }

    res.json(servicio);
  } catch (error) {
    console.error('Error al obtener detalle público:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.post('/api/reserva-publica', async (req, res) => {
  try {
    const {
  servicioId,
  fechaInicio,
  fechaFin,
  personas,
  nombreCliente,
  emailCliente,
  telefonoCliente,
  mensajeCliente
} = req.body;

    if (!servicioId || !fechaInicio || !fechaFin || !nombreCliente || !emailCliente) {
  return res.status(400).json({
    error: 'Nombre, correo, fechas y servicio son obligatorios'
  });
}

    const servicio = await Servicio.findById(servicioId);

    if (!servicio) {
      return res.status(404).json({
        error: 'Servicio no encontrado'
      });
    }

    const nuevaReserva = new Reserva({
      usuarioId: null,
      servicio: servicio.nombre,
      servicioId: servicio._id,
      fechaInicio,
      fechaFin,
      nombreCliente,
      emailCliente,
      telefonoCliente,
      personas,
      mensajeCliente,
      estado: 'pendiente'
    });

    await nuevaReserva.save();

    res.json({
      message: 'Reserva registrada correctamente',
      reserva: nuevaReserva
    });

   } catch (error) {
    console.error('Error en reserva pública:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});
  app.post('/api/reserva-publica/pagar', async (req, res) => {
  try {
    const servicioId = limpiarTexto(req.body.servicioId, 80);
    const fechaInicio = limpiarTexto(req.body.fechaInicio, 20);
    const fechaFin = limpiarTexto(req.body.fechaFin, 20);
    const personas = limpiarTexto(req.body.personas, 30);
    const nombreCliente = limpiarTexto(req.body.nombreCliente, 100);
    const emailCliente = limpiarTexto(req.body.emailCliente, 100).toLowerCase();
    const telefonoCliente = limpiarTexto(req.body.telefonoCliente, 30);
    const mensajeCliente = limpiarTexto(req.body.mensajeCliente, 500);

    if (!servicioId || !fechaInicio || !fechaFin || !nombreCliente || !emailCliente) {
      return res.status(400).json({
        error: 'Faltan datos obligatorios para la reserva'
      });
    }

    if (!esEmailValido(emailCliente)) {
  return res.status(400).json({
    error: 'Correo electrónico inválido'
  });
}

if (!esFechaValida(fechaInicio) || !esFechaValida(fechaFin)) {
  return res.status(400).json({
    error: 'Formato de fecha inválido'
  });
}

if (fechaFin < fechaInicio) {
  return res.status(400).json({
    error: 'La fecha final no puede ser menor a la fecha inicial'
  });
}

    const servicio = await Servicio.findById(servicioId);

    if (!servicio) {
      return res.status(404).json({
        error: 'Servicio no encontrado'
      });
    }

    const nuevaReserva = new Reserva({
      usuarioId: null,
      servicioId: servicio._id,
      servicio: servicio.nombre,
      fechaInicio,
      fechaFin,
      personas,
      nombreCliente,
      emailCliente,
      telefonoCliente,
      mensajeCliente,
      montoPagado: servicio.precio,
      pagoEstado: 'pendiente',
      estado: 'pendiente'
    });

    await nuevaReserva.save();
    await enviarCorreo({
  to: emailCliente,
  subject: 'Solicitud de reserva recibida - TurismoGO',
  html: `
    <h2>Reserva recibida correctamente</h2>
    <p>Hola ${nombreCliente},</p>
    <p>Tu solicitud de reserva para <strong>${servicio.nombre}</strong> fue registrada exitosamente.</p>
    <p><strong>Fechas:</strong> ${fechaInicio} al ${fechaFin}</p>
    <p><strong>Personas:</strong> ${personas || 'No informado'}</p>
    <p>Ahora debes completar el pago para confirmar definitivamente tu reserva.</p>
    <br>
    <p>Equipo TurismoGO</p>
  `
});

  await enviarCorreo({
  to: process.env.EMAIL_USER,
  subject: 'Nueva reserva recibida - TurismoGO',
  html: `
    <h2>Nueva reserva registrada</h2>
    <p><strong>Cliente:</strong> ${nombreCliente}</p>
    <p><strong>Email:</strong> ${emailCliente}</p>
    <p><strong>Teléfono:</strong> ${telefonoCliente || 'No informado'}</p>
    <p><strong>Servicio:</strong> ${servicio.nombre}</p>
    <p><strong>Fechas:</strong> ${fechaInicio} al ${fechaFin}</p>
    <p><strong>Personas:</strong> ${personas}</p>
    <p><strong>Mensaje:</strong> ${mensajeCliente || 'Sin mensaje adicional'}</p>
  `
});

    const buyOrder = `reserva-${Date.now()}`;
    const sessionId = `publica-${nuevaReserva._id}`;
    const amount = Number(servicio.precio);
    const returnUrl = process.env.WEBPAY_RETURN_URL;

    const response = await webpayTransaction.create(
      buyOrder,
      sessionId,
      amount,
      returnUrl
    );

    nuevaReserva.tokenPago = response.token;
    await nuevaReserva.save();

    res.json({
      url: response.url,
      token: response.token
    });

  } catch (error) {
    console.error('Error pago reserva pública:', error);
    res.status(500).json({
      error: 'No fue posible iniciar el pago'
    });
  }
});
app.post('/api/reserva-publica/retorno', async (req, res) => {
  try {
    const token = req.body.token_ws;

    if (!token) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=cancelado`
      );
    }

    const commitResponse = await webpayTransaction.commit(token);

    const reserva = await Reserva.findOne({
      tokenPago: token
    });

    if (!reserva) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=error`
      );
    }

    if (commitResponse.status === 'AUTHORIZED') {
      reserva.pagoEstado = 'pagado';
      reserva.estado = 'confirmada';
      reserva.montoPagado =
        commitResponse.amount || reserva.montoPagado;

      await reserva.save();
      await enviarCorreo({
  to: reserva.emailCliente,
  subject: 'Reserva confirmada - TurismoGO',
  html: `
    <h2>¡Tu reserva fue confirmada!</h2>
    <p>Hola ${reserva.nombreCliente},</p>
    <p>El pago de tu reserva para <strong>${reserva.servicio}</strong> fue aprobado correctamente.</p>
    <p><strong>Fechas:</strong> ${reserva.fechaInicio} al ${reserva.fechaFin}</p>
    <p><strong>Personas:</strong> ${reserva.personas || 'No informado'}</p>
    <p><strong>Estado:</strong> Confirmada</p>
    <br>
    <p>Gracias por confiar en TurismoGO.</p>
    <p>Equipo TurismoGO</p>
  `
});

      return res.redirect(
        `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=exitoso`
      );
    }

    reserva.pagoEstado = 'fallido';
    await reserva.save();

    return res.redirect(
      `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=fallido`
    );

  } catch (error) {
    console.error(
      'Error retorno pago reserva pública:',
      error
    );

    return res.redirect(
      `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=error`
    );
  }
});

// =========================
// CONEXIÓN MONGODB + SERVER
// =========================

const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ Conectado a MongoDB');
        const adminExistente = await Usuario.findOne({ username: 'admin' });

    if (adminExistente) {
      adminExistente.role = 'admin';
      await adminExistente.save();
      console.log('✅ Usuario admin actualizado a role admin');
    }

    const propietarioExistente = await Usuario.findOne({ username: 'propietario1' });

    if (!propietarioExistente) {
      const hashedPasswordProp = await bcrypt.hash('1234', 10);

      await Usuario.create({
        username: 'propietario1',
        password: hashedPasswordProp,
        role: 'propietario'
      });

      console.log('✅ Usuario propietario1 creado');
    }

    const existeAdmin = await Usuario.findOne({ username: 'admin' });

    if (!existeAdmin) {
      const hashedPassword = await bcrypt.hash('1234', 10);

      await Usuario.create({
        username: 'admin',
        password: hashedPassword
      });

      console.log('✅ Usuario admin creado');
    }

    // Cargar servicios iniciales si la colección está vacía
    const totalServicios = await Servicio.countDocuments();

    if (totalServicios === 0) {
      await Servicio.insertMany([
        {
          nombre: 'Cabaña en Puerto Natales',
          descripcion: 'Alojamiento cómodo con vista panorámica.',
          precio: 65000,
          imagen: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85'
        },
        {
          nombre: 'Arriendo de Jeep 4x4',
          descripcion: 'Vehículo ideal para rutas turísticas y aventura.',
          precio: 90000,
          imagen: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70'
        },
        {
          nombre: 'Tour Glaciar',
          descripcion: 'Excursión guiada de día completo.',
          precio: 45000,
          imagen: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b'
        }
      ]);

      console.log('✅ Servicios de prueba insertados');
    }

    app.listen(PORT, () => {
      console.log(`🚀 Servidor en http://localhost:${PORT}`);
    });
  })
  .catch(err => console.error('❌ Error MongoDB:', err));

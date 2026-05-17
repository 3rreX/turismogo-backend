require('dotenv').config();
// =========================
// VALIDACIÓN VARIABLES ENTORNO
// =========================

const requiredEnv = [
  'NODE_ENV',
  'MONGO_URI',
  'JWT_SECRET',
  'FRONTEND_URL',

  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',

  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',

  'WEBPAY_PLAN_RETURN_URL',
  'WEBPAY_RESERVA_RETURN_URL'
];

const missingEnv = requiredEnv.filter(env => !process.env[env]);

if (missingEnv.length > 0) {
  console.error('❌ FALTAN VARIABLES DE ENTORNO CRÍTICAS:');
  missingEnv.forEach(env => console.error(`- ${env}`));

  console.error('\n⚠️ El servidor no se iniciará por seguridad.\n');
  process.exit(1);
}
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
const { fileTypeFromBuffer } = require('file-type');
const { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } = require('transbank-sdk');
const sanitizeHtml = require('sanitize-html');
const Usuario = require("./models/Usuario");
const Servicio = require("./models/Servicio");
const serviciosRoutes = require("./routes/servicios");
const mongoSanitize = require("express-mongo-sanitize");
const hpp = require("hpp");
const compression = require("compression");
const morgan = require("morgan");
const isProduction = process.env.NODE_ENV === 'production';


const webpayTransaction = new WebpayPlus.Transaction(
  new Options(
    isProduction
      ? process.env.WEBPAY_COMMERCE_CODE
      : IntegrationCommerceCodes.WEBPAY_PLUS,
    isProduction
      ? process.env.WEBPAY_API_KEY
      : IntegrationApiKeys.WEBPAY,
    isProduction
      ? Environment.Production
      : Environment.Integration
  )
);
const app = express();
app.set("trust proxy", 1);

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

app.use(compression());
// app.use(mongoSanitize());
app.use(hpp());
app.set('trust proxy', 1);
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
  api_key: process.env.CLOUDINARY_API_KEY?.trim(),
  api_secret: process.env.CLOUDINARY_API_SECRET?.trim()
});
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000
});

async function enviarCorreo({ to, subject, html }) {
  try {
    if (!to) {
      console.warn('Correo no enviado: destinatario vacío');
      return;
    }

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html
    });

    console.log('Correo enviado correctamente:', {
      to,
      subject,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected
    });

  } catch (error) {
    console.error('Error al enviar correo:', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response
    });
  }
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen'));
    }
  }
});

function bloquearOperadoresMongo(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
      continue;
    }

    if (typeof obj[key] === 'object') {
      bloquearOperadoresMongo(obj[key]);
    }
  }

  return obj;
}

function mongoSanitizeManual(req, res, next) {
  if (req.body) bloquearOperadoresMongo(req.body);
  if (req.params) bloquearOperadoresMongo(req.params);

  next();
}
function limpiarTexto(valor, max = 120) {
  if (typeof valor !== 'string') return '';

  const textoLimpio = sanitizeHtml(valor, {
    allowedTags: [],
    allowedAttributes: {}
  });

  return textoLimpio.trim().slice(0, max);
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

function obtenerPorcentajeComision(plan) {
  const comisiones = {
    basico: 10,
    pro: 8,
    premium: 6,
    ninguno: 10
  };

  return comisiones[plan] || 10;
}

function calcularComisionTurismoGO(monto, plan) {
  const montoNumerico = Number(monto);
  const porcentaje = obtenerPorcentajeComision(plan);

  const comision = Math.round((montoNumerico * porcentaje) / 100);
  const montoPropietario = montoNumerico - comision;

  return {
    porcentaje,
    comision,
    montoPropietario
  };
}

async function validarImagenReal(fileBuffer) {
  const tipoArchivo = await fileTypeFromBuffer(fileBuffer);

  if (!tipoArchivo) {
    throw new Error('No se pudo validar el tipo de archivo');
  }

  const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp'];

  if (!tiposPermitidos.includes(tipoArchivo.mime)) {
    throw new Error('Formato de imagen no permitido. Usa JPG, PNG o WEBP');
  }

  return true;
}
function subirBufferACloudinary(fileBuffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
   {
  folder: 'turismogo',
  resource_type: 'image',
  transformation: [
    {
      width: 1600,
      height: 1200,
      crop: 'limit',
      quality: 'auto',
      fetch_format: 'auto'
    }
  ]
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
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
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": [
        "'self'",
        "data:",
        "https://res.cloudinary.com",
        "https://placehold.co"
      ],
      "script-src": [
        "'self'",
        "https://cdn.jsdelivr.net"
      ],
      "style-src": [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com"
      ],
      "font-src": [
        "'self'",
        "https://fonts.gstatic.com"
      ],
      "connect-src": [
        "'self'",
        "https://www.turismogochile.com",
        "https://turismogochile.com",
        "https://turismogo-frontend.vercel.app"
      ],
      "frame-src": [
        "'self'",
        "https://webpay3g.transbank.cl",
        "https://webpay3gint.transbank.cl"
      ],
      "form-action": [
        "'self'",
        "https://webpay3g.transbank.cl",
        "https://webpay3gint.transbank.cl"
      ]
    }
  }
}));

app.use(express.json({
  limit: '1mb'
}));

app.use(mongoSanitizeManual);

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,
  message: {
    error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const webpayLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 10,
  message: {
    error: 'Demasiadas solicitudes de pago. Intenta nuevamente más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(globalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  message: {
    error: 'Demasiados intentos de login. Intenta nuevamente más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  message: {
    error: 'Demasiados registros desde esta IP. Intenta más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const publicActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5,
  message: {
    error: 'Demasiados registros desde esta IP. Intenta más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://turismogochile.com',
  'https://www.turismogochile.com',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {

    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.error('CORS bloqueado para:', origin);

    return callback(new Error('Origen no permitido por CORS'));
  },

  methods: ['GET', 'POST', 'PUT', 'DELETE'],

  allowedHeaders: [
    'Content-Type',
    'Authorization'
  ],

  credentials: true
}));

app.use("/api/servicios", serviciosRoutes);
// =========================
// MODELOS
// =========================

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
  type: Date,
  required: true,
  index: true
},

fechaFin: {
  type: Date,
  required: true,
  index: true
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

  comisionPorcentaje: {
  type: Number,
  default: 0
},

comisionTurismoGO: {
  type: Number,
  default: 0
},

montoPropietario: {
  type: Number,
  default: 0
},

  estado: {
  type: String,
  enum: ['pendiente', 'pendiente_pago', 'confirmada', 'rechazada', 'cancelada', 'expirada', 'reembolsada'],
  default: 'pendiente_pago',
  index: true
  
}}, {
  timestamps: true
});

const Reserva = mongoose.model('Reserva', reservaSchema);

const mensajeSchema = new mongoose.Schema({
  servicioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Servicio',
    required: true
  },
  propietarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  nombreCliente: {
    type: String,
    required: true
  },
  emailCliente: {
    type: String,
    required: true
  },
  mensaje: {
    type: String,
    required: true
  },
  estado: {
    type: String,
    enum: ['nuevo', 'respondido', 'cerrado'],
    default: 'nuevo'
  },
  fecha: {
    type: Date,
    default: Date.now
  }
});

const Mensaje = mongoose.model('Mensaje', mensajeSchema);
  
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

const Pago = mongoose.models.Pago || mongoose.model('Pago', pagoSchema);

const auditoriaSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  accion: {
    type: String,
    required: true
  },
  entidad: {
    type: String,
    required: true
  },
  entidadId: {
    type: String,
    default: ''
  },
  detalle: {
    type: String,
    default: ''
  },
  fecha: {
    type: Date,
    default: Date.now
  }
});

const Auditoria = mongoose.model('Auditoria', auditoriaSchema);


// =========================
// MIDDLEWARE AUTH
// =========================

async function authMiddleware(req, res, next) {
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

    const usuario = await Usuario.findById(decoded.id);

if (!usuario) {
  return res.status(401).json({ error: 'Usuario no válido' });
}

if (usuario.tokenVersion !== decoded.tokenVersion) {
  return res.status(401).json({
    error: 'Sesión inválida, vuelve a iniciar sesión'
  });
}

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
async function registrarAuditoria({ req, accion, entidad, entidadId = '', detalle = '' }) {
  try {
    if (!req.user || !req.user.id) return;

    await Auditoria.create({
      adminId: req.user.id,
      accion,
      entidad,
      entidadId,
      detalle
    });
  } catch (error) {
    console.error('Error registrando auditoría:', error);
  }
}
// =========================
// RUTAS
// =========================

app.get('/', (req, res) => {
  res.send('API funcionando');
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TurismoGO API',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Registro
app.post('/api/register', registerLimiter, async (req, res) => {
  try {
    const username = limpiarTexto(req.body.username, 60).toLowerCase();
    const password = limpiarTexto(req.body.password, 100);

    if (!username || !password) {
      return res.status(400).json({ error: 'Username y password son obligatorios' });
    }

    if (password.length < 8) {
  return res.status(400).json({
    error: 'La contraseña debe tener al menos 8 caracteres'
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
app.post('/api/register-propietario', registerLimiter, async (req, res) => {
  try {
    const nombreCompleto = limpiarTexto(req.body.nombreCompleto, 100);
const telefono = limpiarTexto(req.body.telefono, 30);
const email = limpiarTexto(req.body.email, 100).toLowerCase();
const username = limpiarTexto(req.body.username, 60).toLowerCase();
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

if (password.length < 8) {
  return res.status(400).json({
    error: 'La contraseña debe tener al menos 8 caracteres'
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
   const username = limpiarTexto(req.body.username, 60).toLowerCase();
const password = limpiarTexto(req.body.password, 100);

if (!username || !password) {
  return res.status(400).json({
    error: 'Credenciales inválidas'
  });
}

const usuario = await Usuario.findOne({ username }).select("+password");

   if (!usuario) {
  await new Promise(r => setTimeout(r, 500));
  return res.status(400).json({ error: 'Credenciales inválidas' });
}

const passwordValida = await bcrypt.compare(password, usuario.password);

if (!passwordValida) {
  await new Promise(r => setTimeout(r, 500));
  return res.status(400).json({ error: 'Credenciales inválidas' });
}

const token = jwt.sign(
  {
    id: usuario._id,
    username: usuario.username,
    role: usuario.role,
    tokenVersion: usuario.tokenVersion
  },
  process.env.JWT_SECRET,
  { expiresIn: '4h' }
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
    const limite = Math.min(Number(req.query.limit) || 24, 50);

    const servicios = await Servicio.find()
      .select('nombre descripcion precio imagen imagenes propietarioId')
      .populate('propietarioId', 'username role suscripcionActiva plan')
      .sort({ _id: -1 })
      .limit(limite)
      .lean();

    const serviciosDisponibles = servicios.filter(servicio => {
      if (!servicio.propietarioId) return false;

      if (
        servicio.propietarioId.role === 'propietario' &&
        !servicio.propietarioId.suscripcionActiva
      ) {
        return false;
      }

      return true;
    });

    res.json(serviciosDisponibles);
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
  await validarImagenReal(file.buffer);

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

   const nombre = limpiarTexto(req.body.nombre, 120);
const descripcion = limpiarTexto(req.body.descripcion, 800);
const precio = req.body.precio;

if (nombre) {
  servicio.nombre = nombre;
}

if (descripcion) {
  servicio.descripcion = descripcion;
}

if (precio !== undefined && precio !== null && precio !== '') {
  if (!esPrecioValido(precio)) {
    return res.status(400).json({
      error: 'Precio inválido'
    });
  }

  servicio.precio = Number(precio);
}

    if (req.files && req.files.length > 0) {

  const nuevasImagenes = [];

  for (const file of req.files) {
  await validarImagenReal(file.buffer);

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
  return res.status(400).json({
    error: 'Servicio, fecha de inicio y fecha final son obligatorios'
  });
}

if (!esFechaValida(fechaInicio) || !esFechaValida(fechaFin)) {
  return res.status(400).json({
    error: 'Formato de fecha inválido'
  });
}

const inicio = new Date(fechaInicio);
const fin = new Date(fechaFin);

if (fin < inicio) {
  return res.status(400).json({
    error: 'La fecha final no puede ser menor a la fecha inicial'
  });
}

    const conflicto = await Reserva.findOne({
  servicio,
  estado: { $in: ['confirmada'] },
  fechaInicio: { $lte: fin },
  fechaFin: { $gte: inicio }
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
  fechaInicio: inicio,
  fechaFin: fin,
  estado: 'pendiente_pago'
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

app.get('/api/mensajes-propietario', authMiddleware, propietarioMiddleware, async (req, res) => {
  try {
    const mensajes = await Mensaje.find({
      propietarioId: req.user.id
    })
      .populate('servicioId', 'nombre precio imagen')
      .sort({ fecha: -1 });

    res.json(mensajes);

  } catch (error) {
    console.error('Error al obtener mensajes del propietario:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
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
app.get('/api/admin/auditoria', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const registros = await Auditoria.find()
      .populate('adminId', 'username role')
      .sort({ fecha: -1 })
      .limit(100);

    res.json(registros);
  } catch (error) {
    console.error('Error obteniendo auditoría:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
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
    await registrarAuditoria({
  req,
  accion: 'CAMBIO_ROL_USUARIO',
  entidad: 'Usuario',
  entidadId: usuario._id.toString(),
  detalle: `Usuario ${usuario.username} cambiado a rol ${role}`
});

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
    const planesValidos = ['ninguno', 'basico', 'pro', 'premium'];

if (!planesValidos.includes(plan)) {
  return res.status(400).json({
    error: 'Plan inválido'
  });
}

    const usuario = await Usuario.findById(req.params.id).select('-password');

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    usuario.suscripcionActiva = Boolean(suscripcionActiva);
    usuario.plan = plan || (suscripcionActiva ? 'basico' : 'ninguno');

    await usuario.save();
    await registrarAuditoria({
  req,
  accion: 'CAMBIO_SUSCRIPCION_USUARIO',
  entidad: 'Usuario',
  entidadId: usuario._id.toString(),
  detalle: `Suscripción de ${usuario.username}: ${usuario.suscripcionActiva ? 'activa' : 'inactiva'} - plan ${usuario.plan}`
});

    res.json({
      message: 'Suscripción actualizada correctamente',
      usuario
    });
  } catch (error) {
    console.error('Error al actualizar suscripción:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.delete('/api/admin/usuarios/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const usuarioId = req.params.id;

    // Evitar que el admin se elimine a sí mismo
    if (usuarioId === req.user.id) {
      return res.status(400).json({
        error: 'No puedes eliminar tu propia cuenta de administrador'
      });
    }

    const usuario = await Usuario.findById(usuarioId);

    if (!usuario) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    // Eliminar servicios asociados
    await Servicio.deleteMany({
      propietarioId: usuarioId
    });

    // No eliminamos reservas históricas para no romper reportes
    // Solo quitamos la referencia del usuario si existe
    await Reserva.updateMany(
      { usuarioId: usuarioId },
      {
        $set: {
          usuarioId: null
        }
      }
    );
    await registrarAuditoria({
  req,
  accion: 'ELIMINACION_USUARIO',
  entidad: 'Usuario',
  entidadId: usuario._id.toString(),
  detalle: `Usuario eliminado: ${usuario.username}`
});

    await Usuario.findByIdAndDelete(usuarioId);

    res.json({
      message: 'Usuario eliminado correctamente'
    });

  } catch (error) {
    console.error('Error al eliminar usuario:', error);

    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});
app.put('/api/mi-suscripcion', authMiddleware, adminMiddleware, async (req, res) => {
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
  return res.status(403).json({
    error: 'Solo se puede activar suscripción a propietarios o administradores'
  });
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
app.post('/api/webpay/crear', webpayLimiter, authMiddleware, async (req, res) => {
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
    const returnUrl = process.env.WEBPAY_PLAN_RETURN_URL;

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
app.get('/api/webpay/retorno', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'production') {
  console.log('GET RETORNO PLAN QUERY:', req.query);
}
    const token = req.query.token_ws;

    if (!token) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?pago=cancelado`);
    }

    const commitResponse = await webpayTransaction.commit(token);

    if (process.env.NODE_ENV !== 'production') {
  console.log('RESPUESTA WEBPAY PLAN GET:', commitResponse);
}

    const pago = await Pago.findOne({ token });

    if (!pago) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?pago=error`);
    }

    if (
      commitResponse.status === 'AUTHORIZED' &&
      commitResponse.response_code === 0
    ) {
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

    return res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?pago=fallido`);

  } catch (error) {
    console.error('Error retorno GET Webpay plan:', error);

    return res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?pago=error`);
  }
});
app.post('/api/webpay/retorno', async (req, res) => {
  try {
    const token = req.body.token_ws;

    if (!token) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?pago=cancelado`);
    }

    const commitResponse = await webpayTransaction.commit(token);
    if (process.env.NODE_ENV !== 'production') {
  console.log('RESPUESTA WEBPAY PLAN:', commitResponse);
}

    const pago = await Pago.findOne({ token });

    if (!pago) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?pago=error`);
    }

    if (
  commitResponse.status === 'AUTHORIZED' &&
  commitResponse.response_code === 0
) { 
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

app.post('/api/servicios/:id/mensajes', messageLimiter, async (req, res) => {
  try {
    const servicio = await Servicio.findById(req.params.id);

    if (!servicio) {
      return res.status(404).json({
        error: 'Servicio no encontrado'
      });
    }

    if (!servicio.propietarioId) {
      return res.status(400).json({
        error: 'Este servicio no tiene propietario asignado'
      });
    }

    const nombreCliente = limpiarTexto(req.body.nombreCliente, 100);
    const emailCliente = limpiarTexto(req.body.emailCliente, 100).toLowerCase();
    const mensajeTexto = limpiarTexto(req.body.mensaje, 800);

    if (!nombreCliente || !emailCliente || !mensajeTexto) {
      return res.status(400).json({
        error: 'Nombre, correo y mensaje son obligatorios'
      });
    }

    if (!esEmailValido(emailCliente)) {
      return res.status(400).json({
        error: 'Correo electrónico inválido'
      });
    }

    const nuevoMensaje = await Mensaje.create({
      servicioId: servicio._id,
      propietarioId: servicio.propietarioId,
      nombreCliente,
      emailCliente,
      mensaje: mensajeTexto
    });

    res.json({
      message: 'Mensaje enviado correctamente',
      mensaje: nuevoMensaje
    });

  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

  app.post('/api/reserva-publica/pagar', webpayLimiter, publicActionLimiter, async (req, res) => {
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

const inicio = new Date(fechaInicio);
const fin = new Date(fechaFin);

if (fin < inicio) {
  return res.status(400).json({
    error: 'La fecha final no puede ser menor a la fecha inicial'
  });
}

    const servicio = await Servicio.findById(servicioId)
  .populate('propietarioId', 'username role suscripcionActiva plan');

    if (!servicio) {
      return res.status(404).json({
        error: 'Servicio no encontrado'
      });
    }

    const conflicto = await Reserva.findOne({
  servicioId: servicio._id,
  estado: { $in: ['confirmada'] },
  fechaInicio: { $lte: fechaFin },
  fechaFin: { $gte: fechaInicio }
});

if (conflicto) {
  return res.status(400).json({
    error: 'Este servicio ya está reservado en las fechas seleccionadas'
  });
}

const calculoComision = calcularComisionTurismoGO(
  servicio.precio,
  servicio.propietarioId?.plan || 'ninguno'
);

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
      comisionPorcentaje: calculoComision.porcentaje,
      comisionTurismoGO: calculoComision.comision,
      montoPropietario: calculoComision.montoPropietario,
      pagoEstado: 'pendiente',
      estado: 'pendiente'
    });

    await nuevaReserva.save();
 
    const buyOrder = `res-${nuevaReserva._id.toString().slice(-20)}`;
    const sessionId = `publica-${nuevaReserva._id}`;
    const amount = Number(servicio.precio);
    const returnUrl = process.env.WEBPAY_RESERVA_RETURN_URL;

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
app.get('/api/reserva-publica/retorno', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'production') {
  console.log('GET RETORNO RESERVA QUERY:', req.query);
}

    const token = req.query.token_ws;

    if (!token) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=cancelado`
      );
    }

    const commitResponse = await webpayTransaction.commit(token);

    if (process.env.NODE_ENV !== 'production') {
  console.log('RESPUESTA WEBPAY RESERVA GET:', commitResponse);
}

    const reserva = await Reserva.findOne({
      tokenPago: token
    });

    if (!reserva) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=error`
      );
    }

    if (reserva.pagoEstado === 'pagado') {
  return res.redirect(
    `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=exitoso`
  );
}

  if (
  commitResponse.status === 'AUTHORIZED' &&
  commitResponse.response_code === 0
) {
  reserva.pagoEstado = 'pagado';
  reserva.estado = 'confirmada';
  reserva.montoPagado = commitResponse.amount || reserva.montoPagado;

  await reserva.save();

  // 🔥 GENERAR DATOS VOUCHER
  const codigoReserva = `TG-${reserva._id.toString().slice(-6).toUpperCase()}`;
  const fechaEmision = new Date().toLocaleDateString('es-CL');
  const montoVoucher = Number(reserva.montoPagado || 0).toLocaleString('es-CL');

  // 🔥 ENVIAR CORREO AL CLIENTE
  await enviarCorreo({
    to: reserva.emailCliente,
    subject: `Voucher de reserva confirmada ${codigoReserva} - TurismoGO`,
    html: `
      <h2>Reserva confirmada</h2>
      <p><strong>Código:</strong> ${codigoReserva}</p>
      <p><strong>Servicio:</strong> ${reserva.servicio}</p>
      <p><strong>Cliente:</strong> ${reserva.nombreCliente}</p>
      <p><strong>Email:</strong> ${reserva.emailCliente}</p>
      <p><strong>Teléfono:</strong> ${reserva.telefonoCliente || 'No informado'}</p>
      <p><strong>Fechas:</strong> ${reserva.fechaInicio} al ${reserva.fechaFin}</p>
      <p><strong>Monto pagado:</strong> $${montoVoucher}</p>
      <p><strong>Fecha emisión:</strong> ${fechaEmision}</p>
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
    console.error('Error retorno GET reserva pública:', error);

    return res.redirect(
      `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=error`
    );
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
    if (process.env.NODE_ENV !== 'production') {
  console.log('RESPUESTA WEBPAY RESERVA:', commitResponse);
}

    const reserva = await Reserva.findOne({
      tokenPago: token
    });

    if (!reserva) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=error`
      );
    }
    if (reserva.pagoEstado === 'pagado') {
  return res.redirect(
    `${process.env.FRONTEND_URL}/reserva-resultado.html?pago=exitoso`
  );
}

    if (
  commitResponse.status === 'AUTHORIZED' &&
  commitResponse.response_code === 0
) {
      reserva.pagoEstado = 'pagado';
      reserva.estado = 'confirmada';
      reserva.montoPagado =
        commitResponse.amount || reserva.montoPagado;

      await reserva.save();
      const codigoReserva = `TG-${reserva._id.toString().slice(-6).toUpperCase()}`;
      const fechaEmision = new Date().toLocaleDateString('es-CL');
      const montoVoucher = Number(reserva.montoPagado || 0).toLocaleString('es-CL');
      await enviarCorreo({
  to: reserva.emailCliente,
  subject: `Voucher de reserva confirmada ${codigoReserva} - TurismoGO`,
  html: `
    <div style="font-family: Arial, sans-serif; background:#f4f8fb; padding:30px;">
      <div style="max-width:680px; margin:auto; background:#ffffff; border-radius:18px; overflow:hidden; border:1px solid #dbeafe;">
        
        <div style="background:linear-gradient(135deg,#063b73,#0b6fa4); color:white; padding:28px;">
          <h1 style="margin:0;">TurismoGO</h1>
          <p style="margin:6px 0 0;">Voucher de reserva confirmada</p>
        </div>

        <div style="padding:28px;">
          <h2 style="color:#061b3a; margin-top:0;">Reserva confirmada</h2>
          <p>Hola <strong>${reserva.nombreCliente}</strong>, tu pago fue aprobado correctamente.</p>

          <div style="background:#ecfdf5; color:#166534; padding:14px 18px; border-radius:12px; font-weight:bold; margin:20px 0;">
            Estado: Reserva confirmada y pago aprobado
          </div>

          <table style="width:100%; border-collapse:collapse;">
            <tr>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;"><strong>Código de reserva</strong></td>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;">${codigoReserva}</td>
            </tr>
            <tr>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;"><strong>Servicio</strong></td>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;">${reserva.servicio}</td>
            </tr>
            <tr>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;"><strong>Cliente</strong></td>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;">${reserva.nombreCliente}</td>
            </tr>
            <tr>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;"><strong>Correo</strong></td>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;">${reserva.emailCliente}</td>
            </tr>
            <tr>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;"><strong>Teléfono</strong></td>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;">${reserva.telefonoCliente || 'No informado'}</td>
            </tr>
            <tr>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;"><strong>Fechas</strong></td>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;">${reserva.fechaInicio} al ${reserva.fechaFin}</td>
            </tr>
            <tr>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;"><strong>Personas</strong></td>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;">${reserva.personas || 'No informado'}</td>
            </tr>
            <tr>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;"><strong>Monto pagado</strong></td>
              <td style="padding:12px; border-bottom:1px solid #e5e7eb;">$${montoVoucher}</td>
            </tr>
            <tr>
              <td style="padding:12px;"><strong>Fecha de emisión</strong></td>
              <td style="padding:12px;">${fechaEmision}</td>
            </tr>
          </table>

          <p style="margin-top:24px; color:#475569;">
            Presenta este voucher como comprobante de tu reserva. Ante cualquier duda, contacta al equipo de TurismoGO.
          </p>

          <p style="color:#061b3a; font-weight:bold;">Equipo TurismoGO</p>
        </div>
      </div>
    </div>
  `
});
await enviarCorreo({
  to: process.env.EMAIL_USER,
  subject: `Nueva reserva pagada ${codigoReserva} - TurismoGO`,
  html: `
    <h2>Nueva reserva pagada</h2>
    <p><strong>Código:</strong> ${codigoReserva}</p>
    <p><strong>Cliente:</strong> ${reserva.nombreCliente}</p>
    <p><strong>Email:</strong> ${reserva.emailCliente}</p>
    <p><strong>Teléfono:</strong> ${reserva.telefonoCliente || 'No informado'}</p>
    <p><strong>Servicio:</strong> ${reserva.servicio}</p>
    <p><strong>Fechas:</strong> ${reserva.fechaInicio} al ${reserva.fechaFin}</p>
    <p><strong>Personas:</strong> ${reserva.personas || 'No informado'}</p>
    <p><strong>Monto pagado:</strong> $${montoVoucher}</p>
    <p><strong>Mensaje:</strong> ${reserva.mensajeCliente || 'Sin mensaje adicional'}</p>
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
// MANEJO GLOBAL DE ERRORES
// =========================

app.use((err, req, res, next) => {
  console.error('Error global:', err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'La imagen supera el tamaño máximo permitido de 8 MB'
      });
    }

    return res.status(400).json({
      error: 'Error al procesar la imagen'
    });
  }

  if (err.message === 'Solo se permiten archivos de imagen') {
    return res.status(400).json({
      error: 'Solo se permiten archivos de imagen'
    });
  }

  if (err.message === 'Origen no permitido por CORS') {
    return res.status(403).json({
      error: 'Origen no permitido'
    });
  }

  return res.status(500).json({
    error: 'Error interno del servidor'
  });
});

// =========================
// CONEXIÓN MONGODB + SERVER
// =========================

const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ Conectado a MongoDB');
       
    app.listen(PORT, () => {
      console.log(`🚀 Servidor en http://localhost:${PORT}`);
    });
  })
  .catch(err => console.error('❌ Error MongoDB:', err));

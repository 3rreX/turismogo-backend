require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const app = express();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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
}

// Middlewares
app.use(express.json());

app.use(cors({
  origin: [
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'https://turismogo-frontend.vercel.app'
  ]
}));
// =========================
// MODELOS
// =========================

const usuarioSchema = new mongoose.Schema({
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
    required: true
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
    required: true
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
  }
});

const Usuario = mongoose.model('Usuario', usuarioSchema);
const Servicio = mongoose.model('Servicio', servicioSchema);
const Reserva = mongoose.model('Reserva', reservaSchema);

// =========================
// MIDDLEWARE AUTH
// =========================

function authMiddleware(req, res, next) {
  try {
    const token = req.headers.authorization;

    if (!token) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function propietarioMiddleware(req, res, next) {
  if (req.user.role === 'propietario' || req.user.role === 'admin') {
    return next();
  }

  return res.status(403).json({ error: 'Acceso solo para propietarios o admin' });
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
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username y password son obligatorios' });
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

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

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

app.post('/api/servicios', authMiddleware, propietarioMiddleware, upload.single('imagen'), async (req, res) => {
  try {
    const { nombre, descripcion, precio } = req.body;

    if (!nombre || !descripcion || !precio) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Debes subir una imagen' });
    }

    const resultado = await subirBufferACloudinary(req.file.buffer);

    const nuevoServicio = new Servicio({
      nombre,
      descripcion,
      precio: Number(precio),
      imagen: resultado.secure_url,
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

    const nuevaReserva = new Reserva({
      usuarioId: req.user.id,
      servicio,
      fechaInicio,
      fechaFin
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
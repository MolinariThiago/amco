# 🦷 AMCO — Centro Odontológico

Sistema web completo para un centro odontológico profesional.  
Incluye sitio público, panel de administración con analítica, y API backend con envío automático de correos.

---

## 📁 Estructura del proyecto

```
amco/
├── backend/
│   ├── server.js          → API Node.js + Express
│   ├── .env.example       → Variables de entorno (copiar a .env)
│   └── amco.db            → Base de datos SQLite (se crea automáticamente)
│
├── public/                → Sitio web público
│   ├── index.html
│   ├── css/
│   │   ├── variables.css  → Design tokens globales
│   │   ├── base.css       → Reset y estilos base
│   │   ├── components.css → Header, footer, formularios, botones
│   │   ├── sections.css   → Hero, servicios, equipo, reseñas, etc.
│   │   └── responsive.css → Breakpoints responsive
│   └── js/
│       ├── main.js        → Lógica del sitio (header, form, scroll)
│       └── analytics.js   → Tracker de eventos del visitante
│
├── admin/                 → Panel de administración
│   ├── index.html
│   ├── css/
│   │   └── admin.css
│   └── js/
│       └── admin.js
│
├── package.json
└── README.md
```

---

## 🚀 Instalación y puesta en marcha

### 1. Requisitos previos
- [Node.js](https://nodejs.org/) versión **18 o superior**
- npm (incluido con Node.js)

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp backend/.env.example backend/.env
```

Editá `backend/.env` con tus datos:

```env
PORT=3000
SITE_URL=http://localhost:3000

# JWT y contraseña admin
JWT_SECRET=cambia_esto_en_produccion
ADMIN_PASSWORD=amco2026

# Configuración de email (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tucorreo@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx   ← App Password de Google

# Email de la clínica
CLINIC_EMAIL=turnos@amco.com.ar
```

### 4. Iniciar el servidor

```bash
# Modo producción
npm start

# Modo desarrollo (con auto-reload)
npm run dev
```

El servidor levanta en **http://localhost:3000**

---

## 🔒 Panel de administración

Accedé desde: **http://localhost:3000/admin**

| Usuario | Contraseña |
|---------|------------|
| admin   | amco2026   |

> Podés cambiar la contraseña modificando `ADMIN_PASSWORD` en el archivo `.env` **antes** de iniciar el servidor por primera vez.

### Funcionalidades del panel:
- **Dashboard**: KPIs en tiempo real, últimos turnos, gráficos de actividad
- **Turnos**: Ver, filtrar, buscar, cambiar estado (pendiente / confirmado / completado / cancelado), eliminar
- **Eliminados**: Historial de turnos con soft-delete
- **Analítica**: Pageviews, sesiones únicas, scroll depth, eventos por día, servicios más solicitados

---

## 📧 Configuración de email (Gmail)

Para que los correos funcionen correctamente:

1. Activá la **verificación en 2 pasos** en tu cuenta de Google
2. Ir a [Cuenta Google → Seguridad → Contraseñas de aplicaciones](https://myaccount.google.com/apppasswords)
3. Generá una contraseña para "Correo"
4. Pegá esa contraseña en `SMTP_PASS` del `.env`

Cuando alguien reserva un turno, se envían automáticamente:
- ✉️ **Notificación a la clínica** (al email configurado + `franchomolinari72@gmail.com`)
- ✉️ **Confirmación al paciente** (si proporcionó su email)

---

## 🌐 API Endpoints

### Públicos
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/turnos` | Crear nuevo turno |
| POST | `/api/analytics/track` | Registrar evento de visitante |

### Admin (requieren JWT en header `Authorization: Bearer <token>`)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/admin/login` | Autenticación |
| GET | `/api/turnos` | Listar turnos con filtros |
| PATCH | `/api/turnos/:id` | Actualizar estado/notas |
| DELETE | `/api/turnos/:id` | Eliminar turno (soft-delete) |
| GET | `/api/analytics` | Datos del dashboard |

---

## 🚢 Deploy en producción

### Con PM2 (recomendado)
```bash
npm install -g pm2
pm2 start backend/server.js --name amco
pm2 save
pm2 startup
```

### Variables importantes para producción
```env
NODE_ENV=production
SITE_URL=https://tu-dominio.com
ALLOWED_ORIGIN=https://tu-dominio.com
JWT_SECRET=string_muy_largo_y_aleatorio
```

---

## 🛠 Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express |
| Base de datos | SQLite (better-sqlite3) |
| Autenticación | JWT + bcryptjs |
| Email | Nodemailer |
| Frontend | HTML5 + CSS3 + JavaScript vanilla |
| Fuentes | Google Fonts (Playfair Display + DM Sans) |

---

## 📞 Soporte

**AMCO Centro Odontológico**  
San Martín 1458, Rosario, Santa Fe  
(0341) 555-0200 · turnos@amco.com.ar

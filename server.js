const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup
const db = new sqlite3.Database('./database.db');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session setup
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true in production with HTTPS
}));

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.error('Email transporter setup failed:', error);
  } else {
    console.log('Email transporter is ready');
  }
});

// Database initialization
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT,
    cover_image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    category TEXT,
    image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert sample data
  db.run(`INSERT OR IGNORE INTO posts (id, title, content) VALUES (1, 'Sample Blog Post', 'This is a sample blog post content.')`);
  db.run(`INSERT OR IGNORE INTO works (id, title, category) VALUES (1, 'Sample Work', 'logos')`);
  db.run(`INSERT OR IGNORE INTO users (id, username, email, password, role) VALUES (1, 'admin', 'sara.mkraz@gmail.com', '$2b$10$bVfR/Tk5Gwz5McZDHY3aC.EfZ3GtCm6BZlvowa9/59GfBpthwXIvm', 'ADMIN')`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    user_id INTEGER,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    user_id INTEGER,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    code TEXT,
    expires_at DATETIME
  )`);

  // Insert default admin if not exists
  db.get("SELECT * FROM users WHERE role = 'admin'", (err, row) => {
    if (!row) {
      const hashedPassword = bcrypt.hashSync('00998877a@', 10);
      db.run("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)", ['admin', 'sara.mkraz@gmail.com', hashedPassword, 'admin']);
    }
  });
});

// Middleware
function requireAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/');
  }
}

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'ADMIN') {
    next();
  } else {
    res.redirect('/');
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Other static pages
app.get('/about.html', (req, res) => res.sendFile(path.join(__dirname, 'about.html')));
app.get('/blog.html', (req, res) => {
  db.all("SELECT * FROM posts ORDER BY created_at DESC", (err, posts) => {
    res.render('blog', { posts, user: req.session.user });
  });
});

app.get('/portfolio.html', (req, res) => {
  db.all("SELECT * FROM works ORDER BY created_at DESC", (err, works) => {
    res.render('portfolio', { works, user: req.session.user });
  });
});
// Add similar for other pages, but for brevity, I'll focus on key ones.

// Authentication routes
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (user && bcrypt.compareSync(password, user.password)) {
      req.session.user = user;
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Invalid credentials' });
    }
  });
});

app.post('/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'All fields required' });
  }
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", [username, email, hashedPassword], function(err) {
    if (err) {
      res.json({ success: false, message: 'Email already exists' });
    } else {
      res.json({ success: true });
    }
  });
});

app.get('/check-session', (req, res) => {
  res.json({ user: req.session.user });
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true });
  });
});

app.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const gmailRegex = /^[^\s@]+@gmail\.com$/i;
  if (!gmailRegex.test(normalizedEmail)) {
    return res.status(400).json({ success: false, message: 'Please use a valid Gmail address.' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail], (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Server error.' });
    }
    if (!user) {
      return res.status(404).json({ success: false, message: 'Email not found.' });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    db.run('INSERT INTO password_resets (email, code, expires_at) VALUES (?, ?, ?)', [normalizedEmail, resetCode, expiresAt], (insertErr) => {
      if (insertErr) {
        return res.status(500).json({ success: false, message: 'Failed to create reset code.' });
      }

      const mailOptions = {
        from: transporter.options.auth.user,
        to: normalizedEmail,
        subject: 'رمز استعادة كلمة المرور',
        text: `رمز التحقق الخاص بك هو: ${resetCode}. صالح لمدة 15 دقيقة.`,
        html: `<p>رمز التحقق الخاص بك هو: <strong>${resetCode}</strong></p><p>هذا الرمز صالح لمدة 15 دقيقة.</p>`
      };

      transporter.sendMail(mailOptions, (mailErr) => {
        if (mailErr) {
          console.error('Forgot password email error:', mailErr);
          return res.status(500).json({ success: false, message: 'Unable to send reset email. Check email config.' });
        }
        res.json({ success: true, message: 'Reset code sent to your Gmail address.' });
      });
    });
  });
});

app.post('/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ success: false, message: 'Email, code, and new password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  db.get('SELECT * FROM password_resets WHERE email = ? AND code = ? ORDER BY id DESC LIMIT 1', [normalizedEmail, code], (err, resetRow) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Server error.' });
    }
    if (!resetRow) {
      return res.status(400).json({ success: false, message: 'Invalid reset code.' });
    }
    if (new Date(resetRow.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'Reset code has expired.' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.run('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, normalizedEmail], function(updateErr) {
      if (updateErr) {
        return res.status(500).json({ success: false, message: 'Unable to update password.' });
      }

      db.run('DELETE FROM password_resets WHERE id = ?', [resetRow.id], () => {
        res.json({ success: true, message: 'Password updated successfully. Please log in.' });
      });
    });
  });
});

// Admin routes
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  // Analytics
  db.get("SELECT COUNT(*) as users FROM users", (err, users) => {
    db.get("SELECT COUNT(*) as posts FROM posts", (err, posts) => {
      db.get("SELECT COUNT(*) as works FROM works", (err, works) => {
        res.render('admin', { users: users['COUNT(*)'], posts: posts['COUNT(*)'], works: works['COUNT(*)'], user: req.session.user });
      });
    });
  });
});

app.post('/admin/post', requireAuth, requireAdmin, upload.single('cover_image'), (req, res) => {
  const { title, content } = req.body;
  const cover_image = req.file ? req.file.filename : null;
  db.run("INSERT INTO posts (title, content, cover_image) VALUES (?, ?, ?)", [title, content, cover_image], () => {
    res.redirect('/admin-dashboard.html');
  });
});

app.post('/admin/work', requireAuth, requireAdmin, upload.single('image'), (req, res) => {
  const { title, category } = req.body;
  const image = req.file ? req.file.filename : null;
  db.run("INSERT INTO works (title, category, image) VALUES (?, ?, ?)", [title, category, image], () => {
    res.redirect('/admin-dashboard.html');
  });
});

// API routes for admin dashboard
app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  db.get("SELECT COUNT(*) as users FROM users", (err, users) => {
    db.get("SELECT COUNT(*) as posts FROM posts", (err, posts) => {
      db.get("SELECT COUNT(*) as works FROM works", (err, works) => {
        res.json({ users: users['COUNT(*)'], posts: posts['COUNT(*)'], works: works['COUNT(*)'] });
      });
    });
  });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  db.all("SELECT id, username, email, role FROM users", (err, users) => {
    res.json(users);
  });
});

app.get('/api/admin/posts', requireAuth, requireAdmin, (req, res) => {
  db.all("SELECT * FROM posts ORDER BY created_at DESC", (err, posts) => {
    res.json(posts);
  });
});

app.get('/api/admin/works', requireAuth, requireAdmin, (req, res) => {
  db.all("SELECT * FROM works ORDER BY created_at DESC", (err, works) => {
    res.json(works);
  });
});

app.get('/admin-dashboard.html', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the other process or set a different PORT environment variable.`);
  } else {
    console.error('Server error:', err);
  }
});
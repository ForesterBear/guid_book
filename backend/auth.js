const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const ACCESS_TOKEN_EXPIRES = '15m';
const REFRESH_TOKEN_EXPIRES = '7d';

function generateTokens(user) {
  const payload = {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    access_level: user.access_level,
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET || 'your_jwt_secret_here', {
    expiresIn: ACCESS_TOKEN_EXPIRES,
  });

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET || 'your_jwt_refresh_secret_here',
    { expiresIn: REFRESH_TOKEN_EXPIRES }
  );

  return { accessToken, refreshToken };
}

// Middleware: перевіряє access token в кожному запиті
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Токен відсутній' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_here');
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Невалідний або прострочений токен' });
  }
}

// Middleware: перевіряє ролі (наприклад, admin, operator)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Недостатньо прав для виконання дії' });
    }
    next();
  };
}

const CLEARANCE_LEVELS = { Public: 0, DSP: 1, Secret: 2 };

// Middleware: перевіряє рівень секретності
function requireClearance(minClearance) {
  return (req, res, next) => {
    const userLevel = CLEARANCE_LEVELS[req.user?.access_level] ?? 0;
    const required = CLEARANCE_LEVELS[minClearance] ?? 0;
    if (userLevel < required) {
      return res.status(403).json({ error: 'Недостатній рівень доступу до документації' });
    }
    next();
  };
}

module.exports = { generateTokens, authMiddleware, requireRole, requireClearance, bcrypt };
import jwt from 'jsonwebtoken';

const secret = () => process.env.JWT_SECRET || 'dev-only-secret';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, name: user.name, role: user.role }, secret(), { expiresIn: '12h' });

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

// Role enforcement lives here (server side), never only in the UI.
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ error: 'forbidden', required: roles });

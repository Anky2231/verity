import jwt from 'jsonwebtoken';

const DEV_SECRET = 'dev-only-secret';
const secret = () => process.env.JWT_SECRET || DEV_SECRET;

// A production API that signs logins with a public default would let anyone forge a token, so it must not start.
export function assertSecret(env = process.env) {
  if (env.NODE_ENV === 'production' && (!env.JWT_SECRET || env.JWT_SECRET === DEV_SECRET))
    throw new Error('JWT_SECRET must be set to a private value when NODE_ENV=production');
}

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

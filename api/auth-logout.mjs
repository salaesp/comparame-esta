// /api/auth/logout — borra la cookie de sesión y vuelve al inicio (POST desde la app, GET por link).
import { redirect } from '../lib/http.mjs';
import { clearSessionCookie } from '../lib/auth.mjs';

export default async function (req) {
  return redirect('/', [clearSessionCookie(req)]);
}

export const config = { path: '/api/auth/logout' };

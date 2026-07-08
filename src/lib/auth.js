import { supabase } from './supabaseClient.js';

/**
 * Registra un nuevo usuario con email/contraseña.
 * No crea el household aquí: eso pasa en ensureHousehold(), una vez
 * hay sesión activa (con confirmación de correo puede no haberla aún).
 */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback) {
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => sub.subscription.unsubscribe();
}

/**
 * Devuelve el household del usuario actual. Si no pertenece a ninguno
 * (primer login tras signup), le crea uno propio.
 * Asume que un usuario pertenece a un solo household por ahora; el modelo
 * de datos ya soporta N, así que agregar un selector múltiple es un
 * cambio aislado a esta función + una vista de "cambiar de familia".
 */
export async function ensureHousehold(userId) {
  const { data: memberships, error: memErr } = await supabase
    .from('household_members')
    .select('household_id, role, households(id, name)')
    .eq('user_id', userId)
    .limit(1);

  if (memErr) throw memErr;

  if (memberships && memberships.length > 0) {
    return memberships[0].households;
  }

  const { data: created, error: createErr } = await supabase
    .from('households')
    .insert({ name: 'Mi familia', created_by: userId })
    .select('id, name')
    .single();

  if (createErr) throw createErr;
  return created;
}

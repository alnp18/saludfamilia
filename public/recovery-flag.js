// Se captura ANTES de que cargue el bundle (y por lo tanto antes de que
// supabase-js procese y limpie el hash del enlace de recuperación).
window.__recoveryInUrl = (location.hash || '').indexOf('type=recovery') !== -1;

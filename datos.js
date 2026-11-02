// Estado y reglas de negocio. Sin DOM: la interfaz vive en main.js.

const CLAVE = 'asistencias.v1';

export const ESTADOS = {
  P: 'Presente',
  T: 'Tarde',
  A: 'Ausente',
  J: 'Justificado',
};

// Por debajo de este porcentaje el reporte resalta a la persona.
export const UMBRAL = 75;

const vacio = () => ({ version: 1, ultimoRespaldo: null, grupos: [] });

function nuevoId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Fechas: siempre 'AAAA-MM-DD' en hora local. toISOString() daría el día
// equivocado por la noche en zonas horarias con desfase negativo.

const dos = (n) => String(n).padStart(2, '0');

export const deFecha = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;

export function aFecha(texto) {
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(a, m - 1, d);
}

export const hoy = () => deFecha(new Date());

export const esFecha = (t) =>
  typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t) && deFecha(aFecha(t)) === t;

export function sumarDias(texto, n) {
  const [a, m, d] = texto.split('-').map(Number);
  return deFecha(new Date(a, m - 1, d + n));
}

// Nombres

export const limpiarNombre = (t) => String(t).replace(/\s+/g, ' ').trim().slice(0, 120);

export const normalizar = (t) =>
  limpiarNombre(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const porNombre = (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' });

// Admite listas numeradas pegadas de una hoja o un documento ("1. Ana", "2) Luis").
export function separarLista(texto) {
  return String(texto)
    .split(/\r?\n/)
    .map((linea) => limpiarNombre(linea.replace(/^\s*\d+\s*[.)\-]?\s+/, '')))
    .filter(Boolean);
}

// Grupos

export function crearGrupo(estado, nombre) {
  const grupo = { id: nuevoId(), nombre: limpiarNombre(nombre), personas: [], registros: {} };
  estado.grupos.push(grupo);
  return grupo;
}

export function eliminarGrupo(estado, id) {
  estado.grupos = estado.grupos.filter((g) => g.id !== id);
}

// Personas

export function agregarPersonas(grupo, nombres) {
  const existentes = new Set(grupo.personas.map((p) => normalizar(p.nombre)));
  let agregadas = 0;
  let repetidas = 0;
  for (const nombre of nombres) {
    const limpio = limpiarNombre(nombre);
    if (!limpio) continue;
    const clave = normalizar(limpio);
    if (existentes.has(clave)) {
      repetidas++;
      continue;
    }
    existentes.add(clave);
    grupo.personas.push({ id: nuevoId(), nombre: limpio, activo: true });
    agregadas++;
  }
  return { agregadas, repetidas };
}

export function renombrarPersona(grupo, id, nombre) {
  const limpio = limpiarNombre(nombre);
  if (!limpio) return false;
  const clave = normalizar(limpio);
  if (grupo.personas.some((p) => p.id !== id && normalizar(p.nombre) === clave)) return false;
  grupo.personas.find((p) => p.id === id).nombre = limpio;
  return true;
}

export function eliminarPersona(grupo, id) {
  grupo.personas = grupo.personas.filter((p) => p.id !== id);
  for (const fecha of Object.keys(grupo.registros)) marcar(grupo, fecha, id, null);
}

export const personasActivas = (grupo) =>
  grupo.personas.filter((p) => p.activo).sort((a, b) => porNombre(a.nombre, b.nombre));

export const personasArchivadas = (grupo) =>
  grupo.personas.filter((p) => !p.activo).sort((a, b) => porNombre(a.nombre, b.nombre));

// Una persona archivada sigue apareciendo en las listas donde ya tiene marca.
export function personasDeLista(grupo, fecha) {
  const marcas = grupo.registros[fecha] ?? {};
  return grupo.personas
    .filter((p) => p.activo || marcas[p.id])
    .sort((a, b) => porNombre(a.nombre, b.nombre));
}

// Asistencia

export function marcar(grupo, fecha, personaId, estadoMarca) {
  const marcas = (grupo.registros[fecha] ??= {});
  if (estadoMarca) marcas[personaId] = estadoMarca;
  else delete marcas[personaId];
  if (Object.keys(marcas).length === 0) delete grupo.registros[fecha];
}

export const marcaDe = (grupo, fecha, personaId) => grupo.registros[fecha]?.[personaId] ?? null;

export function contar(grupo, fecha) {
  const cuenta = { P: 0, T: 0, A: 0, J: 0, sinMarcar: 0 };
  for (const p of personasDeLista(grupo, fecha)) {
    const m = marcaDe(grupo, fecha, p.id);
    if (m) cuenta[m]++;
    else cuenta.sinMarcar++;
  }
  return cuenta;
}

// Tarde cuenta como asistió; Justificado no suma ni resta.
function porcentaje({ P, T, A }) {
  const contadas = P + T + A;
  return contadas ? Math.round(((P + T) / contadas) * 100) : null;
}

export function resumen(grupo, desde = '', hasta = '') {
  const fechas = Object.keys(grupo.registros)
    .filter((f) => (!desde || f >= desde) && (!hasta || f <= hasta))
    .sort();
  const general = { P: 0, T: 0, A: 0, J: 0 };
  const filas = grupo.personas
    .map((persona) => {
      const fila = { persona, P: 0, T: 0, A: 0, J: 0 };
      for (const fecha of fechas) {
        const m = grupo.registros[fecha][persona.id];
        if (m) {
          fila[m]++;
          general[m]++;
        }
      }
      fila.total = fila.P + fila.T + fila.A + fila.J;
      fila.porcentaje = porcentaje(fila);
      return fila;
    })
    .filter((f) => f.persona.activo || f.total > 0)
    .sort((a, b) => porNombre(a.persona.nombre, b.persona.nombre));
  return { fechas, filas, porcentaje: porcentaje(general) };
}

// CSV: separador ';' porque es el que Excel espera en configuración regional
// en español. El prefijo evita que un nombre como "=1+1" se ejecute como fórmula.

function celda(valor) {
  let t = String(valor);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

const csv = (filas) => filas.map((f) => f.map(celda).join(';')).join('\r\n');

export function csvResumen(r) {
  const nombres = Object.values(ESTADOS);
  return csv([
    ['Nombre', ...nombres, 'Asistencia %'],
    ...r.filas.map((f) => [f.persona.nombre, f.P, f.T, f.A, f.J, f.porcentaje ?? '']),
  ]);
}

export function csvDetalle(grupo, r) {
  return csv([
    ['Nombre', ...r.fechas],
    ...r.filas.map((f) => [
      f.persona.nombre,
      ...r.fechas.map((fecha) => ESTADOS[marcaDe(grupo, fecha, f.persona.id)] ?? ''),
    ]),
  ]);
}

// Persistencia y copias de seguridad

const esId = (t) => typeof t === 'string' && /^[\w-]{1,40}$/.test(t);

// Reconstruye el estado campo a campo: lo que venga de un archivo no es de fiar.
export function validar(datos) {
  if (datos?.version !== 1 || !Array.isArray(datos.grupos)) {
    throw new Error('El archivo no es una copia de seguridad de Asistencias.');
  }
  const idsGrupo = new Set();
  const grupos = datos.grupos.map((g) => {
    if (!esId(g?.id) || idsGrupo.has(g.id) || typeof g.nombre !== 'string' || !Array.isArray(g.personas)) {
      throw new Error('El archivo tiene un grupo dañado.');
    }
    idsGrupo.add(g.id);
    const idsPersona = new Set();
    const personas = g.personas.map((p) => {
      if (!esId(p?.id) || idsPersona.has(p.id) || typeof p.nombre !== 'string') {
        throw new Error(`El grupo "${g.nombre}" tiene una persona dañada.`);
      }
      idsPersona.add(p.id);
      return { id: p.id, nombre: limpiarNombre(p.nombre), activo: p.activo !== false };
    });
    const registros = {};
    for (const [fecha, marcas] of Object.entries(g.registros ?? {})) {
      if (!esFecha(fecha) || typeof marcas !== 'object' || marcas === null) continue;
      const validas = Object.entries(marcas).filter(([id, m]) => idsPersona.has(id) && m in ESTADOS);
      if (validas.length) registros[fecha] = Object.fromEntries(validas);
    }
    return { id: g.id, nombre: limpiarNombre(g.nombre), personas, registros };
  });
  return {
    version: 1,
    ultimoRespaldo: esFecha(datos.ultimoRespaldo) ? datos.ultimoRespaldo : null,
    grupos,
  };
}

export function leerRespaldo(texto) {
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es una copia de seguridad de Asistencias.');
  }
  return validar(datos);
}

export function cargar() {
  let crudo;
  try {
    crudo = localStorage.getItem(CLAVE);
  } catch {
    return { estado: vacio(), problema: 'Este navegador no permite guardar datos; se perderán al cerrar.' };
  }
  if (!crudo) return { estado: vacio() };
  try {
    return { estado: validar(JSON.parse(crudo)) };
  } catch {
    // Se conserva el contenido dañado en vez de pisarlo en el siguiente guardado.
    try {
      localStorage.setItem(`${CLAVE}.danado`, crudo);
    } catch {}
    return { estado: vacio(), problema: 'Los datos guardados estaban dañados. Restaura una copia de seguridad.' };
  }
}

export function guardar(estado) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
    return true;
  } catch {
    return false;
  }
}

export const esClaveDeDatos = (clave) => clave === CLAVE;

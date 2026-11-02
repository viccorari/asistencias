import {
  ESTADOS, UMBRAL, agregarPersonas, aFecha, cargar, contar, crearGrupo, csvDetalle, csvResumen,
  deFecha, eliminarGrupo, eliminarPersona, esClaveDeDatos, esFecha, guardar, hoy, leerRespaldo,
  limpiarNombre, marcaDe, marcar, normalizar, personasActivas, personasArchivadas, personasDeLista,
  renombrarPersona, resumen, separarLista, sumarDias,
} from './datos.js';

const cabecera = document.getElementById('cabecera');
const app = document.getElementById('app');
const aviso = document.getElementById('aviso');
const dialogo = document.getElementById('dialogo');

const inicial = cargar();
let estado = inicial.estado;
let filtro = { grupoId: null, desde: '', hasta: '', orden: 'nombre' };
let ultimoDia = hoy();

// Utilidades de interfaz

function h(etiqueta, props = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave.startsWith('on')) el.addEventListener(clave.slice(2), valor);
    else if (clave === 'class') el.className = valor;
    else if (clave in el) el[clave] = valor;
    else el.setAttribute(clave, valor);
  }
  el.append(...hijos.flat().filter((x) => x !== null && x !== undefined && x !== false));
  return el;
}

let temporizadorAviso;
function avisar(mensaje, duracion = 3000) {
  aviso.textContent = mensaje;
  aviso.classList.add('visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => aviso.classList.remove('visible'), duracion);
}

function persistir() {
  if (!guardar(estado)) avisar('No se pudo guardar. Revisa el espacio del navegador.', 8000);
}

function abrirDialogo(contenido) {
  dialogo.replaceChildren(contenido);
  dialogo.returnValue = '';
  dialogo.showModal();
  return new Promise((resolver) => {
    dialogo.addEventListener('close', () => resolver(dialogo.returnValue), { once: true });
  });
}

const botonCancelar = () =>
  h('button', { type: 'button', onclick: () => dialogo.close('') }, 'Cancelar');

async function confirmar({ titulo, texto, accion, peligro = false }) {
  const respuesta = await abrirDialogo(
    h('form', { method: 'dialog' },
      h('h2', {}, titulo),
      h('p', { class: 'tenue' }, texto),
      h('div', { class: 'acciones' },
        botonCancelar(),
        h('button', { value: 'si', class: peligro ? 'peligro lleno' : 'primario' }, accion))),
  );
  return respuesta === 'si';
}

async function pedirTexto({ titulo, etiqueta, valor = '', accion }) {
  const campo = h('input', { required: true, maxLength: 120, value: valor });
  const respuesta = await abrirDialogo(
    h('form', { method: 'dialog' },
      h('h2', {}, titulo),
      h('label', {}, etiqueta, campo),
      h('div', { class: 'acciones' },
        botonCancelar(),
        h('button', { value: 'ok', class: 'primario' }, accion))),
  );
  return respuesta === 'ok' ? limpiarNombre(campo.value) : '';
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = h('a', { href: url, download: nombre });
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const descargarCsv = (nombre, contenido) =>
  descargar(nombre, `\uFEFF${contenido}`, 'text/csv;charset=utf-8'); // El BOM hace que Excel lea los acentos.

const aArchivo = (t) =>
  normalizar(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grupo';

const fmtDia = new Intl.DateTimeFormat('es', { weekday: 'long' });
const fmtFecha = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtCorta = new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit' });

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Rutas: #/  ·  #/g/<id>/lista[/<fecha>]  ·  #/g/<id>/personas  ·  #/g/<id>/reporte

function leerRuta() {
  const [, seccion, grupoId, vista = 'lista', fecha] = location.hash.split('/');
  return seccion === 'g' ? { grupoId, vista, fecha } : {};
}

function render() {
  ultimoDia = hoy();
  const { grupoId, vista, fecha } = leerRuta();
  if (!grupoId) {
    cabecera.replaceChildren(barraInicio());
    app.replaceChildren(...vistaInicio());
    document.title = 'Asistencias';
    return;
  }
  const grupo = estado.grupos.find((g) => g.id === grupoId);
  if (!grupo) {
    location.hash = '#/';
    return;
  }
  cabecera.replaceChildren(...barraGrupo(grupo, vista));
  const vistas = {
    personas: () => vistaPersonas(grupo),
    reporte: () => vistaReporte(grupo),
  };
  app.replaceChildren(...(vistas[vista] ?? (() => vistaLista(grupo, fecha)))());
  document.title = `${grupo.nombre} · Asistencias`;
}

function barraInicio() {
  return h('div', { class: 'barra' },
    h('img', { class: 'logo', src: 'icono.svg', alt: '' }),
    h('h1', {}, 'Asistencias'));
}

function barraGrupo(grupo, vista) {
  const pestana = (id, texto) =>
    h('a', { href: `#/g/${grupo.id}/${id}`, 'aria-current': vista === id ? 'page' : null }, texto);
  return [
    h('div', { class: 'barra' },
      h('a', { class: 'volver', href: '#/', 'aria-label': 'Volver a grupos' }, '‹'),
      h('h1', {}, grupo.nombre)),
    h('nav', { class: 'pestanas', 'aria-label': 'Secciones del grupo' },
      pestana('lista', 'Lista'), pestana('personas', 'Personas'), pestana('reporte', 'Reporte')),
  ];
}

// Inicio

function vistaInicio() {
  const campo = h('input', {
    placeholder: 'Nombre del grupo', 'aria-label': 'Nombre del grupo', maxLength: 120, required: true,
  });
  const formulario = h('form', {
    class: 'fila-form',
    onsubmit: (e) => {
      e.preventDefault();
      const nombre = limpiarNombre(campo.value);
      if (!nombre) return;
      const grupo = crearGrupo(estado, nombre);
      persistir();
      navigator.storage?.persist?.();
      location.hash = `#/g/${grupo.id}/personas`;
    },
  }, campo, h('button', { class: 'primario' }, 'Crear'));

  const grupos = [...estado.grupos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return [
    grupos.length
      ? h('div', { class: 'grupos' }, grupos.map(tarjetaGrupo))
      : h('div', { class: 'tarjeta vacio' },
        h('h2', {}, 'Crea tu primer grupo'),
        h('p', { class: 'tenue' }, 'Una clase, un equipo, un turno… Luego añades a las personas y ya puedes tomar lista.')),
    formulario,
    tarjetaRespaldo(),
  ];
}

function tarjetaGrupo(grupo) {
  const fecha = hoy();
  const c = contar(grupo, fecha);
  const total = personasActivas(grupo).length;
  const marcadas = grupo.registros[fecha] ? Object.keys(grupo.registros[fecha]).length : 0;
  return h('a', { class: 'grupo', href: `#/g/${grupo.id}/lista` },
    h('div', { class: 'grupo-datos' },
      h('strong', {}, grupo.nombre),
      h('span', { class: 'tenue pequeno' },
        plural(total, 'persona', 'personas'),
        marcadas ? ` · Hoy: ${c.P + c.T} de ${marcadas} asistieron` : ' · Hoy sin lista')),
    h('span', { class: 'flecha', 'aria-hidden': 'true' }, '›'));
}

function tarjetaRespaldo() {
  const archivo = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'oculto',
    onchange: (e) => {
      const seleccionado = e.target.files[0];
      e.target.value = '';
      if (seleccionado) restaurar(seleccionado);
    },
  });
  const ultima = estado.ultimoRespaldo
    ? `Última copia: ${fmtFecha.format(aFecha(estado.ultimoRespaldo))}.`
    : 'Aún no has hecho ninguna copia.';
  return h('section', { class: 'tarjeta' },
    h('h2', {}, 'Tus datos'),
    h('p', { class: 'tenue pequeno' },
      `Se guardan solo en este navegador: nada se envía a ningún servidor. Si borras los datos del navegador se pierden, así que haz copias. ${ultima}`),
    h('div', { class: 'acciones' },
      h('button', { onclick: respaldar }, 'Descargar copia'),
      h('button', { onclick: () => archivo.click() }, 'Restaurar copia'),
      archivo));
}

function respaldar() {
  estado.ultimoRespaldo = hoy();
  persistir();
  descargar(`asistencias-copia-${hoy()}.json`, JSON.stringify(estado, null, 2), 'application/json');
  render();
}

async function restaurar(archivo) {
  let nuevo;
  try {
    nuevo = leerRespaldo(await archivo.text());
  } catch (error) {
    avisar(error.message, 6000);
    return;
  }
  const seguro = await confirmar({
    titulo: 'Restaurar copia',
    texto: `Se reemplazará lo que hay ahora (${plural(estado.grupos.length, 'grupo', 'grupos')}) por el contenido del archivo (${plural(nuevo.grupos.length, 'grupo', 'grupos')}).`,
    accion: 'Reemplazar',
    peligro: true,
  });
  if (!seguro) return;
  estado = nuevo;
  persistir();
  avisar('Copia restaurada');
  render();
}

// Toma de lista

function vistaLista(grupo, fechaRuta) {
  const actual = hoy();
  const fecha = esFecha(fechaRuta) && fechaRuta <= actual ? fechaRuta : actual;
  const personas = personasDeLista(grupo, fecha);
  const irA = (f) => { location.hash = `#/g/${grupo.id}/lista/${f}`; };

  const selector = h('input', {
    type: 'date',
    value: fecha,
    max: actual,
    'aria-label': 'Elegir fecha',
    onclick: (e) => { try { e.target.showPicker(); } catch {} },
    onchange: (e) => { if (esFecha(e.target.value) && e.target.value <= actual) irA(e.target.value); },
  });
  const barraFecha = h('div', { class: 'fecha' },
    h('button', { class: 'icono', 'aria-label': 'Día anterior', onclick: () => irA(sumarDias(fecha, -1)) }, '‹'),
    h('div', { class: 'fecha-centro' },
      h('span', { class: 'fecha-dia' }, fecha === actual ? 'Hoy' : fmtDia.format(aFecha(fecha))),
      h('span', { class: 'fecha-resto' }, fmtFecha.format(aFecha(fecha))),
      selector),
    h('button', {
      class: 'icono', 'aria-label': 'Día siguiente', disabled: fecha >= actual, onclick: () => irA(sumarDias(fecha, 1)),
    }, '›'));

  if (!personas.length) {
    return [barraFecha, h('div', { class: 'tarjeta vacio' },
      h('h2', {}, 'Todavía no hay personas'),
      h('p', { class: 'tenue' }, 'Añádelas para poder tomar lista.'),
      h('a', { class: 'boton', href: `#/g/${grupo.id}/personas` }, 'Añadir personas'))];
  }

  const numeros = {};
  const contadores = h('div', { class: 'contadores' },
    [...Object.entries(ESTADOS), ['sinMarcar', 'Sin marcar']].map(([clave, nombre]) => {
      numeros[clave] = h('b');
      return h('div', { class: 'contador', 'data-e': clave }, numeros[clave],
        h('span', {}, nombre.replace('Justificado', 'Justif.')));
    }));

  const filas = personas.map((persona) => {
    const botones = Object.entries(ESTADOS).map(([clave, nombre]) =>
      h('button', {
        class: 'marca',
        'data-e': clave,
        title: nombre,
        'aria-label': `${nombre}: ${persona.nombre}`,
        onclick: () => {
          const repetida = marcaDe(grupo, fecha, persona.id) === clave;
          marcar(grupo, fecha, persona.id, repetida ? null : clave);
          persistir();
          actualizar();
        },
      }, clave));
    const li = h('li', {},
      h('span', { class: 'nombre' }, persona.nombre,
        !persona.activo && h('span', { class: 'etiqueta' }, 'Archivada')),
      h('div', { class: 'marcas', role: 'group', 'aria-label': persona.nombre }, botones));
    return { persona, botones, li };
  });

  const botonTodos = h('button', {
    class: 'primario',
    onclick: () => {
      for (const { persona } of filas) {
        if (!marcaDe(grupo, fecha, persona.id)) marcar(grupo, fecha, persona.id, 'P');
      }
      persistir();
      actualizar();
    },
  }, 'Marcar el resto presentes');

  const botonBorrar = h('button', {
    class: 'peligro',
    onclick: async () => {
      const seguro = await confirmar({
        titulo: 'Borrar la lista de este día',
        texto: `Se quitarán todas las marcas del ${fmtFecha.format(aFecha(fecha))}.`,
        accion: 'Borrar',
        peligro: true,
      });
      if (!seguro) return;
      delete grupo.registros[fecha];
      persistir();
      render();
    },
  }, 'Borrar lista');

  function actualizar() {
    const cuenta = contar(grupo, fecha);
    for (const [clave, nodo] of Object.entries(numeros)) nodo.textContent = cuenta[clave];
    for (const { persona, botones } of filas) {
      const marca = marcaDe(grupo, fecha, persona.id);
      for (const b of botones) b.setAttribute('aria-pressed', String(b.dataset.e === marca));
    }
    botonTodos.disabled = cuenta.sinMarcar === 0;
    botonBorrar.disabled = cuenta.sinMarcar === filas.length;
  }
  actualizar();

  const buscador = filas.length >= 15 && h('input', {
    type: 'search',
    placeholder: 'Buscar persona',
    'aria-label': 'Buscar persona',
    oninput: (e) => {
      const buscado = normalizar(e.target.value);
      for (const { persona, li } of filas) {
        li.classList.toggle('oculto', !normalizar(persona.nombre).includes(buscado));
      }
    },
  });

  return [
    barraFecha,
    contadores,
    h('div', { class: 'acciones' }, botonTodos, botonBorrar),
    buscador,
    h('ul', { class: 'lista' }, filas.map((f) => f.li)),
  ].filter(Boolean);
}

// Personas

function vistaPersonas(grupo) {
  const campo = h('input', {
    placeholder: 'Nombre y apellidos', 'aria-label': 'Nombre de la persona', maxLength: 120, required: true,
  });
  const formulario = h('form', {
    class: 'fila-form',
    onsubmit: (e) => {
      e.preventDefault();
      const { agregadas } = agregarPersonas(grupo, [campo.value]);
      if (!agregadas) {
        avisar('Esa persona ya está en el grupo');
        return;
      }
      persistir();
      render();
      app.querySelector('input').focus();
    },
  }, campo, h('button', { class: 'primario' }, 'Añadir'));

  const pegado = h('textarea', {
    placeholder: 'Ana Torres\nLuis Quispe\nMaría Fernández',
    'aria-label': 'Lista de nombres, uno por línea',
  });
  const masivo = h('details', { open: grupo.personas.length === 0 },
    h('summary', {}, 'Pegar una lista'),
    h('div', { class: 'contenido' },
      h('p', { class: 'tenue pequeno' }, 'Un nombre por línea. Puedes copiarlos de una hoja de cálculo.'),
      pegado,
      h('div', { class: 'acciones' },
        h('button', {
          class: 'primario',
          onclick: () => {
            const { agregadas, repetidas } = agregarPersonas(grupo, separarLista(pegado.value));
            persistir();
            render();
            avisar(`${plural(agregadas, 'añadida', 'añadidas')}${repetidas ? `, ${plural(repetidas, 'repetida omitida', 'repetidas omitidas')}` : ''}`);
          },
        }, 'Añadir todas'))));

  const activas = personasActivas(grupo);
  const archivadas = personasArchivadas(grupo);

  const filaActiva = (persona) => h('li', {},
    h('span', { class: 'nombre' }, persona.nombre),
    h('div', { class: 'acciones' },
      h('button', { class: 'mini', onclick: () => renombrar(grupo, persona) }, 'Editar'),
      h('button', {
        class: 'mini',
        onclick: () => {
          persona.activo = false;
          persistir();
          render();
        },
      }, 'Archivar')));

  const filaArchivada = (persona) => h('li', {},
    h('span', { class: 'nombre tenue' }, persona.nombre),
    h('div', { class: 'acciones' },
      h('button', {
        class: 'mini',
        onclick: () => {
          persona.activo = true;
          persistir();
          render();
        },
      }, 'Reactivar'),
      h('button', {
        class: 'mini peligro',
        onclick: async () => {
          const seguro = await confirmar({
            titulo: `Eliminar a ${persona.nombre}`,
            texto: 'Se borrará también todo su historial de asistencia. No se puede deshacer.',
            accion: 'Eliminar',
            peligro: true,
          });
          if (!seguro) return;
          eliminarPersona(grupo, persona.id);
          persistir();
          render();
        },
      }, 'Eliminar')));

  return [
    formulario,
    h('section', { class: 'tarjeta' }, masivo),
    activas.length > 0 && h('h2', {}, `${plural(activas.length, 'persona', 'personas')} en el grupo`),
    activas.length > 0 && h('ul', { class: 'lista' }, activas.map(filaActiva)),
    archivadas.length > 0 && h('details', {},
      h('summary', {}, `Archivadas (${archivadas.length})`),
      h('div', { class: 'contenido' },
        h('p', { class: 'tenue pequeno' }, 'No salen en la lista nueva, pero conservan su historial en los reportes.'),
        h('ul', { class: 'lista' }, archivadas.map(filaArchivada)))),
    h('section', { class: 'tarjeta' },
      h('h2', {}, 'Grupo'),
      h('div', { class: 'acciones' },
        h('button', { onclick: () => renombrarGrupo(grupo) }, 'Renombrar'),
        h('button', { class: 'peligro', onclick: () => borrarGrupo(grupo) }, 'Eliminar grupo'))),
  ].filter(Boolean);
}

async function renombrar(grupo, persona) {
  const nombre = await pedirTexto({
    titulo: 'Editar persona', etiqueta: 'Nombre', valor: persona.nombre, accion: 'Guardar',
  });
  if (!nombre) return;
  if (!renombrarPersona(grupo, persona.id, nombre)) {
    avisar('Ya hay otra persona con ese nombre');
    return;
  }
  persistir();
  render();
}

async function renombrarGrupo(grupo) {
  const nombre = await pedirTexto({
    titulo: 'Renombrar grupo', etiqueta: 'Nombre', valor: grupo.nombre, accion: 'Guardar',
  });
  if (!nombre) return;
  grupo.nombre = nombre;
  persistir();
  render();
}

async function borrarGrupo(grupo) {
  const dias = Object.keys(grupo.registros).length;
  const seguro = await confirmar({
    titulo: `Eliminar ${grupo.nombre}`,
    texto: `Se borrarán ${plural(grupo.personas.length, 'persona', 'personas')} y ${plural(dias, 'lista', 'listas')}. No se puede deshacer.`,
    accion: 'Eliminar',
    peligro: true,
  });
  if (!seguro) return;
  eliminarGrupo(estado, grupo.id);
  persistir();
  location.hash = '#/';
}

// Reporte

function vistaReporte(grupo) {
  if (filtro.grupoId !== grupo.id) filtro = { grupoId: grupo.id, desde: '', hasta: '', orden: 'nombre' };

  const resultado = h('div', { class: 'pila' });
  const pintar = () => resultado.replaceChildren(...resultadoReporte(grupo, pintar));

  const campoDesde = h('input', { type: 'date', value: filtro.desde });
  const campoHasta = h('input', { type: 'date', value: filtro.hasta });
  const aplicar = (desde, hasta) => {
    filtro.desde = desde;
    filtro.hasta = hasta;
    campoDesde.value = desde;
    campoHasta.value = hasta;
    pintar();
  };
  campoDesde.addEventListener('change', () => aplicar(campoDesde.value, campoHasta.value));
  campoHasta.addEventListener('change', () => aplicar(campoDesde.value, campoHasta.value));

  const inicioDeMes = () => {
    const d = aFecha(hoy());
    return deFecha(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  pintar();
  return [
    h('section', { class: 'tarjeta' },
      h('div', { class: 'periodo' },
        h('label', {}, 'Desde', campoDesde),
        h('label', {}, 'Hasta', campoHasta)),
      h('div', { class: 'acciones' },
        h('button', { class: 'mini', onclick: () => aplicar('', '') }, 'Todo'),
        h('button', { class: 'mini', onclick: () => aplicar(inicioDeMes(), hoy()) }, 'Este mes'),
        h('button', { class: 'mini', onclick: () => aplicar(sumarDias(hoy(), -29), hoy()) }, 'Últimos 30 días'))),
    resultado,
  ];
}

function resultadoReporte(grupo, pintar) {
  const r = resumen(grupo, filtro.desde, filtro.hasta);
  if (!r.fechas.length) {
    return [h('div', { class: 'tarjeta vacio' },
      h('h2', {}, 'No hay listas en este período'),
      h('p', { class: 'tenue' }, 'El reporte aparecerá en cuanto tomes lista.'))];
  }

  const filas = [...r.filas];
  if (filtro.orden === 'menor') {
    filas.sort((a, b) => (a.porcentaje ?? Infinity) - (b.porcentaje ?? Infinity));
  }
  const esBaja = (f) => f.porcentaje !== null && f.porcentaje < UMBRAL;

  const tablaResumen = h('table', {},
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'Nombre'),
      Object.entries(ESTADOS).map(([clave, nombre]) => h('th', { scope: 'col', title: nombre }, clave)),
      h('th', { scope: 'col' }, '%'))),
    h('tbody', {}, filas.map((f) =>
      h('tr', { class: esBaja(f) ? 'bajo' : null },
        h('td', { class: 'persona' }, f.persona.nombre),
        h('td', {}, f.P), h('td', {}, f.T), h('td', {}, f.A), h('td', {}, f.J),
        h('td', { class: 'pct' }, f.porcentaje === null ? '—' : `${f.porcentaje}%`)))));

  // Lo reciente primero: en móvil las columnas del final quedan fuera de pantalla.
  const recientes = [...r.fechas].reverse();
  const matriz = h('div', { class: 'tabla-marco' },
    h('table', { class: 'matriz' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Nombre'),
        recientes.map((f) => h('th', { scope: 'col' }, fmtCorta.format(aFecha(f)))))),
      h('tbody', {}, filas.map((f) =>
        h('tr', {},
          h('td', { class: 'persona' }, f.persona.nombre),
          recientes.map((fecha) => {
            const m = marcaDe(grupo, fecha, f.persona.id);
            return h('td', { 'data-e': m, title: ESTADOS[m] ?? 'Sin marcar' }, m ?? '·');
          }))))));

  const sufijo = `${aArchivo(grupo.nombre)}-${hoy()}`;
  return [
    h('div', { class: 'datos' },
      h('div', { class: 'dato' }, h('b', {}, r.fechas.length), h('span', {}, r.fechas.length === 1 ? 'lista tomada' : 'listas tomadas')),
      h('div', { class: 'dato' }, h('b', {}, r.porcentaje === null ? '—' : `${r.porcentaje}%`), h('span', {}, 'asistencia')),
      h('div', { class: 'dato' }, h('b', {}, r.filas.filter(esBaja).length), h('span', {}, `bajo ${UMBRAL}%`))),
    h('section', { class: 'tarjeta' },
      h('div', { class: 'acciones encabezado' },
        h('h2', {}, 'Por persona'),
        h('button', {
          class: 'mini',
          onclick: () => {
            filtro.orden = filtro.orden === 'menor' ? 'nombre' : 'menor';
            pintar();
          },
        }, filtro.orden === 'menor' ? 'Ordenar por nombre' : 'Ordenar por menor asistencia')),
      h('div', { class: 'tabla-marco' }, tablaResumen),
      h('p', { class: 'tenue pequeno' },
        'P Presente · T Tarde · A Ausente · J Justificado. El porcentaje cuenta Tarde como asistencia y no tiene en cuenta los días justificados.')),
    h('section', { class: 'tarjeta' }, h('h2', {}, 'Día por día'), matriz),
    h('div', { class: 'acciones' },
      h('button', { onclick: () => descargarCsv(`resumen-${sufijo}.csv`, csvResumen(r)) }, 'Exportar resumen CSV'),
      h('button', { onclick: () => descargarCsv(`detalle-${sufijo}.csv`, csvDetalle(grupo, r)) }, 'Exportar detalle CSV')),
  ];
}

// Arranque

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

// Una PWA puede quedar abierta de un día para otro: sin esto seguiría diciendo
// "Hoy" y guardaría las marcas en la fecha de ayer.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && hoy() !== ultimoDia) render();
});

// Otra pestaña guardó cambios: sin esto, el siguiente guardado aquí los pisaría.
window.addEventListener('storage', (e) => {
  if (!esClaveDeDatos(e.key)) return;
  estado = cargar().estado;
  render();
});

render();
if (inicial.problema) avisar(inicial.problema, 10000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

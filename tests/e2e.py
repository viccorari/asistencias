"""Prueba de punta a punta en Chrome real.

    uv run --with playwright python tests/e2e.py                 # sirve el proyecto en local
    uv run --with playwright python tests/e2e.py https://...     # prueba una URL publicada
"""
import functools
import http.server
import json
import pathlib
import sys
import threading
from datetime import date, timedelta

from playwright.sync_api import expect, sync_playwright

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SALIDA = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def servir():
    manejador = functools.partial(Silencioso, directory=RAIZ)
    servidor = http.server.ThreadingHTTPServer(('127.0.0.1', 0), manejador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{servidor.server_address[1]}/'


def captura(pagina, nombre):
    if SALIDA:
        SALIDA.mkdir(parents=True, exist_ok=True)
        pagina.screenshot(path=SALIDA / f'{nombre}.png', full_page=True)


def fila(pagina, nombre):
    return pagina.locator('.lista li').filter(has_text=nombre)


def marcar(pagina, nombre, estado):
    fila(pagina, nombre).locator(f'.marca[data-e="{estado}"]').click()


def logica(pagina):
    """Reglas de negocio que no se ven bien desde la interfaz."""
    resultado = pagina.evaluate("""async () => {
      const d = await import('./datos.js');
      const g = { id: 'g', nombre: 'x', personas: [], registros: {} };
      d.agregarPersonas(g, ['Ana', 'ÁNA', 'Beto', 'Ceci', 'Dani']);
      const [ana, beto, ceci, dani] = g.personas.map((p) => p.id);
      for (const [f, a, b] of [['2026-01-05','P','A'], ['2026-01-06','T','A'], ['2026-01-07','A','J'], ['2026-01-08','J','J']]) {
        d.marcar(g, f, ana, a); d.marcar(g, f, beto, b);
      }
      d.marcar(g, '2026-01-05', ceci, 'J');
      const r = d.resumen(g);
      const filtrado = d.resumen(g, '2026-01-06', '2026-01-07');
      const mal = (texto) => { try { d.leerRespaldo(texto); return false; } catch { return true; } };
      const peligroso = { id: 'g', nombre: 'x', personas: [{ id: 'p1', nombre: '=1+1;"x"' }], registros: { '2026-01-05': { p1: 'P', fantasma: 'P' }, 'nofecha': { p1: 'P' } } };
      const limpio = d.validar({ version: 1, grupos: [peligroso] });
      const g2 = { ...g, personas: [...g.personas], registros: structuredClone(g.registros) };
      d.eliminarPersona(g2, ana);
      return {
        cuantas: g.personas.length,
        ana: r.filas[0].porcentaje, beto: r.filas[1].porcentaje, ceci: r.filas[2].porcentaje, dani: r.filas[3].porcentaje,
        general: r.porcentaje, fechasFiltradas: filtrado.fechas,
        lista: d.separarLista('1. Ana  Paz\\r\\n2) Luis\\n\\n3 - Eva\\n   Sol\\n2Pac'),
        csv: d.csvResumen(d.resumen(limpio.grupos[0])),
        registrosLimpios: limpio.grupos[0].registros,
        malos: [mal('{'), mal('null'), mal('{"version":2,"grupos":[]}'), mal('{"version":1,"grupos":[{"id":"a b","nombre":"x","personas":[]}]}')],
        fechas: [d.sumarDias('2026-03-01', -1), d.sumarDias('2024-02-28', 1), d.esFecha('2026-02-30'), d.esFecha('2026-02-28')],
        tildes: d.normalizar('  José   ÑAÑEZ '),
        vacioTrasEliminar: Object.values(g2.registros).every((m) => !(ana in m)),
      };
    }""")
    assert resultado['cuantas'] == 4, resultado  # 'ÁNA' es la misma persona que 'Ana'
    assert resultado['ana'] == 67, resultado     # P + T de P + T + A; J no cuenta
    assert resultado['beto'] == 0, resultado
    assert resultado['ceci'] is None, resultado  # solo justificado: no hay porcentaje
    assert resultado['dani'] is None, resultado
    assert resultado['general'] == 40, resultado
    assert resultado['fechasFiltradas'] == ['2026-01-06', '2026-01-07'], resultado
    assert resultado['lista'] == ['Ana Paz', 'Luis', 'Eva', 'Sol', '2Pac'], resultado
    assert "\"'=1+1;\"\"x\"\"\"" in resultado['csv'], resultado
    assert resultado['registrosLimpios'] == {'2026-01-05': {'p1': 'P'}}, resultado
    assert all(resultado['malos']), resultado
    assert resultado['fechas'] == ['2026-02-28', '2024-02-29', False, True], resultado
    assert resultado['tildes'] == 'jose nanez', resultado
    assert resultado['vacioTrasEliminar'], resultado


def flujo(contexto, url):
    errores = []
    pagina = contexto.new_page()
    pagina.on('pageerror', lambda e: errores.append(str(e)))
    pagina.on('console', lambda m: errores.append(m.text) if m.type == 'error' else None)
    pagina.goto(url)

    logica(pagina)
    expect(pagina.get_by_text('Crea tu primer grupo')).to_be_visible()
    captura(pagina, '1-inicio-vacio')

    # Crear grupo y personas, incluida una inyección que debe quedar como texto
    pagina.get_by_label('Nombre del grupo').fill('Primero A')
    pagina.get_by_role('button', name='Crear').click()
    expect(pagina.get_by_role('heading', name='Primero A')).to_be_visible()
    pagina.get_by_label('Lista de nombres').fill(
        '1. Ana Torres\n2. Luis Quispe\n3. María Fernández\n4. ana torres\n'
        '<img src=x onerror=alert(1)>\nBartolomé de las Casas y Fernández de Córdoba Pérez',
    )
    pagina.get_by_role('button', name='Añadir todas').click()
    expect(pagina.locator('#aviso')).to_have_text('5 añadidas, 1 repetida omitida')
    assert pagina.locator('#app img').count() == 0
    pagina.get_by_label('Nombre de la persona').fill('Zoe Paz')
    pagina.get_by_label('Nombre de la persona').press('Enter')
    expect(pagina.get_by_text('6 personas en el grupo')).to_be_visible()
    expect(pagina.get_by_label('Nombre de la persona')).to_be_focused()
    captura(pagina, '2-personas')

    # Tomar lista
    pagina.get_by_role('link', name='Lista').click()
    marcar(pagina, 'Ana Torres', 'P')
    marcar(pagina, 'Luis Quispe', 'A')
    marcar(pagina, 'María Fernández', 'T')
    marcar(pagina, 'Zoe Paz', 'J')
    expect(pagina.locator('.contador[data-e="sinMarcar"] b')).to_have_text('2')
    captura(pagina, '3-lista')

    # Pulsar la misma marca la quita; marcar el resto no pisa lo ya marcado
    marcar(pagina, 'Ana Torres', 'P')
    expect(pagina.locator('.contador[data-e="sinMarcar"] b')).to_have_text('3')
    pagina.get_by_role('button', name='Marcar el resto presentes').click()
    expect(pagina.locator('.contador[data-e="P"] b')).to_have_text('3')
    expect(pagina.locator('.contador[data-e="A"] b')).to_have_text('1')
    expect(pagina.get_by_role('button', name='Marcar el resto presentes')).to_be_disabled()

    # Persiste al recargar
    pagina.reload()
    expect(pagina.locator('.contador[data-e="A"] b')).to_have_text('1')

    # Día anterior: lista distinta; mañana no se puede
    expect(pagina.get_by_role('button', name='Día siguiente')).to_be_disabled()
    pagina.get_by_role('button', name='Día anterior').click()
    expect(pagina.locator('.contador[data-e="sinMarcar"] b')).to_have_text('6')
    marcar(pagina, 'Luis Quispe', 'A')
    marcar(pagina, 'Ana Torres', 'P')
    ayer = (date.today() - timedelta(days=1)).isoformat()
    assert pagina.url.endswith(ayer), pagina.url

    # Una fecha futura en la URL cae a hoy
    manana = (date.today() + timedelta(days=1)).isoformat()
    pagina.goto(pagina.url.replace(ayer, manana))
    expect(pagina.locator('.fecha-dia')).to_have_text('Hoy')

    # Archivar: sale de la lista de hoy si no tiene marca, pero sigue en la de ayer si la tenía
    pagina.get_by_role('link', name='Personas').click()
    fila(pagina, 'Luis Quispe').get_by_role('button', name='Archivar').click()
    expect(pagina.get_by_text('Archivadas (1)')).to_be_visible()
    pagina.get_by_role('link', name='Lista').click()
    expect(fila(pagina, 'Luis Quispe').locator('.etiqueta')).to_have_text('Archivada')

    # Reporte
    pagina.get_by_role('link', name='Reporte').click()
    expect(pagina.locator('.dato b').first).to_have_text('2')
    tabla = pagina.locator('.tarjeta table').first
    expect(tabla.locator('tr').filter(has_text='Luis Quispe').locator('.pct')).to_have_text('0%')
    expect(tabla.locator('tr').filter(has_text='Ana Torres').locator('.pct')).to_have_text('100%')
    captura(pagina, '4-reporte')

    pagina.get_by_role('button', name='Ordenar por menor asistencia').click()
    expect(pagina.locator('.tarjeta table').first.locator('tbody tr').first).to_contain_text('Luis Quispe')

    # El filtro por fechas funciona y un rango vacío no rompe
    pagina.get_by_label('Desde').fill('2001-01-01')
    pagina.get_by_label('Hasta').fill('2001-01-02')
    pagina.get_by_label('Hasta').blur()
    expect(pagina.get_by_text('No hay listas en este período')).to_be_visible()
    pagina.get_by_role('button', name='Todo').click()

    # CSV
    with pagina.expect_download() as descarga:
        pagina.get_by_role('button', name='Exportar resumen CSV').click()
    bruto = pathlib.Path(descarga.value.path()).read_bytes()
    assert bruto.startswith(b'\xef\xbb\xbf'), bruto[:10]
    texto = bruto.decode('utf-8-sig')
    assert texto.startswith('Nombre;Presente;Tarde;Ausente;Justificado;Asistencia %'), texto
    assert 'Ana Torres;2;0;0;0;100' in texto, texto
    assert descarga.value.suggested_filename.startswith('resumen-primero-a-'), descarga.value.suggested_filename

    with pagina.expect_download() as descarga:
        pagina.get_by_role('button', name='Exportar detalle CSV').click()
    texto = pathlib.Path(descarga.value.path()).read_bytes().decode('utf-8-sig')
    assert f'Nombre;{ayer};{date.today().isoformat()}' in texto, texto
    assert 'Luis Quispe;Ausente;Ausente' in texto, texto

    # Copia de seguridad: descargar, borrar el grupo, restaurar
    pagina.get_by_role('link', name='Volver a grupos').click()
    expect(pagina.locator('.grupo')).to_contain_text('5 personas')
    captura(pagina, '5-inicio')
    with pagina.expect_download() as descarga:
        pagina.get_by_role('button', name='Descargar copia').click()
    copia = pathlib.Path(descarga.value.path())
    assert json.loads(copia.read_text())['version'] == 1
    expect(pagina.get_by_text('Última copia:')).to_be_visible()

    pagina.locator('.grupo').click()
    pagina.get_by_role('link', name='Personas').click()
    pagina.get_by_role('button', name='Eliminar grupo').click()
    captura(pagina, '6-dialogo')
    pagina.get_by_role('button', name='Cancelar').click()
    expect(pagina.get_by_role('heading', name='Primero A')).to_be_visible()
    pagina.get_by_role('button', name='Eliminar grupo').click()
    pagina.locator('dialog').get_by_role('button', name='Eliminar').click()
    expect(pagina.get_by_text('Crea tu primer grupo')).to_be_visible()

    # Un archivo que no es una copia se rechaza sin tocar nada
    malo = pathlib.Path(descarga.value.path()).with_suffix('.malo.json')
    malo.write_text('{"hola": 1}')
    pagina.locator('input[type=file]').set_input_files(malo)
    expect(pagina.locator('#aviso')).to_contain_text('no es una copia')

    pagina.locator('input[type=file]').set_input_files(copia)
    pagina.locator('dialog').get_by_role('button', name='Reemplazar').click()
    expect(pagina.locator('.grupo')).to_contain_text('Primero A')

    # Editar con Enter en el diálogo, y nombre repetido rechazado
    pagina.locator('.grupo').click()
    pagina.get_by_role('link', name='Personas').click()
    fila(pagina, 'Ana Torres').get_by_role('button', name='Editar').click()
    pagina.locator('dialog input').fill('Ana María Torres')
    pagina.locator('dialog input').press('Enter')
    expect(fila(pagina, 'Ana María Torres')).to_be_visible()
    fila(pagina, 'Ana María Torres').get_by_role('button', name='Editar').click()
    pagina.locator('dialog input').fill('zoe paz')
    pagina.locator('dialog input').press('Enter')
    expect(pagina.locator('#aviso')).to_have_text('Ya hay otra persona con ese nombre')

    # Eliminar definitivamente a una archivada borra su historial
    pagina.get_by_text('Archivadas (1)').click()
    fila(pagina, 'Luis Quispe').get_by_role('button', name='Eliminar').click()
    pagina.locator('dialog').get_by_role('button', name='Eliminar').click()
    expect(pagina.get_by_text('Archivadas')).to_have_count(0)
    guardado = pagina.evaluate("localStorage.getItem('asistencias.v1')")
    assert 'Luis Quispe' not in guardado, guardado

    # Dos pestañas: la segunda ve lo que hace la primera
    otra = contexto.new_page()
    otra.goto(pagina.url.split('#')[0] + '#/')
    pagina.get_by_role('button', name='Renombrar').click()
    pagina.locator('dialog input').fill('Primero B')
    pagina.locator('dialog input').press('Enter')
    expect(otra.locator('.grupo')).to_contain_text('Primero B')
    otra.close()

    # Sin conexión: la app arranca entera desde la caché
    pagina.evaluate('navigator.serviceWorker.ready.then(() => true)')
    pagina.reload()  # la primera carga no está controlada por el service worker
    pagina.wait_for_function('navigator.serviceWorker.controller !== null')
    contexto.set_offline(True)
    pagina.reload()
    expect(pagina.get_by_role('heading', name='Primero B')).to_be_visible()
    pagina.get_by_role('link', name='Lista').click()
    marcar(pagina, 'Zoe Paz', 'A')
    pagina.reload()
    expect(fila(pagina, 'Zoe Paz').locator('.marca[data-e="A"]')).to_have_attribute('aria-pressed', 'true')
    contexto.set_offline(False)

    assert not errores, errores
    pagina.close()


def cambio_de_dia(navegador, url):
    """La fecha es la local aunque en UTC ya sea mañana, y cambia al volver a la app."""
    contexto = navegador.new_context(timezone_id='America/Lima')
    pagina = contexto.new_page()
    pagina.clock.install(time='2026-03-11T04:30:00Z')  # 23:30 del día 10 en Lima
    pagina.goto(url)
    assert pagina.evaluate("import('./datos.js').then((d) => d.hoy())") == '2026-03-10'
    pagina.get_by_label('Nombre del grupo').fill('Noche')
    pagina.get_by_role('button', name='Crear').click()
    pagina.get_by_label('Nombre de la persona').fill('Ana')
    pagina.get_by_label('Nombre de la persona').press('Enter')
    pagina.get_by_role('link', name='Lista').click()
    expect(pagina.locator('.fecha-resto')).to_have_text('10 de marzo de 2026')

    # A la mañana siguiente, sin recargar, la app vuelve a primer plano
    pagina.clock.set_system_time('2026-03-11T14:00:00Z')
    pagina.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    expect(pagina.locator('.fecha-resto')).to_have_text('11 de marzo de 2026')
    marcar(pagina, 'Ana', 'P')
    guardado = json.loads(pagina.evaluate("localStorage.getItem('asistencias.v1')"))
    assert list(guardado['grupos'][0]['registros']) == ['2026-03-11'], guardado
    contexto.close()


def desbordes(navegador, url):
    """Que no haya scroll horizontal de página en móvil."""
    for ancho in (320, 390):
        contexto = navegador.new_context(
            viewport={'width': ancho, 'height': 800}, color_scheme='dark', device_scale_factor=2,
        )
        pagina = contexto.new_page()
        pagina.goto(url)
        pagina.evaluate("""async () => {
          const d = await import('./datos.js');
          const e = { version: 1, grupos: [] };
          const g = d.crearGrupo(e, 'Grupo con un nombre bastante largo para probar');
          d.agregarPersonas(g, ['Bartolomé de las Casas y Fernández de Córdoba Pérez', 'Ana Torres', 'Luis Quispe']);
          for (let i = 0; i < 12; i++) {
            const f = d.sumarDias(d.hoy(), -i);
            g.personas.forEach((p, n) => d.marcar(g, f, p.id, 'PTAJ'[(i + n) % 4]));
          }
          d.guardar(e);
          location.hash = `#/g/${g.id}/lista`;
          location.reload();
        }""")
        pagina.wait_for_selector('.lista')
        for vista in ('lista', 'personas', 'reporte'):
            pagina.get_by_role('link', name=vista.capitalize(), exact=True).click()
            pagina.wait_for_timeout(100)
            sobra = pagina.evaluate('document.documentElement.scrollWidth - innerWidth')
            assert sobra <= 0, f'{vista} a {ancho}px desborda {sobra}px'
            captura(pagina, f'movil-{ancho}-{vista}')
        contexto.close()


def main():
    url = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != '-' else servir()
    with sync_playwright() as p:
        navegador = p.chromium.launch(channel='chrome')
        contexto = navegador.new_context(viewport={'width': 900, 'height': 900}, accept_downloads=True)
        flujo(contexto, url)
        contexto.close()
        cambio_de_dia(navegador, url)
        desbordes(navegador, url)
        navegador.close()
    print('OK:', url)


if __name__ == '__main__':
    main()

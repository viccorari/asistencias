# Asistencias

Aplicación web para tomar lista y llevar el control de asistencia de cualquier grupo: una clase,
un equipo, un turno. Se instala como app en el móvil o el ordenador, funciona sin conexión y no
necesita cuenta.

**Abrir la app:** https://viccorari.github.io/asistencias/

## Qué hace

- Grupos y personas, añadidas de una en una o pegando una lista.
- Lista diaria con cuatro marcas: Presente, Tarde, Ausente y Justificado. También de días pasados.
- Reporte por período con porcentaje por persona y vista día por día.
- Exportación a CSV, lista para abrir en Excel.
- Copia de seguridad en un archivo y restauración.

El porcentaje cuenta Tarde como asistencia y no tiene en cuenta los días justificados. Se resalta
a quien esté por debajo del 75 %.

## Dónde están los datos

Solo en el navegador de cada dispositivo. No hay servidor ni cuentas, así que nadie más puede
verlos, pero tampoco se sincronizan entre dispositivos y se pierden si se borran los datos del
navegador. Por eso conviene descargar copias de seguridad; con el mismo archivo se pueden pasar los
datos a otro dispositivo.

## Desarrollo

JavaScript sin dependencias ni compilación. `datos.js` contiene el estado y las reglas de negocio;
`main.js`, la interfaz.

```bash
python3 -m http.server                               # http://localhost:8000
uv run --with playwright python tests/e2e.py         # pruebas en Chrome
```

GitHub Pages publica la rama `main` tal cual. **Al publicar cambios, sube el número de `CACHE` en
`sw.js`**: si no, quien ya tenga la app seguirá viendo la versión anterior.

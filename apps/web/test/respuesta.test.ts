import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PanelDeRespuesta from '../src/components/respuesta/PanelDeRespuesta.vue';
import type { ResultadoDeEjecucion } from '../src/api/ejecucion';

/**
 * Pruebas del panel de respuesta.
 *
 * Los dos casos que exige el encargo son los dos extremos de la pantalla: una
 * respuesta normal y un fallo de conexión. El segundo es el que más veces se
 * pinta mal en los clientes de API, porque es tentador reutilizar el hueco del
 * código de estado y meter un `0`. Aquí se comprueba explícitamente que ESO NO
 * PASA.
 */

const TIEMPOS_EN_CERO = { dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: 0 };

function resultadoCorrecto(): ResultadoDeEjecucion {
  return {
    executionId: 'ejecucion-de-prueba',
    outcome: 'completed',
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: '',
      headers: [
        { name: 'content-type', value: 'application/json; charset=utf-8' },
        { name: 'x-peticion-id', value: 'abc-123' },
      ],
      bodyEncoding: 'utf8',
      body: '{"saludo":"hola","items":[1,2,3]}',
      bodyTruncated: false,
      sizeBytes: 33,
    },
    timings: { ...TIEMPOS_EN_CERO, ttfbMs: 85, totalMs: 128 },
    redirects: [],
    error: null,
    adaptador: 'navegador',
    urlEfectiva: 'https://api.ejemplo.com/v1/saludo',
    cabecerasIgnoradas: [],
  };
}

function resultadoSinConexion(): ResultadoDeEjecucion {
  return {
    executionId: 'ejecucion-fallida',
    outcome: 'failed',
    response: null,
    timings: { ...TIEMPOS_EN_CERO, totalMs: 42 },
    redirects: [],
    error: {
      code: 'CONNECTION_REFUSED',
      message: 'El destino rechazó la conexión.',
    },
    adaptador: 'navegador',
    // Sin dígitos `0` en la URL a propósito: así la prueba de abajo puede
    // afirmar que en toda la pantalla no aparece un cero haciéndose pasar por
    // un código de estado.
    urlEfectiva: 'http://localhost:9/nada',
    cabecerasIgnoradas: [],
  };
}

describe('PanelDeRespuesta', () => {
  it('pinta correctamente una respuesta 200 con cabeceras y cuerpo', async () => {
    const envoltorio = mount(PanelDeRespuesta, {
      props: { resultado: resultadoCorrecto(), ejecutando: false, error: null },
    });

    // Código HTTP y su descripción (§8).
    expect(envoltorio.get('[data-prueba="estado-codigo"]').text()).toBe('200');
    expect(envoltorio.get('[data-prueba="estado-texto"]').text()).toBe('OK');
    expect(envoltorio.get('[data-prueba="estado"]').classes()).toContain('panel__estado--exito');

    // Tiempo total y tamaño.
    expect(envoltorio.get('[data-prueba="tiempo-total"]').text()).toBe('128 ms');
    expect(envoltorio.get('[data-prueba="tamano"]').text()).toBe('33 B');

    // Cuerpo: la pestaña «Raw» siempre lleva el texto literal recibido.
    expect(envoltorio.get('[data-prueba="cuerpo-crudo"]').text()).toContain('"saludo"');
    expect(envoltorio.get('[data-prueba="cuerpo-crudo"]').text()).toContain('hola');

    // Cabeceras, tras pulsar su pestaña.
    await envoltorio.get('[data-prueba="pestana-cabeceras"]').trigger('click');
    const cabeceras = envoltorio.get('[data-prueba="cabeceras"]').text();
    expect(cabeceras).toContain('content-type');
    expect(cabeceras).toContain('application/json; charset=utf-8');
    expect(cabeceras).toContain('x-peticion-id');
    expect(cabeceras).toContain('abc-123');

    envoltorio.unmount();
  });

  it('pinta un error de conexión sin inventarse un estado HTTP', () => {
    const envoltorio = mount(PanelDeRespuesta, {
      props: { resultado: resultadoSinConexion(), ejecutando: false, error: null },
    });

    // Se ve el fallo, con el código del vocabulario del motor y su mensaje.
    expect(envoltorio.find('[data-prueba="error-de-ejecucion"]').exists()).toBe(true);
    expect(envoltorio.get('[data-prueba="codigo-de-error"]').text()).toBe('CONNECTION_REFUSED');
    expect(envoltorio.get('[data-prueba="mensaje-de-error"]').text()).toBe(
      'El destino rechazó la conexión.',
    );
    expect(envoltorio.text()).toContain('no hay código de estado que mostrar');

    // Y NO se pinta ningún estado HTTP: ni la insignia, ni un `0`, ni un 200.
    expect(envoltorio.find('[data-prueba="estado"]').exists()).toBe(false);
    expect(envoltorio.find('[data-prueba="estado-codigo"]').exists()).toBe(false);
    expect(envoltorio.find('[data-prueba="estado-texto"]').exists()).toBe(false);
    expect(envoltorio.find('.panel__estado').exists()).toBe(false);
    expect(envoltorio.text()).not.toContain('0');
    expect(envoltorio.text()).not.toContain('200');

    // Tampoco hay tamaño de cuerpo: no hubo cuerpo.
    expect(envoltorio.find('[data-prueba="tamano"]').exists()).toBe(false);
    expect(envoltorio.find('[data-prueba="cuerpo-de-respuesta"]').exists()).toBe(false);

    // El tiempo hasta el fallo sí es información real y se muestra.
    expect(envoltorio.get('[data-prueba="tiempo-total"]').text()).toBe('42 ms');

    envoltorio.unmount();
  });

  it('colorea la familia del estado y muestra el modo de ejecución', () => {
    const base = resultadoCorrecto();
    const resultado: ResultadoDeEjecucion = {
      ...base,
      response: { ...base.response!, status: 503, statusText: '' },
      cabecerasIgnoradas: ['Host'],
    };

    const envoltorio = mount(PanelDeRespuesta, { props: { resultado } });

    expect(envoltorio.get('[data-prueba="estado-codigo"]').text()).toBe('503');
    // `statusText` vacío (HTTP/2 no manda frase): se completa con la de referencia.
    expect(envoltorio.get('[data-prueba="estado-texto"]').text()).toBe('Service Unavailable');
    expect(envoltorio.get('[data-prueba="estado"]').classes()).toContain('panel__estado--servidor');
    expect(envoltorio.get('[data-prueba="modo-de-ejecucion"]').text()).toContain(
      'directamente desde el navegador',
    );
    expect(envoltorio.get('[data-prueba="modo-de-ejecucion"]').text()).toContain('Host');

    envoltorio.unmount();
  });

  it('sin resultado enseña el estado vacío, y en vuelo enseña el giro de la marca', () => {
    const vacio = mount(PanelDeRespuesta, { props: { resultado: null } });
    expect(vacio.text()).toContain('Sin respuesta todavía');
    expect(vacio.find('[data-prueba="ejecutando"]').exists()).toBe(false);
    vacio.unmount();

    const enVuelo = mount(PanelDeRespuesta, { props: { resultado: null, ejecutando: true } });
    expect(enVuelo.find('[data-prueba="ejecutando"]').exists()).toBe(true);
    expect(enVuelo.text()).toContain('Ejecutando la solicitud');
    enVuelo.unmount();
  });

  it('un error de la propia interfaz se distingue del error del destino', () => {
    const envoltorio = mount(PanelDeRespuesta, {
      props: { resultado: null, error: 'Escribe la URL de destino antes de enviar.' },
    });

    expect(envoltorio.text()).toContain('Escribe la URL de destino antes de enviar.');
    expect(envoltorio.find('[data-prueba="error-de-ejecucion"]').exists()).toBe(false);
    expect(envoltorio.find('[data-prueba="estado-codigo"]').exists()).toBe(false);

    envoltorio.unmount();
  });
});
